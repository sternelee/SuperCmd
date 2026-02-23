import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type BoundsRect = {
  position: { x: number; y: number };
  size: { width: number; height: number };
};

type ManagedWindow = {
  id: string;
  title?: string;
  bounds?: BoundsRect;
  application?: { name?: string; path?: string };
  positionable?: boolean;
  resizable?: boolean;
};

type PresetId = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'auto-organize';

type Rect = { x: number; y: number; width: number; height: number };

type LayoutMove = { id: string; bounds: BoundsRect };

interface WindowManagerPanelProps {
  show: boolean;
  portalTarget?: HTMLElement | null;
  onClose: () => void;
}

const PRESETS: Array<{ id: PresetId; label: string; subtitle: string }> = [
  { id: 'top-left', label: 'Top Left', subtitle: 'All windows on this screen' },
  { id: 'top-right', label: 'Top Right', subtitle: 'All windows on this screen' },
  { id: 'bottom-left', label: 'Bottom Left', subtitle: 'All windows on this screen' },
  { id: 'bottom-right', label: 'Bottom Right', subtitle: 'All windows on this screen' },
  { id: 'auto-organize', label: 'Auto organise', subtitle: 'Grid all windows on this screen' },
];

const CORNER_PRESETS: PresetId[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function isSuperCmdWindow(win: ManagedWindow | null | undefined): boolean {
  const appName = normalizeText(win?.application?.name).toLowerCase();
  const appPath = normalizeText((win as any)?.application?.path).toLowerCase();
  const title = normalizeText(win?.title).toLowerCase();
  return appName.includes('supercmd') || appPath.includes('supercmd') || title.includes('supercmd');
}

function isManageableWindow(win: ManagedWindow | null | undefined): win is ManagedWindow {
  if (!win) return false;
  if (!normalizeText(win.id)) return false;
  if (isSuperCmdWindow(win)) return false;
  const width = Number(win.bounds?.size?.width || 0);
  const height = Number(win.bounds?.size?.height || 0);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return false;
  if (width < 120 || height < 60) return false;
  return win.positionable !== false && win.resizable !== false;
}

function getHostMetrics(hostWindow: Window | null | undefined): { left: number; top: number; width: number; height: number } {
  const target = hostWindow || window;
  const screenObj = target.screen as any;
  return {
    left: Number(screenObj?.availLeft ?? 0) || 0,
    top: Number(screenObj?.availTop ?? 0) || 0,
    width: Number(screenObj?.availWidth ?? target.innerWidth ?? 1440) || 1440,
    height: Number(screenObj?.availHeight ?? target.innerHeight ?? 900) || 900,
  };
}

function getWindowCenter(win: ManagedWindow): { x: number; y: number } {
  const x = Number(win.bounds?.position?.x || 0);
  const y = Number(win.bounds?.position?.y || 0);
  const width = Number(win.bounds?.size?.width || 0);
  const height = Number(win.bounds?.size?.height || 0);
  return { x: x + width / 2, y: y + height / 2 };
}

function isWindowOnScreenArea(win: ManagedWindow, area: { left: number; top: number; width: number; height: number }): boolean {
  const c = getWindowCenter(win);
  const minX = area.left - 4;
  const minY = area.top - 4;
  const maxX = area.left + area.width + 4;
  const maxY = area.top + area.height + 4;
  return c.x >= minX && c.x <= maxX && c.y >= minY && c.y <= maxY;
}

function rectToBounds(rect: Rect): BoundsRect {
  return {
    position: { x: Math.round(rect.x), y: Math.round(rect.y) },
    size: { width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) },
  };
}

function shrinkRect(rect: Rect, padding: number): Rect {
  const p = Math.max(0, padding);
  return {
    x: rect.x + p,
    y: rect.y + p,
    width: Math.max(1, rect.width - p * 2),
    height: Math.max(1, rect.height - p * 2),
  };
}

function computeGridColumns(count: number): number {
  if (count <= 1) return 1;
  if (count === 2) return 2;
  if (count <= 5) return 2;
  return 3;
}

