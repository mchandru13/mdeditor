/**
 * End-to-end test against the packaged application.
 *
 * Drives the real `mdeditor.exe` (real WebView2, real Rust IPC, real filesystem)
 * through a complete editing session: open a file from the command line, render
 * it, edit, replace, save to disk, react to an external modification, add and
 * undo a comment, switch modes and copy rendered HTML.
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

// Defaults to the build in this checkout; set MDEDITOR_EXE to test the
// installed copy, which is what a user actually runs.
const EXE = resolve(process.env.MDEDITOR_EXE ?? 'src-tauri/target/release/mdeditor.exe');
const PORT = 9223;

const workDir = mkdtempSync(join(tmpdir(), 'mdeditor-e2e-'));
// A unique name per run: the app restores tabs from earlier sessions, and a
// fixed name made this script match (and wait on) those leftovers.
const docName = `session-${process.pid}.md`;
const docPath = join(workDir, docName);
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
  check('opens the file from --file', tabTitle.toLowerCase().includes(docName.toLowerCase()), tabTitle);

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
  // Scope to this document's tab: other restored tabs may be dirty too, so a
  // global count of `.tab-dirty` fails on any machine with open tabs.
  const dirtyTabs = await page.evaluate(() =>
    [...document.querySelectorAll('[role="tab"]')]
      .filter((tab) => tab.querySelector('.tab-dirty'))
      .map((tab) => tab.textContent ?? ''),
  );
  check(
    'tab shows unsaved changes',
    dirtyTabs.some((name) => name.toLowerCase().includes(docName.toLowerCase())),
    JSON.stringify(dirtyTabs),
  );

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
  // Wait for *this* tab to be clean; other restored tabs may still be dirty.
  // The name is passed in because this predicate runs inside the page, where
  // Node-side variables are not visible.
  await page.waitForFunction(
    (name) =>
      ![...document.querySelectorAll('[role="tab"]')]
        .filter((tab) => tab.querySelector('.tab-dirty'))
        .some((tab) => (tab.textContent ?? '').toLowerCase().includes(name)),
    docName.toLowerCase(),
    { timeout: 10000 },
  );

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
  // The OS clipboard is shared: another program on the machine can hold it, and
  // the write is then refused. Report that as a skip, not a failure of the app —
  // which now says so in the UI instead of doing nothing.
  await page.getByRole('button', { name: 'Copy HTML', exact: true }).click();
  const copyOutcome = await page
    .waitForFunction(
      () =>
        document.body.textContent?.includes('Rendered HTML fragment copied')
          ? 'copied'
          : document.body.textContent?.includes('Could not copy')
            ? 'blocked'
            : false,
      undefined,
      { timeout: 10000 },
    )
    .then((handle) => handle.jsonValue())
    .catch(() => 'timeout');
  checks.push({
    name: 'copies rendered HTML',
    ok: copyOutcome === 'copied',
    skipped: copyOutcome === 'blocked',
    detail: copyOutcome === 'blocked' ? 'clipboard held by another process' : '',
  });

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
  const readText = (await page.locator('.markdown-body').first().innerText()) ?? '';
  check(
    'read mode shows the reloaded document',
    readText.includes('Edited by another program.'),
    JSON.stringify(readText.slice(0, 80)),
  );

  // --- comments ------------------------------------------------------------
  await page.keyboard.press('Control+3');
  await page.waitForSelector('.cm-editor', { timeout: 20000 });
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n\nComment anchor paragraph.');
  await page.waitForFunction(
    () =>
      document.querySelector('.markdown-body')?.textContent?.includes('Comment anchor paragraph.') ??
      false,
    undefined,
    { timeout: 10000 },
  );

  // Select that paragraph and add a comment from the keyboard, as a user would.
  await page.keyboard.press('Shift+Home');
  // Ctrl+Shift+M, the documented accelerator. Ctrl+Alt+M does not work on
  // layouts where Ctrl+Alt is AltGr: the OS consumes it as text.
  await page.keyboard.press('Control+Shift+KeyM');
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
  await page.locator('#comment-body').fill('Packaged comment check.');
  await page.getByRole('button', { name: 'Add comment' }).click();

  await page.waitForFunction(
    () => document.querySelector('.cm-content')?.textContent?.includes('[!comment]') ?? false,
    undefined,
    { timeout: 10000 },
  );
  check('adds a comment to the source', true);

  await page.waitForFunction(
    () => document.querySelector('.markdown-body .mdeditor-comment') !== null,
    undefined,
    { timeout: 10000 },
  );
  check(
    'preview renders the comment as an annotation',
    (await page.locator('.markdown-body .mdeditor-comment').first().innerText()).includes(
      'Packaged comment check.',
    ),
  );

  await page.keyboard.press('Control+s');
  // Wait for *this* tab to be clean; other restored tabs may still be dirty.
  // The name is passed in because this predicate runs inside the page, where
  // Node-side variables are not visible.
  await page.waitForFunction(
    (name) =>
      ![...document.querySelectorAll('[role="tab"]')]
        .filter((tab) => tab.querySelector('.tab-dirty'))
        .some((tab) => (tab.textContent ?? '').toLowerCase().includes(name)),
    docName.toLowerCase(),
    { timeout: 10000 },
  );
  const savedWithComment = readFileSync(docPath, 'utf8');
  check(
    'comment is written into the file',
    savedWithComment.includes('> [!comment]') &&
      savedWithComment.includes('> Packaged comment check.'),
  );

  await page.keyboard.press('Control+z');
  await page.waitForFunction(
    () => !(document.querySelector('.cm-content')?.textContent?.includes('[!comment]') ?? true),
    undefined,
    { timeout: 10000 },
  );
  check('undo removes the comment from the source', true);

  // The preview follows the source through a 150 ms debounce, so wait for it
  // rather than sampling it on the next frame.
  await page.waitForFunction(
    () => document.querySelector('.markdown-body .mdeditor-comment') === null,
    undefined,
    { timeout: 10000 },
  );
  check('undo removes the annotation from the preview', true);

  // Put the file back in sync with the buffer before the tab is closed.
  await page.keyboard.press('Control+s');
  // Wait for *this* tab to be clean; other restored tabs may still be dirty.
  // The name is passed in because this predicate runs inside the page, where
  // Node-side variables are not visible.
  await page.waitForFunction(
    (name) =>
      ![...document.querySelectorAll('[role="tab"]')]
        .filter((tab) => tab.querySelector('.tab-dirty'))
        .some((tab) => (tab.textContent ?? '').toLowerCase().includes(name)),
    docName.toLowerCase(),
    { timeout: 10000 },
  );
  check('save after undo drops the comment', !readFileSync(docPath, 'utf8').includes('[!comment]'));

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
  const label = entry.ok ? 'PASS' : entry.skipped ? 'SKIP' : 'FAIL';
  console.log(`${label}  ${entry.name}${entry.detail ? `  — ${entry.detail}` : ''}`);
}
const failed = checks.filter((entry) => !entry.ok && !entry.skipped).length;
const passed = checks.filter((entry) => entry.ok).length;
const skipped = checks.filter((entry) => entry.skipped).length;
console.log(`\n${passed}/${checks.length} checks passed${skipped ? `, ${skipped} skipped` : ''}`);
process.exit(failed === 0 ? 0 : 1);
