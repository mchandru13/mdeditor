import { describe, expect, it } from 'vitest';

import { shortcutForEvent } from '../../src/hooks/useShortcuts';

/**
 * Ctrl+Shift+M is the accelerator the native menu advertises for Add Comment.
 *
 * The previous accelerator, Ctrl+Alt+M, turned out to be unusable: on a layout
 * where Ctrl+Alt is AltGr the OS consumes it as text (observed as "ṁ" with no
 * modifier flags), so it reached neither the accelerator nor this handler.
 */
function key(init: KeyboardEventInit & { altGraph?: boolean }) {
  // `code` defaults to KeyM so the cases exercise the physical key.
  const event = new KeyboardEvent('keydown', { bubbles: true, code: 'KeyM', ...init });
  Object.defineProperty(event, 'getModifierState', {
    value: (modifier: string) => (modifier === 'AltGraph' ? (init.altGraph ?? false) : false),
  });
  return event;
}

describe('shortcut mapping', () => {
  it('maps Ctrl+Shift+M', () => {
    expect(shortcutForEvent(key({ key: 'm', ctrlKey: true, shiftKey: true }))).toBe('mod+shift+m');
  });

  it('does not map plain M', () => {
    expect(shortcutForEvent(key({ key: 'm' }))).toBeNull();
  });

  it('does not map Alt+M without Ctrl', () => {
    expect(shortcutForEvent(key({ key: 'm', altKey: true }))).toBeNull();
  });

  it('no longer claims Ctrl+Alt+M', () => {
    // It was the documented accelerator, but on a layout where Ctrl+Alt is AltGr
    // the OS consumes it as text: observed as key "ṁ", no modifier flags, empty
    // `code`. Matching it was dead code that looked alive.
    expect(shortcutForEvent(key({ key: 'm', ctrlKey: true, altKey: true }))).toBeNull();
  });
});

describe('zoom shortcuts', () => {
  it('maps both spellings of the plus key', () => {
    // `+` needs Shift on most layouts; the unshifted physical key reports `=`.
    // The numeric keypad reports `+` directly. All three are the same gesture.
    expect(shortcutForEvent(key({ key: '=', ctrlKey: true }))).toBe('mod+equal');
    expect(shortcutForEvent(key({ key: '+', ctrlKey: true, shiftKey: true }))).toBe('mod+equal');
    expect(shortcutForEvent(key({ key: '+', ctrlKey: true }))).toBe('mod+equal');
  });

  it('maps both spellings of the minus key', () => {
    expect(shortcutForEvent(key({ key: '-', ctrlKey: true }))).toBe('mod+minus');
    expect(shortcutForEvent(key({ key: '_', ctrlKey: true, shiftKey: true }))).toBe('mod+minus');
  });

  it('maps Ctrl+0 to actual size', () => {
    expect(shortcutForEvent(key({ key: '0', ctrlKey: true }))).toBe('mod+zero');
  });

  it('does not map the zoom keys without Ctrl', () => {
    expect(shortcutForEvent(key({ key: '+' }))).toBeNull();
    expect(shortcutForEvent(key({ key: '-' }))).toBeNull();
    expect(shortcutForEvent(key({ key: '0' }))).toBeNull();
  });
});
