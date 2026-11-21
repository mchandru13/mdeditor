import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

/**
 * Verifies user-facing text in the packaged app over CDP.
 *
 * The frontend subscribes to `mdeditor://menu` through Tauri's event plugin, so
 * emitting the same event from the page drives the same handler the native menu
 * runs — no OS input required. Covers the About box version and the comment
 * entry in the shortcut list.
 */
const EXE = resolve(process.env.MDEDITOR_EXE ?? 'src-tauri/target/release/mdeditor.exe');
const PORT = 9341;
const child = spawn(EXE, [], {
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
  stdio: 'ignore',
});
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

let browser = null;
for (let attempt = 0; attempt < 40 && !browser; attempt += 1) {
  await sleep(500);
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  } catch {
    browser = null;
  }
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

try {
  if (!browser) throw new Error('no CDP');
  const page = browser.contexts()[0]?.pages()[0];
  if (!page) throw new Error('no page');
  await page.waitForSelector('.app', { timeout: 30000 });

  const emit = (id) =>
    page.evaluate(async (commandId) => {
      const internals = window.__TAURI_INTERNALS__;
      if (!internals?.invoke) return 'no internals';
      await internals.invoke('plugin:event|emit', {
        event: 'mdeditor://menu',
        payload: commandId,
      });
      return 'ok';
    }, id);

  // The frontend subscribes to the menu channel on mount, so an emit sent during
  // startup is dropped. Retry until the dialog appears rather than assuming.
  const openDialog = async (id, name) => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await emit(id);
      const opened = await page
        .waitForFunction(
          (wanted) => document.querySelector('[role="dialog"]')?.textContent?.includes(wanted) ?? false,
          name,
          { timeout: 1000 },
        )
        .then(() => true)
        .catch(() => false);
      if (opened) return true;
    }
    return false;
  };

  const about = await openDialog('help.about', 'About Markdown Editor');
  const aboutText = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    return {
      open: !!dialog,
      text: dialog?.textContent ?? '',
    };
  });
  check('Help > About opens', aboutText.open, `opened=${about}`);
  check(
    'About shows the shipped version, not a stale literal',
    /Markdown Editor\s+1\.1\.0/.test(aboutText.text) && !/1\.0\.0/.test(aboutText.text),
    JSON.stringify(aboutText.text.slice(0, 160)),
  );

  await page.evaluate(() => {
    const close = [...document.querySelectorAll('[role="dialog"] button')].find(
      (b) => b.textContent?.trim() === 'Close',
    );
    close?.click();
  });
  await sleep(500);

  const shortcutsOpened = await openDialog('help.shortcuts', 'Keyboard shortcuts');
  const shortcutText = shortcutsOpened
    ? await page.evaluate(() => document.querySelector('[role="dialog"]')?.textContent ?? '')
    : '';
  check(
    'shortcut list documents Ctrl+Alt+M',
    /Ctrl\+Alt\+M/.test(shortcutText) && /Add a comment/.test(shortcutText),
    JSON.stringify(shortcutText.slice(0, 120)),
  );
} catch (error) {
  check('about check', false, String(error));
} finally {
  await browser?.close().catch(() => undefined);
  child.kill();
  await sleep(400);
}

for (const line of results) console.log(line);
const failed = results.filter((line) => line.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
