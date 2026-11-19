/** The single seam between the UI and native capabilities.
 *
 * Components and hooks must never import `@tauri-apps/*` directly: tests inject
 * a fake implementation and `npm run dev` in a plain browser falls back to it. */

export interface Platform {
  readonly kind: 'tauri' | 'fake';
  openFileDialog(): Promise<string | null>;
  saveFileDialog(defaultPath?: string, kind?: 'markdown' | 'html'): Promise<string | null>;
  readFile(path: string): Promise<{ text: string; bom: boolean }>;
  writeFile(path: string, text: string, bom: boolean): Promise<void>;
  fetchRemote(url: string): Promise<{ text: string; finalUrl: string }>;
  allowAssetDir(dir: string): Promise<void>;
  /** Absolute path to a URL the webview may load through the asset protocol. */
  assetUrl(path: string): string;
  /** e.g. `http://asset.localhost`; null when the asset protocol is unavailable. */
  assetOrigin(): string | null;
  copyText(text: string): Promise<void>;
  readClipboard(): Promise<string>;
  openExternal(url: string): Promise<void>;
  loadSettings(): Promise<string | null>;
  saveSettings(json: string): Promise<void>;
  onDragDrop(handler: (paths: string[]) => void): () => void;
  onCloseRequested(handler: () => void): () => void;
  confirmDiscard(names: string[]): Promise<boolean>;
  startupUrl(): Promise<string | null>;
  closeWindow(): Promise<void>;
  print(): void;
}

export const MD_EXTENSIONS = ['.md', '.markdown'] as const;

export function isMarkdownPath(path: string): boolean {
  const lower = path.toLowerCase();
  return MD_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

export function fileTitle(path: string): string {
  const normalised = path.replace(/\\/g, '/');
  const name = normalised.slice(normalised.lastIndexOf('/') + 1);
  return name.length > 0 ? name : path;
}

export function parentDir(path: string): string {
  const normalised = path.replace(/\\/g, '/');
  const index = normalised.lastIndexOf('/');
  return index <= 0 ? normalised : path.slice(0, index);
}
