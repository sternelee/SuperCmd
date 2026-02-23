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

type PresetId =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'center'
  | 'center-80'
  | 'fill'
  | 'auto-organize';

type Rect = { x: number; y: number; width: number; height: number };
type ScreenArea = { left: number; top: number; width: number; height: number };

type LayoutMove = { id: string; bounds: BoundsRect };

interface WindowManagerPanelProps {
  show: boolean;
  portalTarget?: HTMLElement | null;
  onClose: () => void;
}

const PRESETS: Array<{ id: PresetId; label: string; subtitle: string }> = [
  { id: 'left', label: 'Left', subtitle: 'Current window' },
  { id: 'right', label: 'Right', subtitle: 'Current window' },
  { id: 'top', label: 'Top', subtitle: 'Current window' },
  { id: 'bottom', label: 'Bottom', subtitle: 'Current window' },
  { id: 'center', label: 'Center', subtitle: 'Current window' },
  { id: 'center-80', label: 'Center 80%', subtitle: 'Current window' },
  { id: 'fill', label: 'Fill', subtitle: 'Current window' },
  { id: 'top-left', label: 'Top Left', subtitle: 'Current window' },
  { id: 'top-right', label: 'Top Right', subtitle: 'Current window' },
  { id: 'bottom-right', label: 'Bottom Right', subtitle: 'Current window' },
  { id: 'bottom-left', label: 'Bottom Left', subtitle: 'Current window' },
  { id: 'auto-organize', label: 'Auto organise', subtitle: 'All windows on this screen' },
];

const MULTI_WINDOW_PRESETS = new Set<PresetId>(['auto-organize']);

function renderPresetIcon(id: PresetId): JSX.Element {
  const cells: Array<{ x: number; y: number; w: number; h: number }> = [];
  switch (id) {
    case 'top-left':
      cells.push({ x: 1, y: 1, w: 9, h: 6 });
      break;
    case 'top-right':
      cells.push({ x: 10, y: 1, w: 9, h: 6 });
      break;
    case 'bottom-left':
      cells.push({ x: 1, y: 7, w: 9, h: 6 });
      break;
    case 'bottom-right':
      cells.push({ x: 10, y: 7, w: 9, h: 6 });
      break;
    case 'left':
      cells.push({ x: 1, y: 1, w: 9, h: 12 });
      break;
    case 'right':
      cells.push({ x: 10, y: 1, w: 9, h: 12 });
      break;
    case 'top':
      cells.push({ x: 1, y: 1, w: 18, h: 6 });
      break;
    case 'bottom':
      cells.push({ x: 1, y: 7, w: 18, h: 6 });
      break;
    case 'fill':
      cells.push({ x: 1, y: 1, w: 18, h: 12 });
      break;
    case 'center':
      cells.push({ x: 4, y: 3, w: 12, h: 8 });
      break;
    case 'center-80':
      cells.push({ x: 3, y: 2, w: 14, h: 10 });
      break;
    case 'auto-organize':
      cells.push(
        { x: 1, y: 1, w: 8, h: 5 },
        { x: 11, y: 1, w: 8, h: 5 },
        { x: 1, y: 8, w: 8, h: 5 },
        { x: 11, y: 8, w: 8, h: 5 }
      );
      break;
    default:
      cells.push({ x: 1, y: 1, w: 18, h: 12 });
      break;
  }

  return (
    <svg width={20} height={14} viewBox="0 0 20 14" fill="none" aria-hidden="true">
      <rect
        x={0.75}
        y={0.75}
        width={18.5}
        height={12.5}
        rx={2}
        stroke="currentColor"
        strokeWidth={1}
        strokeOpacity={0.5}
      />
      {cells.map((cell, index) => (
        <rect
          key={`${id}-${index}`}
          x={cell.x}
          y={cell.y}
          width={cell.w}
          height={cell.h}
          rx={1}
          fill="currentColor"
          fillOpacity={0.6}
        />
      ))}
    </svg>
  );
}

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

