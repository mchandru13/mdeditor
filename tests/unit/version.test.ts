import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { version as PACKAGE_VERSION } from '../../package.json';
import { parseSettings, SETTINGS_VERSION } from '../../src/state/session';

/**
 * Version strings appear in three files that must agree, and a fourth place
 * (the About box) used to hardcode its own copy — it read 1.0.0 long after the
 * app was 1.0.3. The About box now imports `package.json`, so it cannot drift;
 * this test pins the remaining copies, including the ones the release workflow
 * compares.
 */
describe('version consistency', () => {
  const cargo = readFileSync('src-tauri/Cargo.toml', 'utf8');
  const conf = readFileSync('src-tauri/tauri.conf.json', 'utf8');

  it('agrees across package.json, Cargo.toml and tauri.conf.json', () => {
    const cargoVersion = /^version\s*=\s*"([^"]+)"/m.exec(cargo)?.[1];
    const confVersion = /"version"\s*:\s*"([^"]+)"/.exec(conf)?.[1];
    expect(cargoVersion).toBe(PACKAGE_VERSION);
    expect(confVersion).toBe(PACKAGE_VERSION);
  });

  it('reports the package version in the About box source', () => {
    const source = readFileSync('src/components/Dialogs/InfoDialog.tsx', 'utf8');
    // A literal version in the About box is a bug: it goes stale silently.
    expect(source).toMatch(/Markdown Editor \{APP_VERSION\}/);
    expect(source).not.toMatch(/Markdown Editor \d+\.\d+\.\d+/);
  });

  it('does not hardcode a version anywhere in user-facing source', () => {
    const files = [
      'src/App.tsx',
      'src/components/Dialogs/InfoDialog.tsx',
      'src/components/Toolbar/StatusBar.tsx',
    ];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(source, `${file} mentions a version literal`).not.toMatch(/\b\d+\.\d+\.\d+\b/);
    }
  });

  it('keeps the settings schema version a number, not the app version', () => {
    expect(typeof SETTINGS_VERSION).toBe('number');
    expect(parseSettings).toBeTypeOf('function');
  });
});
