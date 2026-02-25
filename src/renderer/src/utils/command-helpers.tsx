/**
 * command-helpers.tsx
 *
 * Pure utility functions and types for the launcher command list.
 * - filterCommands: text search + hidden-command filtering
 * - Icon renderers: renderCommandIcon, renderSuperCmdLogoIcon, getSystemCommandFallbackIcon
 * - Display helpers: getCommandDisplayTitle, getCategoryLabel, getCommandAccessoryLabel, formatShortcutLabel, renderShortcutLabel
 * - Voice utilities: buildReadVoiceOptions, getVoiceLanguageCode, getFallbackVoiceLabel
 * - parseIntervalToMs: converts interval strings like "1m", "12h" to milliseconds
 * - Types: LauncherAction, MemoryFeedback, ReadVoiceOption
 *
 * No side-effects; all functions are stateless and safe to import anywhere.
 */

import React from 'react';
import { Search, Power, Settings, Puzzle, Sparkles, Clipboard, FileText, Mic, Volume2, Brain, TerminalSquare, RefreshCw, LayoutGrid } from 'lucide-react';
import type { CommandInfo, EdgeTtsVoice } from '../../types/electron';
import supercmdLogo from '../../../../supercmd.svg';
import { formatShortcutForDisplay } from './hyper-key';

export interface LauncherAction {
  id: string;
  title: string;
  shortcut?: string;
  style?: 'default' | 'destructive';
  enabled?: boolean;
  execute: () => void | Promise<void>;
}

export type MemoryFeedback = {
  type: 'success' | 'error';
  text: string;
} | null;

export type ReadVoiceOption = {
  value: string;
  label: string;
};

const SEARCH_TOKEN_SPLIT_REGEX = /[^a-z0-9]+/g;

function normalizeSearchText(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(SEARCH_TOKEN_SPLIT_REGEX, ' ')
    .trim();
}

function tokenizeSearchText(value: string): string[] {
  const normalized = normalizeSearchText(value);
  return normalized ? normalized.split(/\s+/).filter(Boolean) : [];
}

function isSubsequenceMatch(needle: string, haystack: string): boolean {
  if (!needle) return true;
  if (!haystack) return false;

  let needleIndex = 0;
  for (let i = 0; i < haystack.length && needleIndex < needle.length; i += 1) {
    if (haystack[i] === needle[needleIndex]) {
      needleIndex += 1;
    }
  }
  return needleIndex === needle.length;
}

function maxAllowedTypoDistance(termLength: number): number {
  if (termLength <= 3) return 0;
  if (termLength <= 5) return 1;
  if (termLength <= 8) return 2;
  return 3;
}

function damerauLevenshteinDistance(a: string, b: string, maxDistance: number): number {
  const aLen = a.length;
  const bLen = b.length;

  if (!aLen) return bLen;
  if (!bLen) return aLen;
  if (Math.abs(aLen - bLen) > maxDistance) {
    return maxDistance + 1;
  }

  const dp: number[][] = Array.from({ length: aLen + 1 }, () => Array<number>(bLen + 1).fill(0));
  for (let i = 0; i <= aLen; i += 1) dp[i][0] = i;
  for (let j = 0; j <= bLen; j += 1) dp[0][j] = j;

  for (let i = 1; i <= aLen; i += 1) {
    for (let j = 1; j <= bLen; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let distance = Math.min(
        dp[i - 1][j] + 1, // deletion
        dp[i][j - 1] + 1, // insertion
        dp[i - 1][j - 1] + cost // substitution
      );

      // Adjacent transposition (Damerau-Levenshtein)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        distance = Math.min(distance, dp[i - 2][j - 2] + 1);
      }

      dp[i][j] = distance;
    }
  }

  return dp[aLen][bLen];
}

function scoreTokenMatch(term: string, candidate: string): number {
  if (!term || !candidate) return 0;
  if (candidate === term) return 120;
  if (candidate.startsWith(term)) return 106;
  if (candidate.includes(term)) return 94;

  if (term.length >= 3 && isSubsequenceMatch(term, candidate)) {
    return 78;
  }

  const maxDistance = maxAllowedTypoDistance(term.length);
  if (maxDistance > 0 && Math.abs(candidate.length - term.length) <= maxDistance) {
    const distance = damerauLevenshteinDistance(term, candidate, maxDistance);
    if (distance <= maxDistance) {
      const similarity = 1 - distance / Math.max(term.length, candidate.length);
      if (similarity >= 0.65) {
        return Math.round(50 + similarity * 30 - distance * 8);
      }
    }
  }

  return 0;
}