function getHostMetrics(hostWindow: Window | null | undefined): ScreenArea {
  const target = hostWindow || window;
  const screenObj = target.screen as any;
  return {
    left: Number(screenObj?.availLeft ?? 0) || 0,
    top: Number(screenObj?.availTop ?? 0) || 0,
    width: Number(screenObj?.availWidth ?? target.innerWidth ?? 1440) || 1440,
    height: Number(screenObj?.availHeight ?? target.innerHeight ?? 900) || 900,
  };
}

function normalizeScreenArea(raw: any, fallback: ScreenArea): ScreenArea {
  const x = Number(raw?.x);
  const y = Number(raw?.y);
  const width = Number(raw?.width);
  const height = Number(raw?.height);
  if (![x, y, width, height].every((value) => Number.isFinite(value))) {
    return fallback;
  }
  return {
    left: Math.round(x),
    top: Math.round(y),
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
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

function computeGridDimensions(count: number, region: Rect): { cols: number; rows: number } {
  const total = Math.max(1, Math.floor(count));
  const width = Math.max(1, Math.floor(region.width));
  const height = Math.max(1, Math.floor(region.height));
  const targetAspect = width / height;
  let bestCols = 1;
  let bestRows = total;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let cols = 1; cols <= total; cols += 1) {
    const rows = Math.ceil(total / cols);
    const gridAspect = cols / rows;
    const empty = rows * cols - total;
    const score = Math.abs(gridAspect - targetAspect) + empty * 0.08;
    if (score < bestScore) {
      bestScore = score;
      bestCols = cols;
      bestRows = rows;
    }
  }

  return { cols: Math.max(1, bestCols), rows: Math.max(1, bestRows) };
}

function computeGridRects(
  count: number,
  region: Rect,
  options?: { gap?: number; padding?: number; cols?: number }
): Rect[] {
  if (count <= 0) return [];
  const gap = Math.max(0, options?.gap ?? 8);
  const padded = shrinkRect(region, options?.padding ?? 8);
  const requestedCols = options?.cols ? Math.max(1, Math.floor(options.cols)) : null;
  const resolvedCols = requestedCols ? Math.min(requestedCols, Math.max(1, count)) : null;
  const { cols, rows } = resolvedCols
    ? { cols: resolvedCols, rows: Math.max(1, Math.ceil(count / resolvedCols)) }
    : computeGridDimensions(count, padded);
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

function splitVertical(area: ScreenArea): { left: Rect; right: Rect } {
  const leftW = Math.max(1, Math.floor(area.width / 2));
  const rightW = Math.max(1, area.width - leftW);
  return {
    left: { x: area.left, y: area.top, width: leftW, height: area.height },
    right: { x: area.left + leftW, y: area.top, width: rightW, height: area.height },
  };
}

function splitHorizontal(area: ScreenArea): { top: Rect; bottom: Rect } {
  const topH = Math.max(1, Math.floor(area.height / 2));
  const bottomH = Math.max(1, area.height - topH);
  return {
    top: { x: area.left, y: area.top, width: area.width, height: topH },
    bottom: { x: area.left, y: area.top + topH, width: area.width, height: bottomH },
  };
}

function getWindowWidthHint(window?: ManagedWindow): number {
  return Math.max(1, Math.round(window?.bounds?.size?.width || 0));
}

function getWindowHeightHint(window?: ManagedWindow): number {
  return Math.max(1, Math.round(window?.bounds?.size?.height || 0));
}

function getGroupWidthHint(windows: ManagedWindow[]): number {
  if (windows.length === 0) return 1;
  return Math.max(...windows.map((win) => getWindowWidthHint(win)));
}

function getGroupHeightHint(windows: ManagedWindow[]): number {
  if (windows.length === 0) return 1;
  return Math.max(...windows.map((win) => getWindowHeightHint(win)));
}

function splitVerticalSmart(
  area: ScreenArea,
  leftWindows: ManagedWindow[],
  rightWindows: ManagedWindow[]
): { left: Rect; right: Rect } {
  const desiredLeft = getGroupWidthHint(leftWindows);
  const desiredRight = getGroupWidthHint(rightWindows);
  const maxLeft = Math.max(1, area.width - desiredRight);
  let leftW = Math.max(1, Math.min(Math.max(Math.floor(area.width / 2), desiredLeft), maxLeft));
  let rightW = Math.max(1, area.width - leftW);
  if (rightW < desiredRight) {
    rightW = desiredRight;
    leftW = Math.max(1, area.width - rightW);
  }

  return {
    left: { x: area.left, y: area.top, width: leftW, height: area.height },
    right: { x: area.left + leftW, y: area.top, width: Math.max(1, area.width - leftW), height: area.height },
  };
}

function splitHorizontalSmart(
  area: ScreenArea,
  topWindows: ManagedWindow[],
  bottomWindows: ManagedWindow[]
): { top: Rect; bottom: Rect } {
  const desiredTop = getGroupHeightHint(topWindows);
  const desiredBottom = getGroupHeightHint(bottomWindows);
  const maxTop = Math.max(1, area.height - desiredBottom);
  let topH = Math.max(1, Math.min(Math.max(Math.floor(area.height / 2), desiredTop), maxTop));
  let bottomH = Math.max(1, area.height - topH);
  if (bottomH < desiredBottom) {
    bottomH = desiredBottom;
    topH = Math.max(1, area.height - bottomH);
  }

  return {
    top: { x: area.left, y: area.top, width: area.width, height: topH },
    bottom: { x: area.left, y: area.top + topH, width: area.width, height: Math.max(1, area.height - topH) },
  };
}

function pushLeftIfOverflow(rect: Rect, area: ScreenArea, window?: ManagedWindow): Rect {
  const currentWidth = Math.max(0, Math.round(window?.bounds?.size?.width || 0));
  const effectiveWidth = Math.max(Math.round(rect.width), currentWidth);
  const maxX = area.left + area.width - effectiveWidth;
  let x = Math.round(rect.x);
  if (x > maxX) {
    x = maxX;
  }
  if (x < area.left) {
    x = area.left;
  }
  return { ...rect, x };
}

function fitRectWithinArea(rect: Rect, area: ScreenArea, window?: ManagedWindow): Rect {
  return pushLeftIfOverflow(pushUpIfOverflow(rect, area, window), area, window);
}

function pushUpIfOverflow(rect: Rect, area: ScreenArea, window?: ManagedWindow): Rect {
  const currentHeight = Math.max(0, Math.round(window?.bounds?.size?.height || 0));
  const effectiveHeight = Math.max(Math.round(rect.height), currentHeight);
  const maxY = area.top + area.height - effectiveHeight;
  let y = Math.round(rect.y);
  if (y > maxY) {
    y = maxY;
  }
  if (y < area.top) {
    y = area.top;
  }
  return { ...rect, y };
}

function getPresetRegion(presetId: PresetId, area: ScreenArea): Rect | null {
  if (presetId === 'top-left' || presetId === 'top-right' || presetId === 'bottom-left' || presetId === 'bottom-right') {
    const quadrants = splitQuadrants(area, { padding: 0, gap: 0 });
    return quadrants[presetId];
  }
  if (presetId === 'left' || presetId === 'right') {
    const split = splitVertical(area);
    return presetId === 'left' ? split.left : split.right;
  }
  if (presetId === 'top' || presetId === 'bottom') {
    const split = splitHorizontal(area);
    return presetId === 'top' ? split.top : split.bottom;
  }
  if (presetId === 'fill') {
    return { x: area.left, y: area.top, width: area.width, height: area.height };
  }
  if (presetId === 'center') {
    const width = Math.max(1, Math.round(area.width * 0.6));
    const height = Math.max(1, Math.round(area.height * 0.6));
    const x = area.left + Math.round((area.width - width) / 2);
    const y = area.top + Math.round((area.height - height) / 2);
    return { x, y, width, height };
  }
  if (presetId === 'center-80') {
    const width = Math.max(1, Math.round(area.width * 0.8));
    const height = Math.max(1, Math.round(area.height * 0.8));
    const x = area.left + Math.round((area.width - width) / 2);
    const y = area.top + Math.round((area.height - height) / 2);
    return { x, y, width, height };
  }
  return null;
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
  if (windows.length === 2) {
    const split = splitVertical(area);
    return [
      { id: windows[0].id, bounds: rectToBounds(split.left) },
      { id: windows[1].id, bounds: rectToBounds(split.right) },
    ];
  }
  if (windows.length === 3) {
    return buildAutoFill3Layout(windows, area);
  }
  const rects = computeGridRects(
    windows.length,
    { x: area.left, y: area.top, width: area.width, height: area.height },
    { padding: 0, gap: 0 }
  );
  return windows.map((win, index) => ({
    id: win.id,
    bounds: rectToBounds(pushUpIfOverflow(rects[index], area, win)),
  }));
}

function buildAutoOrganizeLayout(windows: ManagedWindow[], area: ScreenArea): LayoutMove[] {
  const targets = windows.slice(0, 4);
  if (targets.length === 0) return [];
  if (targets.length === 1) {
    return [{ id: targets[0].id, bounds: rectToBounds({ x: area.left, y: area.top, width: area.width, height: area.height }) }];
  }
  if (targets.length === 2) {
    const split = splitVertical(area);
    return [
      { id: targets[0].id, bounds: rectToBounds(split.left) },
      { id: targets[1].id, bounds: rectToBounds(split.right) },
    ];
  }
  if (targets.length === 3) {
    const split = splitVertical(area);
    const rightArea: ScreenArea = {
      left: split.right.x,
      top: split.right.y,
      width: split.right.width,
      height: split.right.height,
    };
    const rightSplit = splitHorizontal(rightArea);
    return [
      { id: targets[0].id, bounds: rectToBounds(split.left) },
      { id: targets[1].id, bounds: rectToBounds(rightSplit.top) },
      { id: targets[2].id, bounds: rectToBounds(rightSplit.bottom) },
    ];
  }

  const quadrants = splitQuadrants(area, { padding: 0, gap: 0 });
  return [
    { id: targets[0].id, bounds: rectToBounds(quadrants['top-left']) },
    { id: targets[1].id, bounds: rectToBounds(quadrants['bottom-left']) },
    { id: targets[2].id, bounds: rectToBounds(quadrants['top-right']) },
    { id: targets[3].id, bounds: rectToBounds(quadrants['bottom-right']) },
  ];
}

function buildAutoFill3Layout(windows: ManagedWindow[], area: ScreenArea): LayoutMove[] {
  const targets = windows.slice(0, 3);
  if (targets.length === 0) return [];
  if (targets.length === 1) {
    return [{ id: targets[0].id, bounds: rectToBounds({ x: area.left, y: area.top, width: area.width, height: area.height }) }];
  }
  if (targets.length === 2) {
    const split = splitVertical(area);
    return [
      { id: targets[0].id, bounds: rectToBounds(split.left) },
      { id: targets[1].id, bounds: rectToBounds(split.right) },
    ];
  }

  const leftW = Math.max(1, Math.floor(area.width / 2));
  const rightW = Math.max(1, area.width - leftW);

  const minTop = Math.max(1, Math.round(targets[1]?.bounds?.size?.height || 0));
  const minBottom = Math.max(1, Math.round(targets[2]?.bounds?.size?.height || 0));
  const maxTop = Math.max(1, area.height - minBottom);
  const topH = Math.max(1, Math.min(Math.max(Math.floor(area.height / 2), minTop), maxTop));
  let bottomH = Math.max(1, area.height - topH);
  if (bottomH < minBottom) {
    bottomH = minBottom;
  }
  const adjustedTopH = Math.max(1, area.height - bottomH);

  return [
    {
      id: targets[0].id,
      bounds: rectToBounds({ x: area.left, y: area.top, width: leftW, height: area.height }),
    },
    {
      id: targets[1].id,
      bounds: rectToBounds({ x: area.left + leftW, y: area.top, width: rightW, height: adjustedTopH }),
    },
    {
      id: targets[2].id,
      bounds: rectToBounds(
        pushUpIfOverflow(
          { x: area.left + leftW, y: area.top + adjustedTopH, width: rightW, height: bottomH },
          area,
          targets[2]
        )
      ),
    },
  ];
}

function buildAutoFill4Layout(windows: ManagedWindow[], area: ScreenArea): LayoutMove[] {
  const targets = windows.slice(0, 4);
  if (targets.length === 0) return [];
  if (targets.length <= 2) {
    return buildAutoFill3Layout(targets, area);
  }
  if (targets.length === 3) {
    return buildAutoFill3Layout(targets, area);
  }

  const minLeftW = Math.max(
    1,
    Math.round(Math.max(targets[0]?.bounds?.size?.width || 0, targets[2]?.bounds?.size?.width || 0))
  );
  const minRightW = Math.max(
    1,
    Math.round(Math.max(targets[1]?.bounds?.size?.width || 0, targets[3]?.bounds?.size?.width || 0))
  );
  const maxLeft = Math.max(1, area.width - minRightW);
  const leftW = Math.max(1, Math.min(Math.max(Math.floor(area.width / 2), minLeftW), maxLeft));
  const rightW = Math.max(1, area.width - leftW);

  const minTopH = Math.max(
    1,
    Math.round(Math.max(targets[0]?.bounds?.size?.height || 0, targets[1]?.bounds?.size?.height || 0))
  );
  const minBottomH = Math.max(
    1,
    Math.round(Math.max(targets[2]?.bounds?.size?.height || 0, targets[3]?.bounds?.size?.height || 0))
  );
  const maxTop = Math.max(1, area.height - minBottomH);
  let topH = Math.max(1, Math.min(Math.max(Math.floor(area.height / 2), minTopH), maxTop));
  let bottomH = Math.max(1, area.height - topH);
  if (bottomH < minBottomH) {
    bottomH = minBottomH;
    topH = Math.max(1, area.height - bottomH);
  }

  return [
    {
      id: targets[0].id,
      bounds: rectToBounds({ x: area.left, y: area.top, width: leftW, height: topH }),
    },
    {
      id: targets[1].id,
      bounds: rectToBounds({ x: area.left + leftW, y: area.top, width: rightW, height: topH }),
    },
    {
      id: targets[2].id,
      bounds: rectToBounds(
        pushUpIfOverflow(
          { x: area.left, y: area.top + topH, width: leftW, height: bottomH },
          area,
          targets[2]
        )
      ),
    },
    {
      id: targets[3].id,
      bounds: rectToBounds(
        pushUpIfOverflow(
          { x: area.left + leftW, y: area.top + topH, width: rightW, height: bottomH },
          area,
          targets[3]
        )
      ),
    },
  ];
}

const WindowManagerPanel: React.FC<WindowManagerPanelProps> = ({ show, portalTarget, onClose }) => {
  const [windowsOnScreen, setWindowsOnScreen] = useState<ManagedWindow[]>([]);
  const [statusText, setStatusText] = useState('Select a preset to arrange windows.');
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [appliedPreset, setAppliedPreset] = useState<PresetId | null>(null);

  const windowsOnScreenRef = useRef<ManagedWindow[]>([]);
  const previewSeqRef = useRef(0);
  const lastPreviewKeyRef = useRef('');
  const previewLoopRunningRef = useRef(false);
  const pendingPreviewRef = useRef<{ presetId: PresetId; force?: boolean } | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const liquidHighlightRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);
  const inventoryInFlightRef = useRef<Promise<ManagedWindow[]> | null>(null);
  const lastInventoryAtRef = useRef(0);
  const targetWindowRef = useRef<ManagedWindow | null>(null);
  const layoutAreaRef = useRef<ScreenArea | null>(null);
  const contextInFlightRef = useRef<Promise<{ target: ManagedWindow | null; area: ScreenArea } | null> | null>(null);
  const lastContextAtRef = useRef(0);

  useEffect(() => {
    windowsOnScreenRef.current = windowsOnScreen;
  }, [windowsOnScreen]);

  const hostWindow = portalTarget?.ownerDocument?.defaultView || null;
  const hostArea = useMemo(() => getHostMetrics(hostWindow), [hostWindow]);

  const loadContext = useCallback(async (force?: boolean) => {
    const now = Date.now();
    if (!force && layoutAreaRef.current && now - lastContextAtRef.current < 800) {
      return {
        target: targetWindowRef.current,
        area: layoutAreaRef.current,
      };
    }
    if (contextInFlightRef.current) return contextInFlightRef.current;

    const promise = (async () => {
      let target: ManagedWindow | null = null;
      let workAreaRaw: any = null;
      try {
        const ctx = await window.electron.getWindowManagementContext?.();
        if (ctx) {
          target = ctx.target as ManagedWindow | null;
          workAreaRaw = ctx.workArea;
        }
      } catch {}
      if (!target) {
        try {
          target = (await window.electron.getWindowManagementTargetWindow?.()) as ManagedWindow | null;
        } catch {}
      }
      if (!target) {
        try {
          target = (await window.electron.getActiveWindow?.()) as ManagedWindow | null;
        } catch {}
      }
      if (target && !isManageableWindow(target)) {
        target = null;
      }

      const area = normalizeScreenArea(workAreaRaw, hostArea);
      layoutAreaRef.current = area;
      lastContextAtRef.current = Date.now();
      targetWindowRef.current = target;
      setWindowsOnScreen(target ? [target] : []);
      return { target, area };
    })();

    contextInFlightRef.current = promise;
    const result = await promise;
    contextInFlightRef.current = null;
    return result;
  }, [hostArea]);

  const loadWindowsForLayout = useCallback(async (force?: boolean) => {
    const now = Date.now();
    if (!force && windowsOnScreenRef.current.length > 0 && now - lastInventoryAtRef.current < 800) {
      return windowsOnScreenRef.current;
    }
    if (inventoryInFlightRef.current) return inventoryInFlightRef.current;

    const promise = (async () => {
      const context = await loadContext(force);
      const area = context?.area ?? hostArea;
      let all: ManagedWindow[] = [];
      try {
        all = ((await window.electron.getWindowsOnActiveDesktop()) || []) as ManagedWindow[];
      } catch {
        all = [];
      }
      const screenWindows = all
        .filter(isManageableWindow)
        .filter((win) => isWindowOnScreenArea(win, area));
      windowsOnScreenRef.current = screenWindows;
      setWindowsOnScreen(screenWindows);
      lastInventoryAtRef.current = Date.now();
      return screenWindows;
    })();

    inventoryInFlightRef.current = promise;
    const result = await promise;
    inventoryInFlightRef.current = null;
    return result;
  }, [hostArea, loadContext]);

  useEffect(() => {
    if (!show || !portalTarget) return;
    setAppliedPreset(null);
    setSelectedIndex(-1);
    lastPreviewKeyRef.current = '';
    pendingPreviewRef.current = null;
    previewSeqRef.current += 1;
    setWindowsOnScreen([]);
    targetWindowRef.current = null;
    layoutAreaRef.current = null;
    lastContextAtRef.current = 0;
    setStatusText('Select a preset to arrange windows.');
    requestAnimationFrame(() => listRef.current?.focus());
  }, [show, portalTarget, loadWindowsForLayout]);

  const applyPresetNow = useCallback(async (presetId: PresetId, options?: { force?: boolean }) => {
    const isMultiWindow = MULTI_WINDOW_PRESETS.has(presetId);
    const context = await loadContext(options?.force);
    const layoutArea = context?.area ?? hostArea;
    const windows = isMultiWindow ? await loadWindowsForLayout(options?.force) : [];
    const target = isMultiWindow ? null : context?.target ?? null;
    const layoutWindows = isMultiWindow ? windows : (target ? [target] : []);
    if (!layoutWindows || layoutWindows.length === 0) {
      setStatusText(isMultiWindow ? 'No movable windows found on this screen.' : 'No target window found.');
      return;
    }

    const orderedAll = presetId === 'auto-organize' ? layoutWindows : sortWindowsForLayout(layoutWindows);
    const layoutTargets = presetId === 'auto-organize' ? orderedAll.slice(0, 4) : orderedAll;
    const previewIds = layoutTargets.map((w) => w.id);
    const previewKey = `${presetId}:${previewIds.join(',')}`;
    if (!options?.force && lastPreviewKeyRef.current === previewKey) return;
    lastPreviewKeyRef.current = previewKey;
    let moves: LayoutMove[] = [];
    let movedCount = layoutTargets.length;
    if (isMultiWindow) {
      if (presetId === 'auto-organize') {
        moves = buildAutoOrganizeLayout(layoutTargets, layoutArea);
        movedCount = Math.min(layoutTargets.length, 4);
      } else {
        moves = buildAutoLayout(layoutTargets, layoutArea);
      }
    } else {
      const region = getPresetRegion(presetId, layoutArea);
      if (region && target) {
        const adjusted = (presetId === 'bottom-left' || presetId === 'bottom-right' || presetId === 'bottom')
          ? pushUpIfOverflow(region, layoutArea, target)
          : region;
        moves = [{ id: target.id, bounds: rectToBounds(adjusted) }];
        movedCount = 1;
      }
    }

    if (moves.length === 0) {
      setStatusText('No windows to move.');
      return;
    }

    const seq = ++previewSeqRef.current;
    try {
      await window.electron.setWindowLayout(moves);
      if (seq !== previewSeqRef.current) return;
      setAppliedPreset(presetId);
      if (isMultiWindow) {
        if (presetId === 'auto-organize') {
          setStatusText(`Previewing Auto organise for ${movedCount} of ${orderedAll.length} windows.`);
        } else {
          const cols = computeGridDimensions(orderedAll.length, {
            x: layoutArea.left,
            y: layoutArea.top,
            width: layoutArea.width,
            height: layoutArea.height,
          }).cols;
          setStatusText(`Previewing grid (${cols} col${cols > 1 ? 's' : ''}) for ${orderedAll.length} windows.`);
        }
      } else {
        setStatusText(`Previewing ${PRESETS.find((p) => p.id === presetId)?.label} layout for ${layoutTargets.length} windows.`);
      }
    } catch (error) {
      console.error('Window preset failed:', error);
      if (seq === previewSeqRef.current) {
        setStatusText('Failed to move windows. Check Accessibility permission.');
      }
    }
  }, [hostArea, loadContext, loadWindowsForLayout]);

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
    if (selectedIndex >= 0) {
      optionRefs.current[selectedIndex]?.scrollIntoView({ block: 'nearest' });
    }
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
        const nextIndex = selectedIndex < 0 ? 0 : (selectedIndex + 1) % PRESETS.length;
        setSelectedIndex(nextIndex);
        const preset = PRESETS[nextIndex];
        if (preset) queuePreview(preset.id);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        const nextIndex = selectedIndex < 0 ? PRESETS.length - 1 : (selectedIndex - 1 + PRESETS.length) % PRESETS.length;
        setSelectedIndex(nextIndex);
        const preset = PRESETS[nextIndex];
        if (preset) queuePreview(preset.id);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        if (selectedIndex < 0) return;
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

  useEffect(() => {
    if (!show || !hostWindow) return;
    const onBlur = () => onClose();
    hostWindow.addEventListener('blur', onBlur);
    return () => hostWindow.removeEventListener('blur', onBlur);
  }, [show, hostWindow, onClose]);

  const handleGlassMouseMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const highlight = liquidHighlightRef.current;
    if (!highlight) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    highlight.style.opacity = '0.58';
    highlight.style.transform = `translate3d(${Math.round(x - 130)}px, ${Math.round(y - 130)}px, 0)`;
  }, []);

  const handleGlassMouseLeave = useCallback(() => {
    const highlight = liquidHighlightRef.current;
    if (!highlight) return;
    highlight.style.opacity = '0';
  }, []);

  if (!show || !portalTarget) return null;

  return createPortal(
    <div
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            onClose();
          }
        }}
        style={{
          width: '100%',
          height: '100%',
          padding: 0,
          boxSizing: 'border-box',
          fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, sans-serif',
          color: 'rgba(255,255,255,0.96)',
          background: 'transparent',
        }}
      >
        <div
          onMouseDown={(event) => event.stopPropagation()}
          onMouseMove={handleGlassMouseMove}
          onMouseLeave={handleGlassMouseLeave}
          style={{
            width: '100%',
            height: '100%',
            borderRadius: 20,
            border: '1px solid rgba(255,255,255,0.20)',
            background: 'rgba(34,34,38,0.34)',
            boxShadow: [
              '0 22px 44px -14px rgba(0,0,0,0.34)',
              'inset 0 3px 20px rgba(255,255,255,0.17)',
              'inset 0 -3px 18px rgba(0,0,0,0.20)',
            ].join(', '),
            backdropFilter: 'blur(34px) saturate(185%)',
            WebkitBackdropFilter: 'blur(34px) saturate(185%)',
            position: 'relative',
            overflow: 'hidden',
            isolation: 'isolate',
          }}
        >
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 1,
              borderRadius: 19,
              background: 'rgba(255,255,255,0.01)',
              boxShadow: [
                'inset 0 1px 0 rgba(255,255,255,0.12)',
                'inset 0 0 0 1px rgba(255,255,255,0.03)',
              ].join(', '),
              pointerEvents: 'none',
              zIndex: 1,
            }}
          />
          <div
            ref={liquidHighlightRef}
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: 260,
              height: 260,
              borderRadius: '50%',
              background:
                'radial-gradient(circle, rgba(255,255,255,0.34) 8%, rgba(255,255,255,0.16) 30%, transparent 70%)',
              filter: 'blur(34px)',
              opacity: 0,
              transform: 'translate3d(-400px, -400px, 0)',
              transition: 'opacity 140ms ease-out',
              mixBlendMode: 'screen',
              pointerEvents: 'none',
              zIndex: 1,
            }}
          />

          <div
            style={{
              position: 'relative',
              zIndex: 2,
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                padding: '8px 12px',
                borderBottom: '1px solid rgba(255,255,255,0.12)',
                background: 'rgba(255,255,255,0.03)',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: 0.3,
                    textTransform: 'uppercase',
                    color: 'rgba(255,255,255,0.92)',
                  }}
                >
                  Window Management
                </div>
                <div
                  style={{
                    marginTop: 4,
                    fontSize: 10.5,
                    color: 'rgba(255,255,255,0.66)',
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
                    color: 'rgba(255,255,255,0.88)',
                    cursor: 'pointer',
                    padding: '3px 6px',
                    borderRadius: 10,
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.16)',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.10)',
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
                    borderRadius: 10,
                    color: 'rgba(255,255,255,0.9)',
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.16)',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.10)',
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
                const nextIndex = selectedIndex < 0
                  ? (delta > 0 ? 0 : PRESETS.length - 1)
                  : (selectedIndex + (delta > 0 ? 1 : -1) + PRESETS.length) % PRESETS.length;
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
                const iconColor = isSelected ? 'rgba(255,255,255,0.96)' : 'rgba(255,255,255,0.62)';
                return (
                  <div
                    key={preset.id}
                    ref={(node) => { optionRefs.current[index] = node; }}
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => {
                      setSelectedIndex(index);
                    }}
                    onMouseMove={() => {
                      if (selectedIndex !== index) {
                        setSelectedIndex(index);
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
                      gridTemplateColumns: '28px 1fr auto',
                      alignItems: 'center',
                      gap: 8,
                      padding: '9px 12px',
                      minHeight: 38,
                      borderRadius: 0,
                      background: isSelected ? 'rgba(255,255,255,0.16)' : 'transparent',
                      borderLeft: isSelected ? '2px solid rgba(255,255,255,0.82)' : '2px solid transparent',
                      borderBottom: '1px solid rgba(255,255,255,0.055)',
                      cursor: 'default',
                      userSelect: 'none',
                    }}
                    title={preset.label}
                  >
                    <div style={{ width: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', color: iconColor }}>
                      {renderPresetIcon(preset.id)}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.96)' }}>{preset.label}</div>
                    </div>
                    <div
                      style={{
                        fontSize: 9.5,
                        color: isApplied ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.42)',
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
                borderTop: '1px solid rgba(255,255,255,0.12)',
                background: 'rgba(255,255,255,0.025)',
                color: 'rgba(255,255,255,0.76)',
                fontSize: 10.5,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{windowsOnScreen.length} windows</span>
              <span style={{ color: 'rgba(255,255,255,0.5)', flexShrink: 0 }}>Scroll · ↑↓ · Enter</span>
            </div>
          </div>
        </div>
      </div>,
    portalTarget
  );
};

export default WindowManagerPanel;
