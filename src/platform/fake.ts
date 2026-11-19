/**
 * In-memory platform used by tests and by `npm run dev` outside Tauri.
 *
 * In a real browser the clipboard actions fall back to the async Clipboard API
 * when the page has permission, so the browser build stays usable for UI work.
 */

import type { Platform } from './index';

export interface FakePlatformOptions {
  files?: Record<string, string>;
  settings?: string | null;
  clipboard?: string;
  startupUrl?: string | null;
  readFileError?: Record<string, string>;
  writeFileError?: string;
  settingsError?: string;
  confirmResult?: boolean;
  fetchResult?: { text: string; finalUrl: string } | Error;
  assetOrigin?: string | null;
  openPath?: string | null;
  savePath?: string | null;
}

export interface FakePlatform extends Platform {
  readonly files: Map<string, string>;
  settingsWrites: string[];
  copied: string[];
  openedUrls: string[];
  dragDrop(paths: string[]): void;
  requestClose(): void;
  emitMenu(commandId: string): void;
  closeRequests: number;
  assetOriginValue: string | null;
}

export function createFakePlatform(options: FakePlatformOptions = {}): FakePlatform {
  const files = new Map<string, string>(Object.entries(options.files ?? {}));
  const settingsWrites: string[] = [];
  const copied: string[] = [];
  const openedUrls: string[] = [];
  const dragHandlers = new Set<(paths: string[]) => void>();
  const closeHandlers = new Set<() => void>();
  const menuHandlers = new Set<(commandId: string) => void>();

  const platform: FakePlatform = {
    kind: 'fake',
    files,
    settingsWrites,
    copied,
    openedUrls,
    assetOriginValue: options.assetOrigin === undefined ? 'http://asset.localhost' : options.assetOrigin,

    assetOrigin() {
      return platform.assetOriginValue;
    },

    assetUrl(path) {
      return `http://asset.localhost/${encodeURIComponent(path)}`;
    },

    async openFileDialog() {
      return options.openPath ?? null;
    },

    async saveFileDialog() {
      return options.savePath ?? null;
    },

    async readFile(path) {
      const error = options.readFileError?.[path];
      if (error) throw new Error(error);
      const content = files.get(path);
      if (content === undefined) throw new Error(`File does not exist: ${path}`);
      const bom = content.startsWith('\uFEFF');
      return { text: bom ? content.slice(1) : content, bom };
    },

    async writeFile(path, text, bom) {
      if (options.writeFileError) throw new Error(options.writeFileError);
      files.set(path, `${bom ? '\uFEFF' : ''}${text}`);
    },

    async fetchRemote(url) {
      if (options.fetchResult instanceof Error) throw options.fetchResult;
      if (options.fetchResult) return options.fetchResult;
      if (!url.startsWith('https://')) throw new Error('Only HTTPS URLs are supported');
      return { text: `# Remote ${url}\n`, finalUrl: url };
    },

    async allowAssetDir() {
      return undefined;
    },

    async copyText(text) {
      copied.push(text);
      if (options.clipboard === undefined && typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(text).catch(() => undefined);
      }
    },

    async readClipboard() {
      if (options.clipboard !== undefined) return options.clipboard;
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        try {
          return await navigator.clipboard.readText();
        } catch {
          return '';
        }
      }
      return '';
    },

    async openExternal(url) {
      openedUrls.push(url);
    },

    async loadSettings() {
      if (options.settingsError) throw new Error(options.settingsError);
      return options.settings ?? null;
    },

    async saveSettings(json) {
      if (options.settingsError) throw new Error(options.settingsError);
      settingsWrites.push(json);
    },

    onDragDrop(handler) {
      dragHandlers.add(handler);
      return () => dragHandlers.delete(handler);
    },

    onCloseRequested(handler) {
      closeHandlers.add(handler);
      return () => closeHandlers.delete(handler);
    },

    onMenuCommand(handler) {
      menuHandlers.add(handler);
      return () => menuHandlers.delete(handler);
    },

    async confirmDiscard() {
      return options.confirmResult ?? true;
    },

    async confirmAction() {
      return options.confirmResult ?? true;
    },

    async startupUrl() {
      return options.startupUrl ?? null;
    },

    async closeWindow() {
      platform.closeRequests += 1;
    },

    print() {
      return undefined;
    },

    dragDrop(paths) {
      for (const handler of dragHandlers) handler(paths);
    },

    requestClose() {
      for (const handler of closeHandlers) handler();
    },

    emitMenu(commandId) {
      for (const handler of menuHandlers) handler(commandId);
    },

    closeRequests: 0,
  };

  return platform;
}
