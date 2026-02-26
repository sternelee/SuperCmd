import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  Calendar,
  CalendarClock,
  Check,
  ChevronDown,
  Clipboard,
  Clock,
  ExternalLink,
  Files,
  Globe,
  Link2,
  Pencil,
  Plus,
  Trash2,
  Variable,
  X,
} from 'lucide-react';
import type { QuickLink, QuickLinkIcon, Snippet } from '../types/electron';
import ExtensionActionFooter from './components/ExtensionActionFooter';
import {
  getQuickLinkIconLabel,
  getQuickLinkIconOption,
  normalizeQuickLinkIconValue,
  QUICK_LINK_DEFAULT_ICON,
  QUICK_LINK_ICON_OPTIONS,
  renderQuickLinkIconGlyph,
} from './utils/quicklink-icons';

interface QuickLinkManagerProps {
  onClose: () => void;
  initialView: 'search' | 'create';
}

interface ApplicationOption {
  name: string;
  path: string;
  bundleId?: string;
  iconDataUrl?: string;
}

type QuickLinkPayload = {
  name: string;
  urlTemplate: string;
  applicationName?: string;
  applicationPath?: string;
  applicationBundleId?: string;
  appIconDataUrl?: string;
  icon: QuickLinkIcon;
};

type PlaceholderGroupItem = {
  label: string;
  value: string;
  icon?: React.ComponentType<{ className?: string }>;
  subtitle?: string;
};

type PlaceholderGroup = {
  title: string;
  items: PlaceholderGroupItem[];
};

const QUICK_LINK_COMMAND_PREFIX = 'quicklink-';
const MAX_VISIBLE_ICON_RESULTS = 5;

const BASE_PLACEHOLDER_GROUPS: PlaceholderGroup[] = [
  {
    title: 'Dynamic Values',
    items: [
      { label: 'Clipboard Text', value: '{clipboard}', icon: Clipboard },
      { label: 'Date', value: '{date}', icon: Calendar },
      { label: 'Time', value: '{time}', icon: Clock },
      { label: 'Date + Time', value: '{date:YYYY-MM-DD} {time:HH:mm}', icon: CalendarClock },
      { label: 'Custom Argument', value: '{argument name="Value"}', icon: Variable },
    ],
  },
];

function isLikelyUrlTemplate(template: string): boolean {
  const normalized = String(template || '').trim();
  if (!normalized) return false;

  const candidate = normalized.replace(/\{[^}]+\}/g, 'placeholder');
  if (/^mailto:/i.test(candidate)) return true;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) return false;

  try {
    const parsed = new URL(candidate);
    return Boolean(parsed.protocol);
  } catch {
    return false;
  }
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getQuickLinkCommandId(id: string): string {
  return `${QUICK_LINK_COMMAND_PREFIX}${id}`;
}

function getApplicationSortKey(app: ApplicationOption): string {
  return String(app.name || '').trim().toLowerCase();
}

function pickDefaultApplication(apps: ApplicationOption[]): ApplicationOption | null {
  if (!apps.length) return null;

  const browserHints = ['chrome', 'safari', 'firefox', 'arc', 'edge', 'brave', 'opera', 'vivaldi'];
  const browser = apps.find((app) => {
    const key = `${app.name} ${app.bundleId || ''}`.toLowerCase();
    return browserHints.some((hint) => key.includes(hint));
  });
  return browser || apps[0] || null;
}

const QuickLinkIconPreview: React.FC<{
  icon: QuickLinkIcon;
  appIconDataUrl?: string;
}> = ({ icon, appIconDataUrl }) => {
  const normalizedIcon = normalizeQuickLinkIconValue(icon);
  if (normalizedIcon === QUICK_LINK_DEFAULT_ICON && appIconDataUrl) {
    return <img src={appIconDataUrl} alt="" className="w-4 h-4 object-contain" draggable={false} />;
  }
  return <>{renderQuickLinkIconGlyph(normalizedIcon, 'w-4 h-4 text-white/70')}</>;
};

interface QuickLinkFormProps {
  quickLink?: QuickLink;
  onSave: (payload: QuickLinkPayload) => Promise<void> | void;
  onCancel: () => void;
}