function computeGridRects(count: number, region: Rect, options?: { gap?: number; padding?: number }): Rect[] {
  if (count <= 0) return [];
  const gap = Math.max(0, options?.gap ?? 8);
  const padded = shrinkRect(region, options?.padding ?? 8);
  const cols = Math.max(1, computeGridColumns(count));
  const rows = Math.max(1, Math.ceil(count / cols));
  const totalGapW = gap * (cols - 1);
  const totalGapH = gap * (rows - 1);
  const baseCellW = Math.max(1, Math.floor((padded.width - totalGapW) / cols));
  const baseCellH = Math.max(1, Math.floor((padded.height - totalGapH) / rows));

  const rects: Rect[] = [];
  for (let index = 0; index < count; index += 1) {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = padded.x + col * (baseCellW + gap);
    const y = padded.y + row * (baseCellH + gap);
    const isLastCol = col === cols - 1;
    const isLastRow = row === rows - 1;
    const width = isLastCol ? Math.max(1, padded.x + padded.width - x) : baseCellW;
    const height = isLastRow ? Math.max(1, padded.y + padded.height - y) : baseCellH;
    rects.push({ x, y, width, height });
  }
  return rects;
}

function splitQuadrants(area: { left: number; top: number; width: number; height: number }, options?: { padding?: number; gap?: number }) {
  const inner = shrinkRect({ x: area.left, y: area.top, width: area.width, height: area.height }, options?.padding ?? 8);
  const gap = Math.max(0, options?.gap ?? 8);
  const leftW = Math.max(1, Math.floor((inner.width - gap) / 2));
  const rightW = Math.max(1, inner.width - gap - leftW);
  const topH = Math.max(1, Math.floor((inner.height - gap) / 2));
  const bottomH = Math.max(1, inner.height - gap - topH);
  const x1 = inner.x;
  const x2 = inner.x + leftW + gap;
  const y1 = inner.y;
  const y2 = inner.y + topH + gap;

  return {
    'top-left': { x: x1, y: y1, width: leftW, height: topH } as Rect,
    'top-right': { x: x2, y: y1, width: rightW, height: topH } as Rect,
    'bottom-left': { x: x1, y: y2, width: leftW, height: bottomH } as Rect,
    'bottom-right': { x: x2, y: y2, width: rightW, height: bottomH } as Rect,
  };
}

function sortWindowsForLayout(windows: ManagedWindow[]): ManagedWindow[] {
  return [...windows].sort((a, b) => {
    const ay = Number(a.bounds?.position?.y || 0);
    const by = Number(b.bounds?.position?.y || 0);
    if (ay !== by) return ay - by;
    const ax = Number(a.bounds?.position?.x || 0);
    const bx = Number(b.bounds?.position?.x || 0);
    if (ax !== bx) return ax - bx;
    return normalizeText(a.application?.name).localeCompare(normalizeText(b.application?.name));
  });
}

function buildAutoLayout(windows: ManagedWindow[], area: { left: number; top: number; width: number; height: number }): LayoutMove[] {
  const rects = computeGridRects(windows.length, { x: area.left, y: area.top, width: area.width, height: area.height });
  return windows.map((win, index) => ({ id: win.id, bounds: rectToBounds(rects[index]) }));
}

function buildCornerLayout(
  presetId: Exclude<PresetId, 'auto-organize'>,
  windows: ManagedWindow[],
  area: { left: number; top: number; width: number; height: number }
): LayoutMove[] {
  const quadrants = splitQuadrants(area, { padding: 0, gap: 0 });
  const region = quadrants[presetId];
  if (windows.length === 1) {
    return [{ id: windows[0].id, bounds: rectToBounds(region) }];
  }
  const rects = computeGridRects(windows.length, region, { padding: 0, gap: 0 });
  return windows.map((win, index) => ({ id: win.id, bounds: rectToBounds(rects[index]) }));
}

