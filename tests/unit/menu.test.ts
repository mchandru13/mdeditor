import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * The native menu and the frontend dispatcher are two hand-maintained lists that
 * must agree.
 *
 * A menu item whose id has no `case` in `App.tsx` is a button that does nothing;
 * a `case` with no item is dead code. Neither shows up in a normal test, because
 * an id that exists on only one side is never dispatched, so the lists are
 * compared here. `tests/integration/app.test.tsx` proves each id has an effect,
 * and `cargo test menu::` pins the labels and accelerators on the Rust side.
 */

const menuSource = readFileSync('src-tauri/src/menu.rs', 'utf8');
const appSource = readFileSync('src/App.tsx', 'utf8');

/** Ids declared in the Rust `COMMANDS` table, which is what `build` renders. */
function menuIds(): string[] {
  const start = menuSource.indexOf('pub const COMMANDS');
  const end = menuSource.indexOf('];', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const body = menuSource.slice(start, end);
  const ids = [...body.matchAll(/id:\s*"([^"]+)"/g)]
    .map((match) => match[1]!)
    // `-` is the separator marker, not a command.
    .filter((id) => id !== '-');
  return [...new Set(ids)].sort();
}

/** Ids the `onMenuCommand` switch handles. */
function handledIds(): string[] {
  const start = appSource.indexOf('platform.onMenuCommand');
  const end = appSource.indexOf('return dispose;', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const body = appSource.slice(start, end);
  const ids = [...body.matchAll(/case '([^']+)'/g)].map((match) => match[1]!);
  return [...new Set(ids)].sort();
}

describe('native menu wiring', () => {
  it('gives every menu item a handler and every handler a menu item', () => {
    expect(handledIds()).toEqual(menuIds());
  });

  it('registers the comment command with its accelerator', () => {
    expect(menuIds()).toContain('edit.comment');
    expect(menuSource).toMatch(
      /id:\s*"edit\.comment",\s*label:\s*"Add Comment…",\s*accelerator:\s*Some\("CmdOrCtrl\+Alt\+M"\)/,
    );
  });

  it('keeps the OS-provided clipboard items out of the dispatcher', () => {
    // Cut/Copy/Paste/Select All have no id: the WebView performs them, and a
    // dispatcher case for them would be dead code.
    expect(menuSource).toContain('PredefinedMenuItem::cut');
    expect(menuSource).toContain('PredefinedMenuItem::copy');
    expect(menuSource).toContain('PredefinedMenuItem::paste');
    expect(menuSource).toContain('PredefinedMenuItem::select_all');
  });
});
