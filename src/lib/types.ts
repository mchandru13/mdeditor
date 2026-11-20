/** Shared document and rendering types. Plain data only: these cross the
 * worker boundary, so nothing here may be a function, class or DOM node. */

export type DocId = string;

export type DocOrigin =
  | { kind: 'file'; path: string; dir: string }
  | { kind: 'remote'; url: string; finalUrl: string; baseUrl: string }
  | { kind: 'pasted'; baseDir: string | null };

export type DocStatus = 'clean' | 'loading' | 'missing' | 'error';

export interface EncodingInfo {
  bom: boolean;
  eol: '\n' | '\r\n';
}

export interface DocState {
  id: DocId;
  title: string;
  origin: DocOrigin | null;
  source: string;
  savedSource: string | null;
  status: DocStatus;
  error?: string;
  encoding: EncodingInfo;
  scroll: { editor: number; preview: number };
  /** Disk mtime (ms) observed at load/save, used to detect external edits. */
  diskModifiedAt: number | null;
}

export type WorkspaceMode = 'read' | 'edit' | 'split';

export interface HeadingEntry {
  id: string;
  text: string;
  depth: number;
  /** 1-based source line, used for source↔preview scroll anchoring. */
  line: number;
}

export interface DocumentStats {
  words: number;
  characters: number;
  readingMinutes: number;
}

/**
 * Resource base for relative link and image resolution.
 * - `file`: local document, paths resolve inside `dir`
 * - `remote`: paths resolve against the final URL after redirects
 * - `none`: pasted or untitled content with no known base
 */
export type ResourceBase =
  | { kind: 'file'; dir: string }
  | { kind: 'remote'; url: string }
  | { kind: 'none' };

export interface RenderOptions {
  base: ResourceBase;
  /** Origin used for the Tauri asset protocol, e.g. `http://asset.localhost`. */
  assetOrigin: string | null;
  /** Skip KaTeX/Mermaid placeholders entirely (large-document policy). */
  disableRichContent: boolean;
  /**
   * Whether images on remote hosts may load. Off by default: a local document
   * must not be able to make the app contact a third-party server just because
   * it was opened.
   */
  remoteImages?: 'block' | 'allow';
  /** Test hook: disable chunked parsing. Defaults to enabled. */
  chunking?: boolean;
}

export interface PlaceholderSummary {
  mermaid: number;
  math: number;
  /** Remote images replaced with a placeholder because loading was declined. */
  blockedRemoteImages: number;
}