const WindowManagerPanel: React.FC<WindowManagerPanelProps> = ({ show, portalTarget, onClose }) => {
  const [windowsOnScreen, setWindowsOnScreen] = useState<ManagedWindow[]>([]);
  const [statusText, setStatusText] = useState('Select a preset to arrange windows.');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [appliedPreset, setAppliedPreset] = useState<PresetId | null>(null);

  const windowsOnScreenRef = useRef<ManagedWindow[]>([]);
  const previewSeqRef = useRef(0);
  const lastPreviewKeyRef = useRef('');
  const previewLoopRunningRef = useRef(false);
  const pendingPreviewRef = useRef<{ presetId: PresetId; force?: boolean } | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);
  const inventoryInFlightRef = useRef<Promise<ManagedWindow[]> | null>(null);
  const lastInventoryAtRef = useRef(0);
  const targetWindowRef = useRef<ManagedWindow | null>(null);
  const targetInFlightRef = useRef<Promise<ManagedWindow | null> | null>(null);
  const lastTargetAtRef = useRef(0);

  useEffect(() => {
    windowsOnScreenRef.current = windowsOnScreen;
  }, [windowsOnScreen]);

  const hostWindow = portalTarget?.ownerDocument?.defaultView || null;
  const hostArea = useMemo(() => getHostMetrics(hostWindow), [hostWindow]);

  const loadWindowsForLayout = useCallback(async (force?: boolean) => {
    const now = Date.now();
    if (!force && windowsOnScreenRef.current.length > 0 && now - lastInventoryAtRef.current < 800) {
      return windowsOnScreenRef.current;
    }
    if (inventoryInFlightRef.current) return inventoryInFlightRef.current;

    const promise = (async () => {
      let all: ManagedWindow[] = [];
      try {
        all = ((await window.electron.getWindowsOnActiveDesktop()) || []) as ManagedWindow[];
      } catch {
        all = [];
      }
      const screenWindows = all
        .filter(isManageableWindow)
        .filter((win) => isWindowOnScreenArea(win, hostArea));
      const sorted = sortWindowsForLayout(screenWindows);
      windowsOnScreenRef.current = sorted;
      setWindowsOnScreen(sorted);
      lastInventoryAtRef.current = Date.now();
      return sorted;
    })();

    inventoryInFlightRef.current = promise;
    const result = await promise;
    inventoryInFlightRef.current = null;
    return result;
  }, [hostArea]);

  const loadTargetWindow = useCallback(async (force?: boolean) => {
    const now = Date.now();
    if (!force && targetWindowRef.current && now - lastTargetAtRef.current < 800) {
      return targetWindowRef.current;
    }
    if (targetInFlightRef.current) return targetInFlightRef.current;

    const promise = (async () => {
      let target: ManagedWindow | null = null;
      try {
        target = (await window.electron.getWindowManagementTargetWindow?.()) as ManagedWindow | null;
      } catch {}
      if (!target) {
        try {
          target = (await window.electron.getActiveWindow?.()) as ManagedWindow | null;
        } catch {}
      }
      if (target && !isManageableWindow(target)) {
        target = null;
      }
      targetWindowRef.current = target;
      lastTargetAtRef.current = Date.now();
      setWindowsOnScreen(target ? [target] : []);
      return target;
    })();

    targetInFlightRef.current = promise;
    const result = await promise;
    targetInFlightRef.current = null;
    return result;
  }, []);

  useEffect(() => {
    if (!show || !portalTarget) return;
    setAppliedPreset(null);
    setSelectedIndex(0);
    lastPreviewKeyRef.current = '';
    pendingPreviewRef.current = null;
    previewSeqRef.current += 1;
    setWindowsOnScreen([]);
    targetWindowRef.current = null;
    lastTargetAtRef.current = 0;
    setStatusText('Select a preset to arrange windows.');
    requestAnimationFrame(() => listRef.current?.focus());
  }, [show, portalTarget, loadWindowsForLayout]);

  const applyPresetNow = useCallback(async (presetId: PresetId, options?: { force?: boolean }) => {
    const isAuto = presetId === 'auto-organize';
    const windows = isAuto ? await loadWindowsForLayout(options?.force) : [];
    const target = isAuto ? null : await loadTargetWindow(options?.force);
    const layoutWindows = isAuto ? windows : (target ? [target] : []);
    if (!layoutWindows || layoutWindows.length === 0) {
      setStatusText(isAuto ? 'No movable windows found on this screen.' : 'No target window found.');
      return;
    }

    const previewKey = `${presetId}:${layoutWindows.map((w) => w.id).join(',')}`;
    if (!options?.force && lastPreviewKeyRef.current === previewKey) return;
    lastPreviewKeyRef.current = previewKey;

    const sorted = sortWindowsForLayout(layoutWindows);
    const moves = isAuto
      ? buildAutoLayout(sorted, hostArea)
      : buildCornerLayout(presetId as Exclude<PresetId, 'auto-organize'>, sorted, hostArea);

    if (moves.length === 0) {
      setStatusText('No windows to move.');
      return;
    }

    const seq = ++previewSeqRef.current;
    try {
      await window.electron.setWindowLayout(moves);
      if (seq !== previewSeqRef.current) return;
      setAppliedPreset(presetId);
      if (isAuto) {
        const cols = computeGridColumns(sorted.length);
        setStatusText(`Previewing grid (${cols} col${cols > 1 ? 's' : ''}) for ${sorted.length} windows.`);
      } else {
        setStatusText(`Previewing ${PRESETS.find((p) => p.id === presetId)?.label} layout for ${sorted.length} windows.`);
      }
    } catch (error) {
      console.error('Window preset failed:', error);
      if (seq === previewSeqRef.current) {
        setStatusText('Failed to move windows. Check Accessibility permission.');
      }
    }
  }, [hostArea, loadTargetWindow, loadWindowsForLayout]);

  const drainPreviewQueue = useCallback(async () => {
    if (previewLoopRunningRef.current) return;
    previewLoopRunningRef.current = true;
    try {
      while (pendingPreviewRef.current) {
        const next = pendingPreviewRef.current;
        pendingPreviewRef.current = null;
        await applyPresetNow(next.presetId, { force: next.force });
      }
    } finally {
      previewLoopRunningRef.current = false;
    }
  }, [applyPresetNow]);

  const queuePreview = useCallback((presetId: PresetId, options?: { force?: boolean }) => {
    pendingPreviewRef.current = { presetId, force: options?.force };
    void drainPreviewQueue();
  }, [drainPreviewQueue]);

  useEffect(() => {
    if (!show) return;
    optionRefs.current[selectedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [show, selectedIndex]);

  useEffect(() => {
    if (!show || !portalTarget) return;
    const doc = portalTarget.ownerDocument;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        const nextIndex = (selectedIndex + 1) % PRESETS.length;
        setSelectedIndex(nextIndex);
        const preset = PRESETS[nextIndex];
        if (preset) queuePreview(preset.id);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        const nextIndex = (selectedIndex - 1 + PRESETS.length) % PRESETS.length;
        setSelectedIndex(nextIndex);
        const preset = PRESETS[nextIndex];
        if (preset) queuePreview(preset.id);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const preset = PRESETS[selectedIndex];
        if (!preset) return;
        void (async () => {
          await applyPresetNow(preset.id, { force: true });
          onClose();
        })();
      }
    };
    doc.addEventListener('keydown', onKeyDown, true);
    return () => doc.removeEventListener('keydown', onKeyDown, true);
  }, [show, portalTarget, onClose, selectedIndex, applyPresetNow, queuePreview]);

  if (!show || !portalTarget) return null;

  return createPortal(
    <div
      style={{
        width: '100%',
        height: '100%',
        padding: 8,
        boxSizing: 'border-box',
        fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, sans-serif',
        color: 'rgba(255,255,255,0.96)',
        background: 'transparent',
      }}
    >
      <div
        style={{
          height: '100%',
          borderRadius: 14,
          border: '1px solid rgba(255,255,255,0.12)',
          background: 'linear-gradient(180deg, rgba(14,16,18,0.96), rgba(9,10,12,0.98))',
          boxShadow: '0 18px 46px rgba(0,0,0,0.38)',
          backdropFilter: 'blur(12px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            padding: '8px 12px',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 0.3,
                textTransform: 'uppercase',
                color: 'rgba(180,239,255,0.9)',
              }}
            >
              Window Management
            </div>
            <div
              style={{
                marginTop: 4,
                fontSize: 10.5,
                color: 'rgba(255,255,255,0.62)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: 210,
              }}
            >
              {statusText}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { void loadWindowsForLayout(true); }}
              title="Refresh windows"
              style={{
                fontSize: 10.5,
                color: 'rgba(255,255,255,0.78)',
                cursor: 'pointer',
                padding: '3px 6px',
                borderRadius: 6,
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                userSelect: 'none',
              }}
            >
              Refresh
            </div>
            <div
              onMouseDown={(e) => e.preventDefault()}
              onClick={onClose}
              aria-label="Close"
              title="Close"
              style={{
                width: 22,
                height: 22,
                display: 'grid',
                placeItems: 'center',
                fontSize: 14,
                lineHeight: 1,
                borderRadius: 6,
                color: 'rgba(255,255,255,0.82)',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              ×
            </div>
          </div>
        </div>

        <div
          ref={listRef}
          role="listbox"
          tabIndex={0}
          aria-label="Window management presets"
          onWheel={(event) => {
            event.preventDefault();
            const delta = event.deltaY || 0;
            if (!delta) return;
            const nextIndex = (selectedIndex + (delta > 0 ? 1 : -1) + PRESETS.length) % PRESETS.length;
            setSelectedIndex(nextIndex);
            const preset = PRESETS[nextIndex];
            if (preset) queuePreview(preset.id);
          }}
          style={{
            flex: 1,
            overflowY: 'auto',
            outline: 'none',
            padding: '4px 0',
          }}
        >
          {PRESETS.map((preset, index) => {
            const isSelected = index === selectedIndex;
            const isApplied = appliedPreset === preset.id;
            return (
              <div
                key={preset.id}
                ref={(node) => { optionRefs.current[index] = node; }}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => {
                  setSelectedIndex(index);
                  queuePreview(preset.id);
                }}
                onMouseMove={() => {
                  if (selectedIndex !== index) {
                    setSelectedIndex(index);
                    queuePreview(preset.id);
                  }
                }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setSelectedIndex(index);
                  void (async () => {
                    await applyPresetNow(preset.id, { force: true });
                    onClose();
                  })();
                }}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 12px',
                  minHeight: 40,
                  borderRadius: 0,
                  background: isSelected ? 'rgba(54, 198, 243, 0.12)' : 'transparent',
                  borderLeft: isSelected ? '2px solid rgba(120, 225, 255, 0.8)' : '2px solid transparent',
                  borderBottom: '1px solid rgba(255,255,255,0.05)',
                  cursor: 'default',
                  userSelect: 'none',
                }}
                title={`${preset.label} (${preset.subtitle})`}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.96)' }}>{preset.label}</div>
                  <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.56)' }}>{preset.subtitle}</div>
                </div>
                <div
                  style={{
                    fontSize: 9.5,
                    color: isApplied ? 'rgba(155,239,255,0.94)' : 'rgba(255,255,255,0.38)',
                    letterSpacing: 0.25,
                    textTransform: 'uppercase',
                  }}
                >
                  {isApplied ? 'live' : ''}
                </div>
              </div>
            );
          })}
        </div>

        <div
          style={{
            minHeight: 42,
            padding: '8px 12px 10px',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            color: 'rgba(255,255,255,0.68)',
            fontSize: 10.5,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{windowsOnScreen.length} windows</span>
          <span style={{ color: 'rgba(255,255,255,0.42)', flexShrink: 0 }}>Scroll · ↑↓ · Enter</span>
        </div>
      </div>
    </div>,
    portalTarget
  );
};

export default WindowManagerPanel;
