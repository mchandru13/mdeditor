import { useEffect } from 'react';

export type ShortcutName =
  | 'mod+n'
  | 'mod+1'
  | 'mod+2'
  | 'mod+3'
  | 'mod+f'
  | 'mod+h'
  | 'mod+shift+m'
  | 'mod+s'
  | 'mod+shift+s'
  | 'mod+o'
  | 'mod+w'
  | 'escape';

export type ShortcutHandlers = Partial<Record<ShortcutName, () => void>>;

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * Maps a key event to a shortcut name, or null.
 *
 * Exported so the mapping can be tested without a window: the accelerator guard
 * was silently rejecting the key on whole keyboard layouts.
 */
export function shortcutForEvent(event: KeyboardEvent): ShortcutName | null {
  const mod = IS_MAC ? event.metaKey : event.ctrlKey;
  const key = event.key.toLowerCase();

  if (!mod) {
    return key === 'escape' ? 'escape' : null;
  }

  if (key === '1') return 'mod+1';
  if (key === 'n') return 'mod+n';
  if (key === '2') return 'mod+2';
  if (key === '3') return 'mod+3';
  if (key === 'f') return 'mod+f';
  if (key === 'h') return 'mod+h';
  // Ctrl+Shift+M, the accelerator the menu advertises.
  //
  // Deliberately not Ctrl+Alt+M: on layouts where Ctrl+Alt is AltGr the OS
  // consumes that combination as text (Ctrl+Alt+M arrived as `key: "ṁ"` with
  // `ctrl` and `alt` both false, and an empty `code`), so it reached neither the
  // accelerator nor this handler. Ctrl+Shift+M is never an AltGr combination.
  if (key === 'm' && event.shiftKey) return 'mod+shift+m';
  if (key === 'o') return 'mod+o';
  if (key === 'w') return 'mod+w';
  if (key === 's') return event.shiftKey ? 'mod+shift+s' : 'mod+s';

  return null;
}

/**
 * Window-level shortcuts.
 *
 * Every handled combination calls `preventDefault`, so WebView2 never opens its
 * own find bar or save dialog. Shortcuts are suppressed while a modal dialog is
 * open, except Escape which is delegated to the same handler so dialogs can
 * close themselves.
 */
export function useShortcuts(handlers: ShortcutHandlers, enabled = true): void {
  useEffect(() => {
    if (!enabled) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      const name = shortcutForEvent(event);
      if (!name) return;

      const handler = handlers[name];
      if (!handler) return;

      const target = event.target;
      const dialogOpen = document.querySelector('[data-modal-open="true"]') !== null;
      const isEditing =
        target instanceof HTMLElement &&
        target.closest('input, textarea, [contenteditable="true"], .cm-editor') !== null;

      if (dialogOpen && name !== 'escape') return;
      // Escape inside a text field should not steal focus from the field.
      if (name === 'escape' && isEditing) return;

      event.preventDefault();
      handler();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlers, enabled]);
}