type SearchCandidate = {
  token: string;
  weight: number;
};

function bestTermScore(term: string, candidates: SearchCandidate[]): number {
  let best = 0;
  for (const candidate of candidates) {
    const baseScore = scoreTokenMatch(term, candidate.token);
    if (baseScore <= 0) continue;
    const weighted = Math.round(baseScore * candidate.weight);
    if (weighted > best) {
      best = weighted;
    }
  }
  return best;
}

/**
 * Filter and sort commands based on search query
 */
export function filterCommands(commands: CommandInfo[], query: string): CommandInfo[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return commands;
  }

  const queryTerms = tokenizeSearchText(normalizedQuery);

  const scored = commands
    .map((cmd) => {
      const title = normalizeSearchText(cmd.title);
      const subtitle = normalizeSearchText(String(cmd.subtitle || ''));
      const keywordTokens = (cmd.keywords || []).flatMap((keyword) => tokenizeSearchText(keyword));
      const titleTokens = tokenizeSearchText(cmd.title);
      const subtitleTokens = tokenizeSearchText(String(cmd.subtitle || ''));

      const candidates: SearchCandidate[] = [
        ...titleTokens.map((token) => ({ token, weight: 1 })),
        ...keywordTokens.map((token) => ({ token, weight: 0.92 })),
        ...subtitleTokens.map((token) => ({ token, weight: 0.76 })),
      ];

      if (candidates.length === 0) {
        return null;
      }

      let score = 0;

      if (title === normalizedQuery) {
        score += 420;
      } else if (title.startsWith(normalizedQuery)) {
        score += 320;
      } else if (title.includes(normalizedQuery)) {
        score += 260;
      } else if (keywordTokens.includes(normalizedQuery)) {
        score += 225;
      } else if (keywordTokens.some((keyword) => keyword.includes(normalizedQuery))) {
        score += 180;
      } else if (subtitle.includes(normalizedQuery)) {
        score += 145;
      }

      let termScoreSum = 0;
      for (const term of queryTerms) {
        const termScore = bestTermScore(term, candidates);
        if (termScore <= 0) {
          return null;
        }
        termScoreSum += termScore;
      }

      score += termScoreSum;

      if (normalizedQuery.length >= 3) {
        const compactQuery = normalizedQuery.replace(/\s+/g, '');
        const compactTitle = title.replace(/\s+/g, '');
        if (compactQuery && compactTitle && isSubsequenceMatch(compactQuery, compactTitle)) {
          score += 18;
        }
      }

      // Favor concise titles when scores are close.
      score += Math.max(0, 12 - Math.max(0, title.length - normalizedQuery.length));

      return { cmd, score, title };
    })
    .filter((entry): entry is { cmd: CommandInfo; score: number; title: string } => Boolean(entry) && entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.title.localeCompare(b.title);
    });

  return scored.map(({ cmd }) => cmd);
}

/**
 * Get category display label
 */
export function getCategoryLabel(category: string): string {
  switch (category) {
    case 'settings':
      return 'System Settings';
    case 'system':
      return 'System';
    case 'extension':
      return 'Extension';
    case 'script':
      return 'Script';
    case 'app':
    default:
      return 'Application';
  }
}

function toTitleCaseLabel(input: string): string {
  return String(input || '')
    .split('-')
    .map((part) => part ? part[0].toUpperCase() + part.slice(1) : '')
    .join(' ');
}

export function getCommandAccessoryLabel(command: CommandInfo): string {
  if (command.category === 'extension') {
    const extName = String(command.path || '').split('/')[0] || '';
    if (extName) return toTitleCaseLabel(extName);
  }

  if (command.category === 'script') {
    const subtitle = String(command.subtitle || '').trim();
    if (subtitle) return subtitle;
  }

  const subtitle = String(command.subtitle || '').trim();
  if (subtitle) return subtitle;

  return '';
}

export function formatShortcutLabel(shortcut: string): string {
  return formatShortcutForDisplay(shortcut).replace(/ \+ /g, ' ');
}

export function isSuperCmdAppTitle(title: string): boolean {
  const key = String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return key === 'supercmd' || key === 'supercmd';
}

