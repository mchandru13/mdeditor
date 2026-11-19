/** Versioned session persistence.
 *
 * Disk-backed documents are stored by path only. Untitled or modified documents
 * keep a bounded copy of their source as recovery data, which is never claimed
 * to be a saved file. */

import type { DocOrigin, DocState, EncodingInfo, WorkspaceMode } from '../lib/types';

export const SETTINGS_VERSION = 1;
export const RECOVERY_DOC_BYTES = 256 * 1024;
export const RECOVERY_DOC_LIMIT = 20;

export type ThemeMode = 'light' | 'dark' | 'system';

export interface PersistedDoc {
  title: string;
  origin: DocOrigin | null;
  /** Present only for untitled, pasted, remote or modified documents. */
  recoverySource: string | null;
  encoding: EncodingInfo;
  scroll: { editor: number; preview: number };
}

export interface PersistedSettings {
  version: number;
  theme: ThemeMode;
  mode: WorkspaceMode;
  tocVisible: boolean;
  splitRatio: number;
  docs: PersistedDoc[];
  activeIndex: number;
}

export interface PersistedUi {
  theme: ThemeMode;
  mode: WorkspaceMode;
  tocVisible: boolean;
  splitRatio: number;
}

const THEMES: ThemeMode[] = ['light', 'dark', 'system'];
const MODES: WorkspaceMode[] = ['read', 'edit', 'split'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseOrigin(value: unknown): DocOrigin | null {
  if (!isRecord(value)) return null;
  if (value.kind === 'file' && typeof value.path === 'string' && typeof value.dir === 'string') {
    return { kind: 'file', path: value.path, dir: value.dir };
  }
  if (
    value.kind === 'remote' &&
    typeof value.url === 'string' &&
    typeof value.finalUrl === 'string' &&
    typeof value.baseUrl === 'string'
  ) {
    return { kind: 'remote', url: value.url, finalUrl: value.finalUrl, baseUrl: value.baseUrl };
  }
  if (value.kind === 'pasted') {
    return { kind: 'pasted', baseDir: typeof value.baseDir === 'string' ? value.baseDir : null };
  }
  return null;
}

function parseEncoding(value: unknown): EncodingInfo {
  if (!isRecord(value)) return { bom: false, eol: '\n' };
  return {
    bom: value.bom === true,
    eol: value.eol === '\r\n' ? '\r\n' : '\n',
  };
}

function parseScroll(value: unknown): { editor: number; preview: number } {
  if (!isRecord(value)) return { editor: 0, preview: 0 };
  return {
    editor: typeof value.editor === 'number' ? value.editor : 0,
    preview: typeof value.preview === 'number' ? value.preview : 0,
  };
}

export function serializeSettings(
  docs: DocState[],
  activeId: string | null,
  ui: PersistedUi,
  isDirty: (doc: DocState) => boolean,
): string {
  let budget = RECOVERY_DOC_LIMIT;

  const persisted: PersistedDoc[] = docs.map((doc) => {
    const isFile = doc.origin?.kind === 'file';
    const needsRecovery = !isFile || isDirty(doc);

    let recoverySource: string | null = null;
    if (needsRecovery && budget > 0) {
      budget -= 1;
      recoverySource =
        doc.source.length > RECOVERY_DOC_BYTES
          ? doc.source.slice(0, RECOVERY_DOC_BYTES)
          : doc.source;
    }

    return {
      title: doc.title,
      origin: doc.origin,
      recoverySource,
      encoding: doc.encoding,
      scroll: doc.scroll,
    };
  });

  const activeIndex = Math.max(
    0,
    docs.findIndex((doc) => doc.id === activeId),
  );

  const payload: PersistedSettings = {
    version: SETTINGS_VERSION,
    theme: ui.theme,
    mode: ui.mode,
    tocVisible: ui.tocVisible,
    splitRatio: ui.splitRatio,
    docs: persisted,
    activeIndex,
  };

  return JSON.stringify(payload);
}

/** Returns null for anything unreadable, from a future version, or malformed.
 * A null result means "start from defaults without touching the stored file". */
export function parseSettings(raw: string | null): PersistedSettings | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) return null;
  if (parsed.version !== SETTINGS_VERSION) return null;

  const theme = THEMES.includes(parsed.theme as ThemeMode) ? (parsed.theme as ThemeMode) : 'system';
  const mode = MODES.includes(parsed.mode as WorkspaceMode) ? (parsed.mode as WorkspaceMode) : 'split';

  const docs: PersistedDoc[] = Array.isArray(parsed.docs)
    ? parsed.docs.filter(isRecord).map((doc) => ({
        title: typeof doc.title === 'string' ? doc.title : 'Untitled',
        origin: parseOrigin(doc.origin),
        recoverySource:
          typeof doc.recoverySource === 'string'
            ? doc.recoverySource.slice(0, RECOVERY_DOC_BYTES)
            : null,
        encoding: parseEncoding(doc.encoding),
        scroll: parseScroll(doc.scroll),
      }))
    : [];

  const activeIndex =
    typeof parsed.activeIndex === 'number' && parsed.activeIndex >= 0 && parsed.activeIndex < docs.length
      ? Math.floor(parsed.activeIndex)
      : 0;

  return {
    version: SETTINGS_VERSION,
    theme,
    mode,
    tocVisible: parsed.tocVisible !== false,
    splitRatio:
      typeof parsed.splitRatio === 'number' && parsed.splitRatio > 0.15 && parsed.splitRatio < 0.85
        ? parsed.splitRatio
        : 0.5,
    docs,
    activeIndex,
  };
}
