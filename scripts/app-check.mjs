/**
 * Verifies the packaged Tauri application, not just the browser bundle.
 *
 * Launches `mdeditor.exe` with WebView2 remote debugging enabled, opens a remote
 * Markdown document through the real Rust fetch path, then inspects the live
 * WebView2 DOM over CDP.
 *
 * Usage: node scripts/app-check.mjs [https-url]
 */

import { chromium } from 'playwright-core';

const URL_TO_OPEN =
  process.argv[2] ?? 'https://raw.githubusercontent.com/rust-lang/rust/master/README.md';
const EXE = 'src-tauri/target/release/mdeditor.exe';
const PORT = 9222;

process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = `--remote-debugging-port=${PORT}`;

const { spawn } = await import('node:child_process');
const child = spawn(EXE, ['--url', URL_TO_OPEN], {
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
  stdio: 'ignore',
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let browser = null;
for (let attempt = 0; attempt < 40 && !browser; attempt += 1) {
  await sleep(500);
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  } catch {
    browser = null;
  }
}

const checks = [];
const check = (name, ok, detail = '') => checks.push({ name, ok: Boolean(ok), detail });

try {
  if (!browser) throw new Error('Could not attach to WebView2');

  const context = browser.contexts()[0];
  const page = context?.pages()[0];
  if (!page) throw new Error('No page in WebView2');

  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  // The app restores the previous session, which may include the user's own
  // tabs and mode. Record the mode so it can be restored, then force Split.
  await page.waitForSelector('[role="tab"]', { timeout: 30000 });
  const previousMode = await page.evaluate(() => {
    const checked = document
      .querySelector('[role="radio"][aria-checked="true"]')
      ?.textContent?.trim();
    return checked === 'Read' ? '1' : checked === 'Edit' ? '2' : '3';
  });

  await page.keyboard.press('Control+3');
  await page.waitForSelector('.cm-editor', { timeout: 30000 });

  // The first restored tab is typically a local file, which is the case a user
  // hits first; verify it renders before looking at the remote document.
  const restoreFirst = async () => {
    await page.locator('[role="tab"]').first().click();
    await page.waitForSelector('.markdown-body', { timeout: 30000 });
    return (await page.locator('.markdown-body').first().innerText()).length;
  };

  const firstTabText = await restoreFirst();
  check('restored file tab renders', firstTabText > 200, `${firstTabText} characters`);

  await page.locator('[role="tab"]').last().click();
  await page.waitForSelector('.markdown-body h1, .markdown-body h2', { timeout: 30000 });

  const tabTitle = await page.locator('[role="tab"]').last().innerText();
  check('remote document opened in a tab', tabTitle.toLowerCase().includes('readme'), tabTitle);

  const heading = await page.locator('.markdown-body h1, .markdown-body h2').first().innerText();
  check('preview rendered a heading', heading.length > 0, heading);

  check('preview has content', (await page.locator('.markdown-body p').count()) > 5);
  check(
    'preview has structured blocks',
    (await page.locator('.markdown-body > *').count()) > 3,
  );
  check('heading anchors present', (await page.locator('.markdown-body .anchor').count()) > 0);

  const toc = await page.locator('.toc-link').count();
  check('table of contents populated', toc > 0, String(toc));

  const viewerBox = await page.locator('.viewer').boundingBox();
  check('viewer has non-zero height', (viewerBox?.height ?? 0) > 200, JSON.stringify(viewerBox));

  const viewportBox = await page.locator('.cm-editor').boundingBox();
  check('editor has non-zero height', (viewportBox?.height ?? 0) > 200, JSON.stringify(viewportBox));

  check('no page errors', errors.length === 0, errors.join(' | '));

  // Leave the session as it was: close the document this check opened.
  await page.keyboard.press('Control+w');
  await page.waitForTimeout(300);

  if (previousMode !== '3') {
    await page.keyboard.press(`Control+${previousMode}`);
    await page.waitForTimeout(300);
  }
} catch (error) {
  check('app inspection', false, String(error));
} finally {
  await browser?.close().catch(() => undefined);
  child.kill();
}

for (const entry of checks) {
  console.log(`${entry.ok ? 'PASS' : 'FAIL'}  ${entry.name}${entry.detail ? `  — ${entry.detail}` : ''}`);
}
const failed = checks.filter((entry) => !entry.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