export function isSuperCmdSystemCommand(commandId: string): boolean {
  return (
    commandId === 'system-open-settings' ||
    commandId === 'system-open-ai-settings' ||
    commandId === 'system-open-extensions-settings' ||
    commandId === 'system-open-onboarding' ||
    commandId === 'system-quit-launcher'
  );
}

export function getVoiceLanguageCode(voiceId: string): string {
  const id = String(voiceId || '').trim();
  const match = /^([a-z]{2}-[A-Z]{2})-/.exec(id);
  return match?.[1] || '';
}

export function getFallbackVoiceLabel(voiceId: string): string {
  const id = String(voiceId || '').trim();
  if (!id) return 'Voice';
  const base = id.split('-').slice(2).join('-').replace(/Neural$/i, '').trim();
  const lang = getVoiceLanguageCode(id);
  return base ? `${base} (${lang || 'Unknown'})` : id;
}

export function buildReadVoiceOptions(
  allVoices: EdgeTtsVoice[],
  currentVoice: string,
  configuredVoice: string
): ReadVoiceOption[] {
  const configured = String(configuredVoice || '').trim();
  const current = String(currentVoice || '').trim();
  const targetVoice = configured || current;
  const targetLang = getVoiceLanguageCode(targetVoice) || getVoiceLanguageCode(current);

  const filtered = allVoices
    .filter((voice) => (targetLang ? voice.languageCode === targetLang : true))
    .slice()
    .sort((a, b) => {
      const genderScore = (v: EdgeTtsVoice) => (String(v.gender).toLowerCase() === 'female' ? 0 : 1);
      const genderCmp = genderScore(a) - genderScore(b);
      if (genderCmp !== 0) return genderCmp;
      return String(a.label || '').localeCompare(String(b.label || ''));
    });

  const options: ReadVoiceOption[] = filtered.map((voice) => {
    const style = String(voice.style || '').trim();
    const gender = String(voice.gender || '').toLowerCase() === 'male' ? 'Male' : 'Female';
    const languageCode = String(voice.languageCode || '').trim();
    const languageSuffix = languageCode ? ` (${languageCode})` : '';
    const styleSuffix = style ? ` - ${style}` : '';
    return {
      value: voice.id,
      label: `${voice.label}${styleSuffix} - ${gender}${languageSuffix}`,
    };
  });

  const ensureVoicePresent = (voiceId: string) => {
    const id = String(voiceId || '').trim();
    if (!id) return;
    if (options.some((opt) => opt.value === id)) return;
    options.unshift({ value: id, label: getFallbackVoiceLabel(id) });
  };
  ensureVoicePresent(current);
  ensureVoicePresent(configured);

  return options;
}

export function renderSuperCmdLogoIcon(): React.ReactNode {
  return (
    <img
      src={supercmdLogo}
      alt=""
      className="w-5 h-5 object-contain"
      draggable={false}
    />
  );
}

export function getCommandDisplayTitle(command: CommandInfo): string {
  if (command.category === 'app' && isSuperCmdAppTitle(command.title)) return 'SuperCmd';
  return command.title;
}

export function renderCommandIcon(command: CommandInfo): React.ReactNode {
  if (command.category === 'app' && isSuperCmdAppTitle(command.title)) {
    return renderSuperCmdLogoIcon();
  }
  if (command.iconDataUrl) {
    return (
      <img
        src={command.iconDataUrl}
        alt=""
        className="w-5 h-5 object-contain"
        draggable={false}
      />
    );
  }
  if (command.category === 'system') {
    return getSystemCommandFallbackIcon(command.id);
  }
  if (command.category === 'extension') {
    return (
      <div className="w-5 h-5 rounded bg-purple-500/20 flex items-center justify-center">
        <Puzzle className="w-3 h-3 text-purple-400" />
      </div>
    );
  }
  if (command.category === 'script') {
    if (command.iconEmoji) {
      return <span className="text-sm leading-none">{command.iconEmoji}</span>;
    }
    return (
      <div className="w-5 h-5 rounded bg-emerald-500/20 flex items-center justify-center">
        <TerminalSquare className="w-3 h-3 text-emerald-300" />
      </div>
    );
  }
  return (
    <div
      className="w-5 h-5 rounded flex items-center justify-center"
      style={{ background: 'var(--icon-neutral-bg)', color: 'var(--icon-neutral-fg)' }}
    >
      <Settings className="w-3 h-3" />
    </div>
  );
}

