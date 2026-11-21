import { describe, expect, it } from 'vitest';

import { shortcutForEvent } from '../../src/hooks/useShortcuts';

/**
 * Ctrl+Alt+M is the accelerator the native menu advertises for Add Comment.
 *
 * It was a no-op on layouts where Ctrl+Alt reports as AltGr, because the webview
 * handler bailed out on `getModifierState('AltGraph')` — the user pressed the
 * documented key and literally nothing happened. These cases run in jsdom, where
 * no native accelerator exists, so the handler is the only path.
 */
function key(init: KeyboardEventInit & { altGraph?: boolean }) {
  const event = new KeyboardEvent('keydown', { bubbles: true, ...init });
  Object.defineProperty(event, 'getModifierState', {
    value: (modifier: string) => (modifier === 'AltGraph' ? (init.altGraph ?? false) : false),
  });
  return event;
}

describe('shortcut mapping', () => {
  it('maps Ctrl+Alt+M', () => {
    expect(shortcutForEvent(key({ key: 'm', ctrlKey: true, altKey: true }))).toBe('mod+alt+m');
  });

  it('maps Ctrl+Alt+M even when the layout reports it as AltGr', () => {
    // The previous guard returned null here, which made the shortcut dead for
    // every keyboard layout that sends Ctrl+Alt as AltGr.
    expect(
      shortcutForEvent(key({ key: 'm', ctrlKey: true, altKey: true, altGraph: true })),
    ).toBe('mod+alt+m');
  });

  it('ignores Alt+M without Ctrl', () => {
    expect(shortcutForEvent(key({ key: 'm', altKey: true }))).toBeNull();
  });

  it('ignores Ctrl+Shift+Alt+M', () => {
    expect(shortcutForEvent(key({ key: 'm', ctrlKey: true, altKey: true, shiftKey: true }))).toBeNull();
  });
});
