/** Tauri implementation of the platform seam. The only module that imports
 * `@tauri-apps/*` for capabilities (React bindings live in components). */

import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { ask, open, save } from '@tauri-apps/plugin-dialog';
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
import { openUrl } from '@tauri-apps/plugin-opener';

import { fileTitle, type Platform } from './index';

const MARKDOWN_FILTER = [{ name: 'Markdown', extensions: ['md', 'markdown'] }];

function assetOrigin(): string {
  return navigator.userAgent.includes('Windows') || navigator.userAgent.includes('Linux')
    ? 'http://asset.localhost'
    : 'asset://localhost';
}

export function createTauriPlatform(): Platform {
  return {
    kind: 'tauri',

    async openFileDialog() {
      const selected = await open({
        multiple: false,
        directory: false,
        filters: MARKDOWN_FILTER,
      });
      return typeof selected === 'string' ? selected : null;
    },

    async saveFileDialog(defaultPath, kind = 'markdown') {
      const selected = await save({
        defaultPath,
        filters:
          kind === 'html'
            ? [{ name: 'HTML', extensions: ['html', 'htm'] }]
            : MARKDOWN_FILTER,
      });
      return typeof selected === 'string' ? selected : null;
    },

    async readFile(path) {
      const result = await invoke<{ text: string; bom: boolean }>('read_document', { path });
      return result;
    },

    async writeFile(path, text, bom) {
      await invoke('write_document', { path, text, bom });
    },

    async modifiedTime(path) {
      try {
        return await invoke<number>('modified_time', { path });
      } catch {
        return null;
      }
    },

    async fetchRemote(url) {
      return invoke<{ text: string; finalUrl: string }>('fetch_remote', { url });
    },

    async allowAssetDir(dir) {
      await invoke('allow_asset_dir', { dir });
    },

    assetUrl(path) {
      return convertFileSrc(path);
    },

    assetOrigin() {
      return assetOrigin();
    },

    async copyText(text) {
      await writeText(text);
    },

    async readClipboard() {
      return readText();
    },

    async openExternal(url) {
      await openUrl(url);
    },

    async loadSettings() {
      return invoke<string | null>('load_settings');
    },

    async saveSettings(json) {
      await invoke('save_settings', { json });
    },

    onDragDrop(handler) {
      let unlisten: (() => void) | undefined;
      void getCurrentWebview()
        .onDragDropEvent((event) => {
          if (event.payload.type === 'drop') handler(event.payload.paths);
        })
        .then((dispose) => {
          unlisten = dispose;
        });

      return () => unlisten?.();
    },

    onCloseRequested(handler) {
      let unlisten: (() => void) | undefined;
      void listen('mdeditor://close-requested', () => handler()).then((dispose) => {
        unlisten = dispose;
      });
      return () => unlisten?.();
    },

    onMenuCommand(handler) {
      let unlisten: (() => void) | undefined;
      void listen<string>('mdeditor://menu', (event) => handler(event.payload)).then((dispose) => {
        unlisten = dispose;
      });
      return () => unlisten?.();
    },

    onOpenFile(handler) {
      let unlisten: (() => void) | undefined;
      void listen<string>('mdeditor://open-file', (event) => handler(event.payload)).then(
        (dispose) => {
          unlisten = dispose;
        },
      );
      return () => unlisten?.();
    },

    async confirmDiscard(names) {
      const label = names.length === 1 ? `"${fileTitle(names[0] ?? '')}"` : `${names.length} documents`;
      return ask(`Discard unsaved changes in ${label}?`, {
        title: 'Unsaved changes',
        kind: 'warning',
      });
    },

    async confirmAction(message) {
      return ask(message, { title: 'Markdown Editor', kind: 'warning' });
    },

    async startupUrl() {
      return invoke<string | null>('startup_url');
    },

    async startupFile() {
      return invoke<string | null>('startup_file');
    },

    async closeWindow() {
      await invoke('close_window');
    },

    print() {
      window.print();
    },
  };
}