const QuickLinkForm: React.FC<QuickLinkFormProps> = ({ quickLink, onSave, onCancel }) => {
  const [name, setName] = useState(quickLink?.name || '');
  const [urlTemplate, setUrlTemplate] = useState(quickLink?.urlTemplate || '');
  const [icon, setIcon] = useState<QuickLinkIcon>(normalizeQuickLinkIconValue(quickLink?.icon || QUICK_LINK_DEFAULT_ICON));
  const [applications, setApplications] = useState<ApplicationOption[]>([]);
  const [selectedAppPath, setSelectedAppPath] = useState(quickLink?.applicationPath || '');
  const [appIconDataUrl, setAppIconDataUrl] = useState<string | undefined>(quickLink?.appIconDataUrl);
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [showPlaceholderMenu, setShowPlaceholderMenu] = useState(false);
  const [placeholderQuery, setPlaceholderQuery] = useState('');
  const [showApplicationMenu, setShowApplicationMenu] = useState(false);
  const [showIconMenu, setShowIconMenu] = useState(false);
  const [iconQuery, setIconQuery] = useState('');
  const [applicationIcons, setApplicationIcons] = useState<Record<string, string>>({});
  const appIconFetchAttemptedRef = useRef<Set<string>>(new Set());
  const [placeholderMenuPos, setPlaceholderMenuPos] = useState<{ top: number; left: number; width: number; maxHeight: number }>({
    top: 0,
    left: 0,
    width: 280,
    maxHeight: 260,
  });
  const [applicationMenuPos, setApplicationMenuPos] = useState<{ top: number; left: number; width: number; maxHeight: number }>({
    top: 0,
    left: 0,
    width: 340,
    maxHeight: 280,
  });
  const [iconMenuPos, setIconMenuPos] = useState<{ top: number; left: number; width: number; maxHeight: number }>({
    top: 0,
    left: 0,
    width: 300,
    maxHeight: 260,
  });

  const nameRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const placeholderButtonRef = useRef<HTMLButtonElement>(null);
  const applicationButtonRef = useRef<HTMLButtonElement>(null);
  const iconButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const loadContextData = useCallback(async () => {
    try {
      const [appsRaw, snippetsRaw] = await Promise.all([
        window.electron.getApplications(),
        window.electron.snippetGetAll(),
      ]);

      const apps = (appsRaw || [])
        .map((app) => ({
          name: String(app?.name || '').trim(),
          path: String(app?.path || '').trim(),
          bundleId: String(app?.bundleId || '').trim() || undefined,
          iconDataUrl: String(app?.iconDataUrl || '').trim() || undefined,
        }))
        .filter((app) => Boolean(app.name) && Boolean(app.path))
        .sort((a, b) => getApplicationSortKey(a).localeCompare(getApplicationSortKey(b)));

      setApplications(apps);
      setApplicationIcons((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const app of apps) {
          if (!app.iconDataUrl || next[app.path]) continue;
          next[app.path] = app.iconDataUrl;
          changed = true;
        }
        return changed ? next : prev;
      });
      setSnippets(Array.isArray(snippetsRaw) ? snippetsRaw : []);

      if (!selectedAppPath && !quickLink?.applicationPath) {
        const fallbackApp = pickDefaultApplication(apps);
        if (fallbackApp) {
          setSelectedAppPath(fallbackApp.path);
        }
      }
    } catch (error) {
      console.error('Failed to load quick link setup data:', error);
    }
  }, [quickLink?.applicationPath]);

  useEffect(() => {
    void loadContextData();
  }, [loadContextData]);

  useEffect(() => {
    const pending = applications.filter((app) => {
      if (!app.path) return false;
      if (applicationIcons[app.path]) return false;
      if (appIconFetchAttemptedRef.current.has(app.path)) return false;
      return true;
    });
    if (pending.length === 0) return;

    let alive = true;
    for (const app of pending) {
      appIconFetchAttemptedRef.current.add(app.path);
    }

    void Promise.all(
      pending.map(async (app) => {
        try {
          const dataUrl = await window.electron.getFileIconDataUrl(app.path, 20);
          return [app.path, dataUrl] as const;
        } catch {
          return [app.path, null] as const;
        }
      })
    ).then((entries) => {
      if (!alive) return;
      setApplicationIcons((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const [appPath, iconDataUrl] of entries) {
          if (!iconDataUrl || next[appPath]) continue;
          next[appPath] = iconDataUrl;
          changed = true;
        }
        return changed ? next : prev;
      });
    });

    return () => {
      alive = false;
    };
  }, [applicationIcons, applications]);

  useEffect(() => {
    let alive = true;

    const selectedApp = applications.find((app) => app.path === selectedAppPath);
    if (!selectedApp?.path) {
      if (!quickLink?.appIconDataUrl) {
        setAppIconDataUrl(undefined);
      }
      return;
    }

    const knownIconDataUrl = applicationIcons[selectedApp.path] || selectedApp.iconDataUrl;
    if (knownIconDataUrl) {
      setAppIconDataUrl(knownIconDataUrl);
    }

    void window.electron.getFileIconDataUrl(selectedApp.path, 32)
      .then((iconDataUrl) => {
        if (!alive) return;
        if (iconDataUrl) {
          setApplicationIcons((prev) => (prev[selectedApp.path] ? prev : { ...prev, [selectedApp.path]: iconDataUrl }));
        }
        // Prefer cached/discovered app icons so we don't downgrade to generic file icons.
        setAppIconDataUrl(knownIconDataUrl || iconDataUrl || quickLink?.appIconDataUrl || undefined);
      })
      .catch(() => {
        if (!alive) return;
        setAppIconDataUrl(knownIconDataUrl || quickLink?.appIconDataUrl || undefined);
      });

    return () => {
      alive = false;
    };
  }, [applicationIcons, applications, quickLink?.appIconDataUrl, selectedAppPath]);

  const refreshPlaceholderMenuPos = useCallback(() => {
    const rect = placeholderButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const viewportPadding = 10;
    const desiredWidth = 280;
    const estimatedMenuHeight = 250;
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
    const spaceAbove = rect.top - viewportPadding;
    const openAbove = spaceBelow < 260 && spaceAbove > 130;
    const top = openAbove ? Math.max(viewportPadding, rect.top - estimatedMenuHeight - 8) : rect.bottom + 8;
    const maxHeight = Math.max(130, Math.floor((openAbove ? spaceAbove : spaceBelow) - 12));
    const left = Math.min(
      Math.max(viewportPadding, rect.left),
      Math.max(viewportPadding, window.innerWidth - desiredWidth - viewportPadding)
    );

    setPlaceholderMenuPos({
      top,
      left,
      width: desiredWidth,
      maxHeight,
    });
  }, []);

  const refreshApplicationMenuPos = useCallback(() => {
    const rect = applicationButtonRef.current?.getBoundingClientRect();
    if (!rect) return;

    const viewportPadding = 10;
    const desiredWidth = Math.max(300, rect.width);
    const estimatedMenuHeight = 280;
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
    const spaceAbove = rect.top - viewportPadding;
    const openAbove = spaceBelow < 240 && spaceAbove > 160;
    const top = openAbove ? Math.max(viewportPadding, rect.top - estimatedMenuHeight - 8) : rect.bottom + 8;
    const maxHeight = Math.max(140, Math.floor((openAbove ? spaceAbove : spaceBelow) - 12));
    const left = Math.min(
      Math.max(viewportPadding, rect.left),
      Math.max(viewportPadding, window.innerWidth - desiredWidth - viewportPadding)
    );

    setApplicationMenuPos({
      top,
      left,
      width: desiredWidth,
      maxHeight,
    });
  }, []);

  const refreshIconMenuPos = useCallback((anchorRect?: DOMRect) => {
    const rect = anchorRect || iconButtonRef.current?.getBoundingClientRect();
    if (!rect) return;

    const viewportPadding = 10;
    const desiredWidth = Math.max(260, rect.width);
    const estimatedMenuHeight = 300;
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
    const spaceAbove = rect.top - viewportPadding;
    // Prefer opening below; only open above when below space is really constrained.
    const openAbove = spaceBelow < 140 && spaceAbove > 170;
    const top = openAbove ? Math.max(viewportPadding, rect.top - estimatedMenuHeight - 8) : rect.bottom + 8;
    const maxHeight = Math.max(130, Math.floor((openAbove ? spaceAbove : spaceBelow) - 12));
    const left = Math.min(
      Math.max(viewportPadding, rect.left),
      Math.max(viewportPadding, window.innerWidth - desiredWidth - viewportPadding)
    );

    setIconMenuPos({
      top,
      left,
      width: desiredWidth,
      maxHeight,
    });
  }, []);

  useEffect(() => {
    if (!showPlaceholderMenu) return;
    refreshPlaceholderMenuPos();
    const onResize = () => refreshPlaceholderMenuPos();
    const onScroll = () => refreshPlaceholderMenuPos();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [refreshPlaceholderMenuPos, showPlaceholderMenu]);

  useEffect(() => {
    if (!showApplicationMenu) return;
    refreshApplicationMenuPos();
    const onResize = () => refreshApplicationMenuPos();
    const onScroll = () => refreshApplicationMenuPos();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [refreshApplicationMenuPos, showApplicationMenu]);

  useEffect(() => {
    if (!showIconMenu) return;
    refreshIconMenuPos();
    const onResize = () => refreshIconMenuPos();
    const onScroll = () => refreshIconMenuPos();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [refreshIconMenuPos, showIconMenu]);

  useEffect(() => {
    if (!showPlaceholderMenu) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      const menu = document.getElementById('quicklink-placeholder-menu');
      if (menu?.contains(target)) return;
      if (placeholderButtonRef.current?.contains(target)) return;
      setShowPlaceholderMenu(false);
    };
    document.addEventListener('mousedown', onPointerDown, true);
    return () => document.removeEventListener('mousedown', onPointerDown, true);
  }, [showPlaceholderMenu]);

  useEffect(() => {
    if (!showApplicationMenu) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      const menu = document.getElementById('quicklink-application-menu');
      if (menu?.contains(target)) return;
      if (applicationButtonRef.current?.contains(target)) return;
      setShowApplicationMenu(false);
    };
    document.addEventListener('mousedown', onPointerDown, true);
    return () => document.removeEventListener('mousedown', onPointerDown, true);
  }, [showApplicationMenu]);

  useEffect(() => {
    if (!showIconMenu) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      const menu = document.getElementById('quicklink-icon-menu');
      if (menu?.contains(target)) return;
      if (iconButtonRef.current?.contains(target)) return;
      setShowIconMenu(false);
    };
    document.addEventListener('mousedown', onPointerDown, true);
    return () => document.removeEventListener('mousedown', onPointerDown, true);
  }, [showIconMenu]);

  const placeholderGroups = useMemo(() => {
    const snippetItems: PlaceholderGroupItem[] = snippets.map((snippet) => ({
      label: snippet.name,
      value: `{snippet:${snippet.id}}`,
      subtitle: snippet.keyword ? `Keyword: ${snippet.keyword}` : undefined,
      icon: Link2,
    }));

    const groups: PlaceholderGroup[] = [...BASE_PLACEHOLDER_GROUPS];
    if (snippetItems.length > 0) {
      groups.push({ title: 'Saved Snippets', items: snippetItems });
    }

    const query = placeholderQuery.trim().toLowerCase();
    if (!query) return groups;

    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => {
          const haystack = `${item.label} ${item.value} ${item.subtitle || ''}`.toLowerCase();
          return haystack.includes(query);
        }),
      }))
      .filter((group) => group.items.length > 0);
  }, [placeholderQuery, snippets]);

  const selectedApp = useMemo(
    () => applications.find((app) => app.path === selectedAppPath) || null,
    [applications, selectedAppPath]
  );
  const selectedAppName = selectedApp?.name || 'Default Browser';
  const selectedAppResolvedIconDataUrl =
    (selectedAppPath
      ? applicationIcons[selectedAppPath] || selectedApp?.iconDataUrl || appIconDataUrl
      : undefined) || undefined;
  const selectedIconOption = getQuickLinkIconOption(icon) || QUICK_LINK_ICON_OPTIONS[0];
  const filteredIconOptions = useMemo(() => {
    const query = iconQuery.trim().toLowerCase();
    if (!query) return QUICK_LINK_ICON_OPTIONS;
    return QUICK_LINK_ICON_OPTIONS.filter((option) => option.searchText.includes(query));
  }, [iconQuery]);
  const visibleIconOptions = useMemo(() => {
    const query = iconQuery.trim().toLowerCase();
    if (query) {
      return filteredIconOptions.slice(0, MAX_VISIBLE_ICON_RESULTS);
    }

    // Keep the current selection visible while limiting initial render to 5 entries.
    const seen = new Set<string>();
    const list = [];
    if (selectedIconOption) {
      list.push(selectedIconOption);
      seen.add(selectedIconOption.value);
    }
    for (const option of QUICK_LINK_ICON_OPTIONS) {
      if (seen.has(option.value)) continue;
      list.push(option);
      seen.add(option.value);
      if (list.length >= MAX_VISIBLE_ICON_RESULTS) break;
    }
    return list;
  }, [filteredIconOptions, iconQuery, selectedIconOption]);

  const insertPlaceholder = (placeholder: string) => {
    const input = urlRef.current;
    if (!input) return;

    const start = input.selectionStart ?? urlTemplate.length;
    const end = input.selectionEnd ?? urlTemplate.length;
    const next = `${urlTemplate.slice(0, start)}${placeholder}${urlTemplate.slice(end)}`;
    setUrlTemplate(next);

    requestAnimationFrame(() => {
      input.focus();
      const nextPos = start + placeholder.length;
      input.setSelectionRange(nextPos, nextPos);
    });
  };

  const submit = async () => {
    const nextErrors: Record<string, string> = {};
    const trimmedName = name.trim();
    const trimmedTemplate = urlTemplate.trim();

    if (!trimmedName) {
      nextErrors.name = 'Name is required.';
    }
    if (!trimmedTemplate) {
      nextErrors.urlTemplate = 'URL is required.';
    } else if (!isLikelyUrlTemplate(trimmedTemplate)) {
      nextErrors.urlTemplate = 'Use a valid URL template (for example: https://example.com?q={clipboard}).';
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setSaving(true);
    try {
      await onSave({
        name: trimmedName,
        urlTemplate: trimmedTemplate,
        applicationName: selectedApp?.name,
        applicationPath: selectedApp?.path,
        applicationBundleId: selectedApp?.bundleId,
        appIconDataUrl,
        icon,
      });
      setErrors((prev) => ({ ...prev, form: '' }));
    } catch (error: any) {
      const message = String(error?.message || 'Failed to save quick link.').trim() || 'Failed to save quick link.';
      setErrors((prev) => ({ ...prev, form: message }));
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && event.metaKey) {
      event.preventDefault();
      void submit();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (showPlaceholderMenu) {
        setShowPlaceholderMenu(false);
        return;
      }
      if (showApplicationMenu) {
        setShowApplicationMenu(false);
        return;
      }
      if (showIconMenu) {
        setShowIconMenu(false);
        return;
      }
      onCancel();
      return;
    }
  };

  return (
    <div className="snippet-view w-full h-full flex flex-col" onKeyDown={handleKeyDown}>
      <div className="snippet-header flex items-center gap-3 px-5 py-3.5">
        <button
          onClick={onCancel}
          className="text-white/40 hover:text-white/70 transition-colors flex-shrink-0"
          aria-label="Back"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <span className="text-white/90 text-[15px] font-light">
          {quickLink ? 'Edit Quick Link' : 'Create Quick Link'}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-5">
        <div className="flex items-start gap-4">
          <label className="w-24 text-right text-white/50 text-sm pt-2 flex-shrink-0 font-medium">Name</label>
          <div className="flex-1">
            <input
              ref={nameRef}
              type="text"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setErrors((prev) => ({ ...prev, name: '' }));
              }}
              placeholder="Quick link name"
              className="w-full bg-white/[0.06] border border-[var(--snippet-divider)] rounded-lg px-2.5 py-1.5 text-white/90 text-[13px] placeholder:text-[color:var(--text-subtle)] outline-none focus:border-[var(--snippet-divider-strong)] transition-colors"
            />
            {errors.name ? <p className="text-red-400 text-xs mt-1">{errors.name}</p> : null}
          </div>
        </div>

        <div className="flex items-start gap-4">
          <label className="w-24 text-right text-white/50 text-sm pt-2 flex-shrink-0 font-medium">Link</label>
          <div className="flex-1">
            <div className="relative">
              <input
                ref={urlRef}
                type="text"
                value={urlTemplate}
                onChange={(event) => {
                  setUrlTemplate(event.target.value);
                  setErrors((prev) => ({ ...prev, urlTemplate: '' }));
                }}
                onKeyDown={(event) => {
                  if (event.key === '{' && !event.metaKey && !event.ctrlKey && !event.altKey) {
                    requestAnimationFrame(() => {
                      refreshPlaceholderMenuPos();
                      setShowPlaceholderMenu(true);
                    });
                  }
                }}
                placeholder="https://example.com/search?q={clipboard}"
                className="w-full bg-white/[0.06] border border-[var(--snippet-divider)] rounded-lg px-2.5 py-1.5 pr-10 text-white/90 text-[13px] placeholder:text-[color:var(--text-subtle)] outline-none focus:border-[var(--snippet-divider-strong)] transition-colors"
              />
              <button
                ref={placeholderButtonRef}
                type="button"
                onClick={() => {
                  refreshPlaceholderMenuPos();
                  setShowPlaceholderMenu((prev) => !prev);
                }}
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 px-2 rounded-md border border-[rgba(124,136,154,0.24)] bg-white/[0.04] text-white/60 hover:text-white/80 hover:bg-white/[0.08] transition-colors"
                title="Insert placeholder"
              >
                <Variable className="w-3.5 h-3.5" />
              </button>
            </div>
            {errors.urlTemplate ? <p className="text-red-400 text-xs mt-1">{errors.urlTemplate}</p> : null}
            <p className="text-white/25 text-xs mt-2">
              Type <strong className="text-white/45">{'{'}</strong> to insert dynamic placeholders or saved snippets.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-4">
          <label className="w-24 text-right text-white/50 text-sm pt-2 flex-shrink-0 font-medium">Open With</label>
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-md border border-[var(--snippet-divider)] bg-white/[0.04] flex items-center justify-center overflow-hidden">
                <QuickLinkIconPreview icon="default" appIconDataUrl={selectedAppResolvedIconDataUrl} />
              </div>
              <button
                ref={applicationButtonRef}
                type="button"
                onClick={() => {
                  refreshApplicationMenuPos();
                  setShowApplicationMenu((prev) => !prev);
                }}
                className="flex-1 bg-white/[0.06] border border-[var(--snippet-divider)] rounded-lg px-2.5 py-1.5 text-white/90 text-[13px] outline-none hover:border-[var(--snippet-divider-strong)] transition-colors text-left flex items-center justify-between gap-2"
              >
                <span className="min-w-0 flex items-center gap-2">
                  <span className="w-4 h-4 flex items-center justify-center overflow-hidden flex-shrink-0">
                    {selectedAppPath && selectedAppResolvedIconDataUrl ? (
                      <img src={selectedAppResolvedIconDataUrl} alt="" className="w-4 h-4 object-contain" draggable={false} />
                    ) : (
                      <Globe className="w-3.5 h-3.5 text-white/65" />
                    )}
                  </span>
                  <span className="truncate">{selectedAppName}</span>
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-white/55 flex-shrink-0" />
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-start gap-4">
          <label className="w-24 text-right text-white/50 text-sm pt-2 flex-shrink-0 font-medium">Icon</label>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-md border border-[var(--snippet-divider)] bg-white/[0.04] flex items-center justify-center overflow-hidden">
                <QuickLinkIconPreview icon={icon} appIconDataUrl={selectedAppResolvedIconDataUrl} />
              </div>
              <button
                ref={iconButtonRef}
                type="button"
                onClick={(event) => {
                  const rect = (event.currentTarget as HTMLButtonElement).getBoundingClientRect();
                  refreshIconMenuPos(rect);
                  setShowIconMenu((prev) => !prev);
                  setIconQuery('');
                }}
                className="flex-1 bg-white/[0.06] border border-[var(--snippet-divider)] rounded-lg px-2.5 py-1.5 text-white/90 text-[13px] outline-none hover:border-[var(--snippet-divider-strong)] transition-colors text-left flex items-center justify-between gap-2"
              >
                <span className="min-w-0 flex items-center gap-2">
                  <QuickLinkIconPreview icon={icon} appIconDataUrl={selectedAppResolvedIconDataUrl} />
                  <span className="truncate">{selectedIconOption.label}</span>
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-white/55 flex-shrink-0" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="sc-glass-footer flex items-center px-4 py-2.5">
        <div className="flex items-center gap-2 text-[var(--text-subtle)] text-xs flex-1 min-w-0 font-normal">
          <span className="truncate">{errors.form || (quickLink ? 'Edit Quick Link' : 'Create Quick Link')}</span>
        </div>
        <button
          onClick={() => void submit()}
          disabled={saving}
          className="flex items-center gap-1.5 text-[var(--text-primary)] hover:text-[var(--text-secondary)] disabled:text-[var(--text-disabled)] transition-colors cursor-pointer"
        >
          <span className="text-xs font-normal">{saving ? 'Saving...' : 'Save Quick Link'}</span>
          <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[11px] text-[var(--text-muted)] font-medium">⌘</kbd>
          <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[11px] text-[var(--text-muted)] font-medium">↩</kbd>
        </button>
      </div>

      {showApplicationMenu && createPortal(
        <div
          id="quicklink-application-menu"
          className="fixed z-[120] rounded-lg overflow-hidden border border-[var(--snippet-divider)]"
          style={{
            top: applicationMenuPos.top,
            left: applicationMenuPos.left,
            width: applicationMenuPos.width,
            background: 'var(--bg-overlay-strong)',
            backdropFilter: 'blur(18px)',
            boxShadow: '0 12px 28px rgba(var(--backdrop-rgb), 0.45)',
          }}
        >
          <div className="overflow-y-auto py-1" style={{ maxHeight: applicationMenuPos.maxHeight }}>
            <button
              type="button"
              onClick={() => {
                setSelectedAppPath('');
                setShowApplicationMenu(false);
              }}
              className="w-full text-left px-2.5 py-1.5 text-[13px] text-white/85 hover:bg-white/[0.07] transition-colors flex items-center gap-2"
            >
              <span className="w-4 h-4 flex items-center justify-center overflow-hidden flex-shrink-0">
                <Globe className="w-3.5 h-3.5 text-white/65" />
              </span>
              <span className="min-w-0 flex-1 truncate">Default Browser</span>
              {!selectedAppPath ? <Check className="w-3.5 h-3.5 text-white/65 flex-shrink-0" /> : null}
            </button>
            {applications.map((app) => {
              const iconDataUrl = applicationIcons[app.path] || app.iconDataUrl;
              const isSelected = selectedAppPath === app.path;
              return (
                <button
                  key={app.path}
                  type="button"
                  onClick={() => {
                    setSelectedAppPath(app.path);
                    setShowApplicationMenu(false);
                  }}
                  className="w-full text-left px-2.5 py-1.5 text-[13px] text-white/85 hover:bg-white/[0.07] transition-colors flex items-center gap-2"
                >
                  <span className="w-4 h-4 flex items-center justify-center overflow-hidden flex-shrink-0">
                    {iconDataUrl ? (
                      <img src={iconDataUrl} alt="" className="w-4 h-4 object-contain" draggable={false} />
                    ) : (
                      <Globe className="w-3.5 h-3.5 text-white/55" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{app.name}</span>
                  {isSelected ? <Check className="w-3.5 h-3.5 text-white/65 flex-shrink-0" /> : null}
                </button>
              );
            })}
          </div>
        </div>,
        document.body
      )}

      {showIconMenu && createPortal(
        <div
          id="quicklink-icon-menu"
          className="fixed z-[120] rounded-lg overflow-hidden border border-[var(--snippet-divider)]"
          style={{
            top: iconMenuPos.top,
            left: iconMenuPos.left,
            width: iconMenuPos.width,
            background: 'var(--bg-overlay-strong)',
            backdropFilter: 'blur(18px)',
            boxShadow: '0 12px 28px rgba(var(--backdrop-rgb), 0.45)',
          }}
        >
          <div className="px-2 py-1.5 border-b border-[var(--snippet-divider)]">
            <input
              type="text"
              value={iconQuery}
              onChange={(event) => setIconQuery(event.target.value)}
              placeholder="Search icons..."
              className="w-full bg-transparent text-[13px] text-white/75 placeholder:text-[color:var(--text-subtle)] outline-none"
              autoFocus
            />
          </div>
          <div className="overflow-y-auto py-1" style={{ maxHeight: iconMenuPos.maxHeight }}>
            {visibleIconOptions.map((option) => {
              const isSelected = icon === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setIcon(option.value as QuickLinkIcon);
                    setShowIconMenu(false);
                  }}
                  className="w-full text-left px-2.5 py-1.5 text-[13px] text-white/85 hover:bg-white/[0.07] transition-colors flex items-center gap-2"
                >
                  <span className="w-4 h-4 flex items-center justify-center overflow-hidden flex-shrink-0">
                    <QuickLinkIconPreview icon={option.value} appIconDataUrl={selectedAppResolvedIconDataUrl} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {isSelected ? <Check className="w-3.5 h-3.5 text-white/65 flex-shrink-0" /> : null}
                </button>
              );
            })}
            {filteredIconOptions.length === 0 ? (
              <div className="px-2.5 py-2 text-xs text-white/35">No icons found</div>
            ) : null}
            {filteredIconOptions.length > visibleIconOptions.length ? (
              <div className="px-2.5 py-2 text-[11px] text-white/35 border-t border-[var(--snippet-divider)]">
                {iconQuery.trim()
                  ? `Showing top ${MAX_VISIBLE_ICON_RESULTS} results. Refine search to narrow more.`
                  : `Showing ${MAX_VISIBLE_ICON_RESULTS} icons. Search to find more.`}
              </div>
            ) : null}
          </div>
        </div>,
        document.body
      )}

      {showPlaceholderMenu && createPortal(
        <div
          id="quicklink-placeholder-menu"
          className="fixed z-[120] rounded-lg overflow-hidden border border-[rgba(124,136,154,0.24)]"
          style={{
            top: placeholderMenuPos.top,
            left: placeholderMenuPos.left,
            width: placeholderMenuPos.width,
            background: 'var(--bg-overlay-strong)',
            backdropFilter: 'blur(18px)',
            boxShadow: '0 12px 28px rgba(var(--backdrop-rgb), 0.45)',
          }}
        >
          <div className="px-2 py-1.5 border-b border-[rgba(124,136,154,0.24)]">
            <input
              type="text"
              value={placeholderQuery}
              onChange={(event) => setPlaceholderQuery(event.target.value)}
              placeholder="Search placeholders..."
              className="w-full bg-transparent text-[13px] text-white/75 placeholder:text-[color:var(--text-subtle)] outline-none"
              autoFocus
            />
          </div>
          <div className="overflow-y-auto py-1" style={{ maxHeight: placeholderMenuPos.maxHeight }}>
            {placeholderGroups.map((group) => (
              <div key={group.title} className="mb-1">
                <div className="px-2.5 py-1 text-[11px] uppercase tracking-wider text-white/30">{group.title}</div>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={`${group.title}-${item.value}`}
                      type="button"
                      onClick={() => {
                        insertPlaceholder(item.value);
                        setShowPlaceholderMenu(false);
                        setPlaceholderQuery('');
                      }}
                      className="w-full text-left px-2.5 py-1 text-[13px] text-white/80 hover:bg-white/[0.07] transition-colors"
                    >
                      <span className="flex items-center gap-2">
                        {Icon ? <Icon className="w-3.5 h-3.5 text-white/45" /> : null}
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      </span>
                      {item.subtitle ? (
                        <div className="pl-5 text-[11px] text-white/35 truncate">{item.subtitle}</div>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))}
            {placeholderGroups.length === 0 ? (
              <div className="px-2.5 py-2 text-xs text-white/35">No placeholders found</div>
            ) : null}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

const QuickLinkManager: React.FC<QuickLinkManagerProps> = ({ onClose, initialView }) => {
  const [view, setView] = useState<'search' | 'create' | 'edit'>(initialView);
  const [quickLinks, setQuickLinks] = useState<QuickLink[]>([]);
  const [filteredQuickLinks, setFilteredQuickLinks] = useState<QuickLink[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [showActions, setShowActions] = useState(false);
  const [selectedActionIndex, setSelectedActionIndex] = useState(0);
  const [editingQuickLink, setEditingQuickLink] = useState<QuickLink | undefined>(undefined);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  const isGlassyTheme =
    document.documentElement.classList.contains('sc-glassy') ||
    document.body.classList.contains('sc-glassy');
  const isNativeLiquidGlass =
    document.documentElement.classList.contains('sc-native-liquid-glass') ||
    document.body.classList.contains('sc-native-liquid-glass');

  const loadQuickLinks = useCallback(async () => {
    setIsLoading(true);
    try {
      const all = await window.electron.quickLinkGetAll();
      setQuickLinks(Array.isArray(all) ? all : []);
    } catch (error) {
      console.error('Failed to load quick links:', error);
      setQuickLinks([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadQuickLinks();
    if (view === 'search') {
      inputRef.current?.focus();
    }
  }, [loadQuickLinks, view]);

  useEffect(() => {
    const normalized = searchQuery.trim().toLowerCase();
    if (!normalized) {
      setFilteredQuickLinks(quickLinks);
      setSelectedIndex(0);
      return;
    }

    const filtered = quickLinks.filter((quickLink) => {
      return (
        quickLink.name.toLowerCase().includes(normalized) ||
        quickLink.urlTemplate.toLowerCase().includes(normalized) ||
        String(quickLink.applicationName || '').toLowerCase().includes(normalized)
      );
    });
    setFilteredQuickLinks(filtered);
    setSelectedIndex(0);
  }, [quickLinks, searchQuery]);

  useEffect(() => {
    itemRefs.current = itemRefs.current.slice(0, filteredQuickLinks.length);
  }, [filteredQuickLinks.length]);

  useEffect(() => {
    if (!showActions) {
      setSelectedActionIndex(0);
    }
  }, [showActions]);

  const scrollToSelected = useCallback(() => {
    const selectedElement = itemRefs.current[selectedIndex];
    const scrollContainer = listRef.current;

    if (selectedElement && scrollContainer) {
      const containerRect = scrollContainer.getBoundingClientRect();
      const elementRect = selectedElement.getBoundingClientRect();

      if (elementRect.top < containerRect.top) {
        selectedElement.scrollIntoView({ block: 'start', behavior: 'smooth' });
      } else if (elementRect.bottom > containerRect.bottom) {
        selectedElement.scrollIntoView({ block: 'end', behavior: 'smooth' });
      }
    }
  }, [selectedIndex]);

  useEffect(() => {
    scrollToSelected();
  }, [scrollToSelected]);

  const selectedQuickLink = filteredQuickLinks[selectedIndex];

  const handleOpen = useCallback(async (quickLink?: QuickLink) => {
    const target = quickLink || selectedQuickLink;
    if (!target) return;
    try {
      await window.electron.executeCommand(getQuickLinkCommandId(target.id));
    } catch (error) {
      console.error('Failed to open quick link:', error);
    }
  }, [selectedQuickLink]);

  const handleEdit = useCallback(() => {
    if (!selectedQuickLink) return;
    setEditingQuickLink(selectedQuickLink);
    setView('edit');
  }, [selectedQuickLink]);

  const handleDelete = useCallback(async () => {
    if (!selectedQuickLink) return;
    try {
      await window.electron.quickLinkDelete(selectedQuickLink.id);
      await loadQuickLinks();
      setSearchQuery('');
    } catch (error) {
      console.error('Failed to delete quick link:', error);
    }
  }, [loadQuickLinks, selectedQuickLink]);

  const handleDuplicate = useCallback(async () => {
    if (!selectedQuickLink) return;
    try {
      await window.electron.quickLinkDuplicate(selectedQuickLink.id);
      await loadQuickLinks();
    } catch (error) {
      console.error('Failed to duplicate quick link:', error);
    }
  }, [loadQuickLinks, selectedQuickLink]);

  const handleSave = useCallback(async (payload: QuickLinkPayload) => {
    try {
      if (view === 'edit' && editingQuickLink) {
        await window.electron.quickLinkUpdate(editingQuickLink.id, payload);
      } else {
        await window.electron.quickLinkCreate(payload);
      }
      await loadQuickLinks();
      setEditingQuickLink(undefined);
      setView('search');
      setTimeout(() => inputRef.current?.focus(), 40);
    } catch (error: any) {
      console.error('Failed to save quick link:', error);
      throw error;
    }
  }, [editingQuickLink, loadQuickLinks, view]);

  const actions = useMemo(() => {
    const list: Array<{
      title: string;
      execute: () => void | Promise<void>;
      icon?: React.ReactNode;
      shortcut?: string[];
      style?: 'default' | 'destructive';
    }> = [
      {
        title: 'Open Quick Link',
        execute: () => handleOpen(),
        icon: <ExternalLink className="w-4 h-4" />,
        shortcut: ['↩'],
      },
      {
        title: 'Create Quick Link',
        execute: () => {
          setEditingQuickLink(undefined);
          setView('create');
        },
        icon: <Plus className="w-4 h-4" />,
        shortcut: ['⌘', 'N'],
      },
      {
        title: 'Edit Quick Link',
        execute: handleEdit,
        icon: <Pencil className="w-4 h-4" />,
        shortcut: ['⌘', 'E'],
      },
      {
        title: 'Duplicate Quick Link',
        execute: handleDuplicate,
        icon: <Files className="w-4 h-4" />,
        shortcut: ['⌘', 'D'],
      },
      {
        title: 'Delete Quick Link',
        execute: handleDelete,
        icon: <Trash2 className="w-4 h-4" />,
        shortcut: ['⌃', 'X'],
        style: 'destructive',
      },
    ];

    return list;
  }, [handleDelete, handleDuplicate, handleEdit, handleOpen]);

  const isMetaEnter = (event: React.KeyboardEvent) =>
    event.metaKey &&
    (event.key === 'Enter' || event.key === 'Return' || event.code === 'Enter' || event.code === 'NumpadEnter');

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'k' && event.metaKey && !event.repeat) {
      event.preventDefault();
      setShowActions((prev) => !prev);
      return;
    }

    if (showActions) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedActionIndex((prev) => (prev < actions.length - 1 ? prev + 1 : prev));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedActionIndex((prev) => (prev > 0 ? prev - 1 : 0));
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const action = actions[selectedActionIndex];
        if (action) {
          void Promise.resolve(action.execute());
        }
        setShowActions(false);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setShowActions(false);
        return;
      }
    }

    if (event.key.toLowerCase() === 'n' && event.metaKey) {
      event.preventDefault();
      setEditingQuickLink(undefined);
      setView('create');
      return;
    }
    if (event.key.toLowerCase() === 'e' && event.metaKey) {
      event.preventDefault();
      handleEdit();
      return;
    }
    if (event.key.toLowerCase() === 'd' && event.metaKey) {
      event.preventDefault();
      void handleDuplicate();
      return;
    }
    if (event.key.toLowerCase() === 'x' && event.ctrlKey) {
      event.preventDefault();
      void handleDelete();
      return;
    }
    if (isMetaEnter(event)) {
      event.preventDefault();
      void handleOpen();
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setSelectedIndex((prev) => (prev < filteredQuickLinks.length - 1 ? prev + 1 : prev));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0));
        break;
      case 'Enter':
        event.preventDefault();
        if (!event.repeat) {
          void handleOpen();
        }
        break;
      case 'Escape':
        event.preventDefault();
        onClose();
        break;
    }
  }, [actions, filteredQuickLinks.length, handleDelete, handleDuplicate, handleEdit, handleOpen, onClose, selectedActionIndex, showActions]);

  if (view === 'create' || view === 'edit') {
    return (
      <QuickLinkForm
        quickLink={view === 'edit' ? editingQuickLink : undefined}
        onSave={handleSave}
        onCancel={() => {
          setEditingQuickLink(undefined);
          setView('search');
          setTimeout(() => inputRef.current?.focus(), 40);
        }}
      />
    );
  }

  return (
    <div className="snippet-view w-full h-full flex flex-col" onKeyDown={handleKeyDown} tabIndex={-1}>
      <div className="snippet-header flex items-center gap-3 px-5 py-3.5">
        <button
          onClick={onClose}
          className="text-white/40 hover:text-white/70 transition-colors flex-shrink-0"
          aria-label="Back"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <input
          ref={inputRef}
          type="text"
          placeholder="Search quick links..."
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          className="flex-1 bg-transparent border-none outline-none text-white/95 placeholder:text-[color:var(--text-subtle)] text-[15px] font-medium tracking-[0.005em]"
          autoFocus
        />
        {searchQuery ? (
          <button
            onClick={() => setSearchQuery('')}
            className="text-white/30 hover:text-white/60 transition-colors flex-shrink-0"
            aria-label="Clear"
          >
            <X className="w-4 h-4" />
          </button>
        ) : null}
        <button
          onClick={() => {
            setEditingQuickLink(undefined);
            setView('create');
          }}
          className="text-white/40 hover:text-white/70 transition-colors flex-shrink-0"
          title="Create Quick Link"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 flex min-h-0">
        <div ref={listRef} className="snippet-split w-[40%] overflow-y-auto custom-scrollbar">
          {isLoading ? (
            <div className="flex items-center justify-center h-full text-white/50">
              <p className="text-sm">Loading quick links...</p>
            </div>
          ) : filteredQuickLinks.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-white/50 gap-3">
              <p className="text-sm">{searchQuery ? 'No quick links found' : 'No quick links yet'}</p>
              {!searchQuery ? (
                <button
                  onClick={() => {
                    setEditingQuickLink(undefined);
                    setView('create');
                  }}
                  className="px-3 py-1.5 text-xs rounded-lg bg-white/[0.08] text-white/60 hover:bg-white/[0.12] hover:text-white/80 transition-colors"
                >
                  Create your first quick link
                </button>
              ) : null}
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {filteredQuickLinks.map((quickLink, index) => (
                <div
                  key={quickLink.id}
                  ref={(el) => {
                    itemRefs.current[index] = el;
                  }}
                  className={`px-2.5 py-2 rounded-md border cursor-pointer transition-colors ${
                    index === selectedIndex
                      ? 'bg-[var(--launcher-card-selected-bg)] border-[var(--launcher-card-border)]'
                      : 'border-transparent hover:bg-[var(--launcher-card-hover-bg)] hover:border-[var(--launcher-card-border)]'
                  }`}
                  onClick={() => setSelectedIndex(index)}
                  onDoubleClick={() => void handleOpen(quickLink)}
                >
                  <div className="flex items-start gap-2">
                    <div className="w-4 h-4 mt-0.5 flex items-center justify-center flex-shrink-0 overflow-hidden">
                      <QuickLinkIconPreview icon={quickLink.icon} appIconDataUrl={quickLink.appIconDataUrl} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-white/80 text-[13px] truncate font-medium leading-tight">{quickLink.name}</div>
                      <div className="text-white/35 text-[11px] truncate mt-0.5 leading-tight">
                        {quickLink.applicationName || 'Default Browser'}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {selectedQuickLink ? (
            <div className="p-5 space-y-4">
              <div className="rounded-lg border border-[var(--snippet-divider)] bg-white/[0.03] px-3 py-2">
                <div className="text-[11px] uppercase tracking-wider text-white/35 mb-1">URL Template</div>
                <div className="text-sm text-white/85 break-all font-mono">{selectedQuickLink.urlTemplate}</div>
              </div>

              <div className="pt-1 space-y-1.5">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-white/35">Open With</span>
                  <span className="text-white/65 text-right truncate">
                    {selectedQuickLink.applicationName || 'Default Browser'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-white/35">Icon</span>
                  <span className="text-white/65 text-right truncate">
                    {getQuickLinkIconLabel(selectedQuickLink.icon)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-white/35">Updated</span>
                  <span className="text-white/65 text-right truncate">{formatDate(selectedQuickLink.updatedAt)}</span>
                </div>
              </div>

              {selectedQuickLink.urlTemplate.match(/\{[^}]+\}/g)?.length ? (
                <div className="pt-2 border-t border-[var(--snippet-divider)]">
                  <div className="text-[11px] uppercase tracking-wider text-white/35 mb-2">Placeholders</div>
                  <div className="flex flex-wrap gap-1.5">
                    {(selectedQuickLink.urlTemplate.match(/\{[^}]+\}/g) || []).map((token, idx) => (
                      <span
                        key={`${selectedQuickLink.id}-${token}-${idx}`}
                        className="px-1.5 py-0.5 rounded bg-white/[0.07] text-white/55 text-[11px] font-mono"
                      >
                        {token}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-white/50">
              <p className="text-sm">Select a quick link to preview</p>
            </div>
          )}
        </div>
      </div>

      <ExtensionActionFooter
        leftContent={<span className="truncate">{filteredQuickLinks.length} quick links</span>}
        primaryAction={
          selectedQuickLink
            ? {
                label: 'Open Quick Link',
                onClick: () => handleOpen(),
                shortcut: ['↩'],
              }
            : undefined
        }
        actionsButton={{
          label: 'Actions',
          onClick: () => setShowActions(true),
          shortcut: ['⌘', 'K'],
        }}
      />

      {showActions ? (
        <div
          className="fixed inset-0 z-50"
          onClick={() => setShowActions(false)}
          style={{ background: 'var(--bg-scrim)' }}
        >
          <div
            className="absolute bottom-12 right-3 w-80 max-h-[65vh] rounded-xl overflow-hidden flex flex-col shadow-2xl"
            style={
              isNativeLiquidGlass
                ? {
                    background: 'rgba(var(--surface-base-rgb), 0.72)',
                    backdropFilter: 'blur(44px) saturate(155%)',
                    WebkitBackdropFilter: 'blur(44px) saturate(155%)',
                    border: '1px solid rgba(var(--on-surface-rgb), 0.22)',
                    boxShadow: '0 18px 38px -12px rgba(var(--backdrop-rgb), 0.26)',
                  }
                : isGlassyTheme
                ? {
                    background: 'linear-gradient(160deg, rgba(var(--on-surface-rgb), 0.08), rgba(var(--on-surface-rgb), 0.01)), rgba(var(--surface-base-rgb), 0.42)',
                    backdropFilter: 'blur(96px) saturate(190%)',
                    WebkitBackdropFilter: 'blur(96px) saturate(190%)',
                    border: '1px solid rgba(var(--on-surface-rgb), 0.05)',
                  }
                : {
                    background: 'var(--card-bg)',
                    backdropFilter: 'blur(40px)',
                    WebkitBackdropFilter: 'blur(40px)',
                    border: '1px solid var(--border-primary)',
                  }
            }
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex-1 overflow-y-auto py-1">
              {actions.map((action, index) => (
                <button
                  key={action.title}
                  onClick={() => {
                    void Promise.resolve(action.execute());
                    setShowActions(false);
                  }}
                  className={`w-full px-3 py-2 text-left flex items-center justify-between gap-3 transition-colors ${
                    index === selectedActionIndex ? 'bg-white/[0.1]' : 'hover:bg-white/[0.06]'
                  } ${action.style === 'destructive' ? 'text-red-300' : 'text-white/85'}`}
                >
                  <span className="flex items-center gap-2 text-sm">
                    {action.icon}
                    <span>{action.title}</span>
                  </span>
                  {action.shortcut ? (
                    <span className="flex items-center gap-1">
                      {action.shortcut.map((key) => (
                        <kbd
                          key={`${action.title}-${key}`}
                          className="inline-flex items-center justify-center min-w-[20px] h-[20px] px-1 rounded bg-[var(--kbd-bg)] text-[10px] text-[var(--text-muted)] font-medium"
                        >
                          {key}
                        </kbd>
                      ))}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default QuickLinkManager;
