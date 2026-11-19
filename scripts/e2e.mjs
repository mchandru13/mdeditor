/**
 * End-to-end test against the packaged application.
 *
 * Drives the real `mdeditor.exe` (real WebView2, real Rust IPC, real filesystem)
 * through a complete editing session: open a file from the command line, render
 * it, edit, replace, save to disk, react to an external modification, switch
 * modes and copy rendered HTML.
 *
 * Native dialogs (file picker, print, export target) cannot be automated from
 * this harness; everything else in the flow is exercised.
 *
 * Usage: node scripts/e2e.mjs
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const EXE = resolve('src-tauri/target/release/mdeditor.exe');
const PORT = 9223;

const workDir = mkdtempSync(join(tmpdir(), 'mdeditor-e2e-'));
const docPath = join(workDir, 'session.md');
const initial = '# Session\n\nOriginal sentence with **bold** text.\n';
writeFileSync(docPath, initial, 'utf8');

const child = spawn(EXE, ['--file', docPath], {
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
  stdio: 'ignore',
});

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const checks = [];
const check = (name, ok, detail = '') => checks.push({ name, ok: Boolean(ok), detail });

let browser = null;
for (let attempt = 0; attempt < 40 && !browser; attempt += 1) {
  await sleep(500);
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  } catch {
    browser = null;
  }
}

try {
  if (!browser) throw new Error('Could not attach to WebView2');

  const page = browser.contexts()[0]?.pages()[0];
  if (!page) throw new Error('No page in WebView2');

  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  // --- open ---------------------------------------------------------------
  await page.waitForSelector('[role="tab"]', { timeout: 30000 });
  const tabTitle = await page.locator('[role="tab"]').last().innerText();
  check('opens the file from --file', tabTitle.toLowerCase().includes('session.md'), tabTitle);

  await page.keyboard.press('Control+3');
  await page.waitForSelector('.markdown-body h1', { timeout: 30000 });
  await page.waitForSelector('.cm-editor', { timeout: 20000 });
  check(
    'renders the file content',
    (await page.locator('.markdown-body h1').first().innerText()).includes('Session'),
  );
  check('editor pane is present', (await page.locator('.cm-editor').count()) === 1);

  // --- edit ---------------------------------------------------------------
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n## Added\n\nA new paragraph.\n');

  await page.waitForFunction(
    () => document.querySelector('.markdown-body')?.textContent?.includes('A new paragraph.') ?? false,
    undefined,
    { timeout: 10000 },
  );
  check('editing updates the preview', true);
  await page.waitForSelector('.tab-dirty', { timeout: 5000 });
  check('tab shows unsaved changes', (await page.locator('.tab-dirty').count()) === 1);

  // --- replace ------------------------------------------------------------
  await page.keyboard.press('Control+h');
  await page.locator('input[aria-label="Search text"]').fill('Added');
  await page.locator('input[aria-label="Replace with"]').fill('Renamed');
  await page.getByRole('button', { name: 'Replace all' }).click();

  await page.waitForFunction(
    () => document.querySelector('.cm-content')?.textContent?.includes('## Renamed') ?? false,
    undefined,
    { timeout: 10000 },
  );
  await page.waitForFunction(
    () => document.querySelector('.markdown-body')?.textContent?.includes('Renamed') ?? false,
    undefined,
    { timeout: 10000 },
  );
  check('replace all edits source and preview', true);
  await page.keyboard.press('Escape');

  // --- save ---------------------------------------------------------------
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => document.querySelector('.tab-dirty') === null, undefined, {
    timeout: 10000,
  });

  const saved = readFileSync(docPath, 'utf8');
  check('saves to the original path', saved.includes('## Renamed') && saved.includes('A new paragraph.'));

  // --- external modification ---------------------------------------------
  const externallyEdited = `${saved}\n\nEdited by another program.\n`;
  writeFileSync(docPath, externallyEdited, 'utf8');
  const future = new Date(Date.now() + 5000);
  utimesSync(docPath, future, future);

  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForFunction(
    () => document.querySelector('.cm-content')?.textContent?.includes('Edited by another program.') ?? false,
    undefined,
    { timeout: 10000 },
  );
  check('reloads after an external change', true);

  // --- copy rendered HTML -------------------------------------------------
  await page.getByRole('button', { name: 'Copy HTML', exact: true }).click();
  await page.waitForFunction(
    () => document.body.textContent?.includes('Rendered HTML fragment copied') ?? false,
    undefined,
    { timeout: 10000 },
  );
  check('copies rendered HTML', true);

  // --- read mode ----------------------------------------------------------
  await page.keyboard.press('Control+1');
  await page.waitForSelector('.markdown-body h1', { timeout: 10000 });
  await page.waitForSelector('.cm-editor', { state: 'detached', timeout: 10000 });
  check('read mode hides the editor', (await page.locator('.cm-editor').count()) === 0);

  await page.waitForFunction(
    () =>
      document.querySelector('.markdown-body')?.textContent?.includes('Edited by another program.') ??
      false,
    undefined,
    { timeout: 10000 },
  );
  check(
    'read mode shows the reloaded document',
    (await page.locator('.markdown-body').first().innerText()).includes('Edited by another program.'),
  );

  // --- clean up this tab so the user's session is left tidy ---------------
  const previousMode = await page.evaluate(() => {
    const checked = document
      .querySelector('[role="radio"][aria-checked="true"]')
      ?.textContent?.trim();
    return checked === 'Read' ? '1' : checked === 'Edit' ? '2' : '3';
  });
  await page.keyboard.press('Control+w');
  await sleep(600);
  if (previousMode !== '3') {
    await page.keyboard.press(`Control+${previousMode}`);
    await sleep(400);
  }

  check('no page errors', errors.length === 0, errors.join(' | '));
} catch (error) {
  check('end-to-end flow', false, String(error));
} finally {
  await browser?.close().catch(() => undefined);
  child.kill();
  await sleep(500);
  rmSync(workDir, { recursive: true, force: true });
}

for (const entry of checks) {
  console.log(`${entry.ok ? 'PASS' : 'FAIL'}  ${entry.name}${entry.detail ? `  — ${entry.detail}` : ''}`);
}
const failed = checks.filter((entry) => !entry.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