export function getSystemCommandFallbackIcon(commandId: string): React.ReactNode {
  if (isSuperCmdSystemCommand(commandId)) {
    return renderSuperCmdLogoIcon();
  }

  if (commandId === 'system-cursor-prompt') {
    return (
      <div className="w-5 h-5 rounded bg-violet-500/20 flex items-center justify-center">
        <Sparkles className="w-3 h-3 text-violet-300" />
      </div>
    );
  }

  if (commandId === 'system-add-to-memory') {
    return (
      <div className="w-5 h-5 rounded bg-fuchsia-500/20 flex items-center justify-center">
        <Brain className="w-3 h-3 text-fuchsia-200" />
      </div>
    );
  }

  if (commandId === 'system-clipboard-manager') {
    return (
      <div
        className="w-5 h-5 rounded flex items-center justify-center"
        style={{ background: 'var(--icon-clipboard-bg)', color: 'var(--icon-clipboard-fg)' }}
      >
        <Clipboard className="w-3 h-3" />
      </div>
    );
  }

  if (
    commandId === 'system-create-snippet' ||
    commandId === 'system-search-snippets' ||
    commandId === 'system-import-snippets' ||
    commandId === 'system-export-snippets'
  ) {
    return (
      <div
        className="w-5 h-5 rounded flex items-center justify-center"
        style={{ background: 'var(--icon-snippet-bg)', color: 'var(--icon-snippet-fg)' }}
      >
        <FileText className="w-3 h-3" />
      </div>
    );
  }

  if (
    commandId === 'system-create-script-command' ||
    commandId === 'system-open-script-commands'
  ) {
    return (
      <div
        className="w-5 h-5 rounded flex items-center justify-center"
        style={{ background: 'var(--icon-script-bg)', color: 'var(--icon-script-fg)' }}
      >
        <TerminalSquare className="w-3 h-3" />
      </div>
    );
  }

  if (commandId === 'system-search-files') {
    return (
      <div
        className="w-5 h-5 rounded flex items-center justify-center"
        style={{ background: 'var(--icon-search-bg)', color: 'var(--icon-search-fg)' }}
      >
        <Search className="w-3 h-3" />
      </div>
    );
  }

  if (commandId === 'system-supercmd-whisper') {
    return (
      <div className="w-5 h-5 rounded bg-sky-500/20 flex items-center justify-center">
        <Mic className="w-3 h-3 text-sky-300" />
      </div>
    );
  }

  if (commandId === 'system-whisper-onboarding') {
    return (
      <div className="w-5 h-5 rounded bg-sky-500/20 flex items-center justify-center">
        <Sparkles className="w-3 h-3 text-sky-200" />
      </div>
    );
  }

  if (commandId === 'system-supercmd-speak') {
    return (
      <div className="w-5 h-5 rounded bg-indigo-500/20 flex items-center justify-center">
        <Volume2 className="w-3 h-3 text-indigo-200" />
      </div>
    );
  }

  if (commandId === 'system-window-management' || commandId.startsWith('system-window-management-')) {
    return (
      <div className="w-5 h-5 rounded bg-cyan-500/20 flex items-center justify-center">
        <LayoutGrid className="w-3 h-3 text-cyan-200" />
      </div>
    );
  }

  if (commandId === 'system-check-for-updates') {
    return (
      <div className="w-5 h-5 rounded bg-amber-500/20 flex items-center justify-center">
        <RefreshCw className="w-3 h-3 text-green-300" />
      </div>
    );
  }

  return (
    <div className="w-5 h-5 rounded bg-red-500/20 flex items-center justify-center">
      <Power className="w-3 h-3 text-red-400" />
    </div>
  );
}

export function renderShortcutLabel(shortcut?: string): string {
  if (!shortcut) return '';
  return formatShortcutForDisplay(shortcut).replace(/ \+ /g, ' ');
}

export function parseIntervalToMs(interval?: string): number | null {
  if (!interval) return null;
  const trimmed = interval.trim();
  const match = trimmed.match(/^(\d+)\s*([smhd])$/i);
  if (!match) return null;

  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;

  const unit = match[2].toLowerCase();
  const unitMs =
    unit === 's' ? 1_000 :
    unit === 'm' ? 60_000 :
    unit === 'h' ? 60 * 60_000 :
    24 * 60 * 60_000;
  return value * unitMs;
}
