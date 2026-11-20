/**
 * Browser smoke test for the real application UI.
 *
 * Runs the built (or dev) frontend in Edge — the same Chromium engine WebView2
 * uses — loads a document through the clipboard and asserts that the preview,
 * editor, search, mode switching and debounced updates actually work.
 *
 * Usage: node scripts/browser-check.mjs [url]
 */

import { chromium } from 'playwright-core';

const URL = process.argv[2] ?? 'http://localhost:1420';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const SAMPLE = `# Rendering check

A paragraph with **bold**, *italic* and \`inline code\`.

## Table

| A | B |
| - | - |
| 1 | 2 |

- [x] task done
- [ ] task pending

\`\`\`js
const x = 1;
\`\`\`

Inline math $a^2+b^2=c^2$ and a diagram:

\`\`\`mermaid
graph TD;
  A-->B;
\`\`\`
`;

const checks = [];
function check(name, condition, detail = '') {
  checks.push({ name, ok: Boolean(condition), detail });
}

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const context = await browser.newContext();
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: URL });

const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(`${error.message} @ ${error.stack?.split('\n')[1] ?? ''}`));
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().includes('404')) {
    errors.push(message.text());
  }
});

await page.addInitScript((text) => {
  void window.navigator.clipboard.writeText(text);
}, SAMPLE);

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'From clipboard', exact: true }).click();

// ---- split mode (initial): editor + preview ---------------------------------
await page.waitForSelector('.markdown-body h1', { timeout: 15000 });

const h1 = await page.locator('.markdown-body h1').first().innerText();
check('heading renders', h1.includes('Rendering check'), h1);
check('table renders', (await page.locator('.markdown-body table').count()) === 1);
check('syntax highlighting applies', (await page.locator('.markdown-body .hljs-keyword').count()) > 0);
check('task list checkbox renders', (await page.locator('.markdown-body input[type=checkbox]').count()) === 2);
check(
  'code copy button renders',
  (await page.getByRole('button', { name: 'Copy', exact: true }).count()) === 1,
);

await page.waitForSelector('.katex', { timeout: 15000 });
check('KaTeX renders', (await page.locator('.katex').count()) > 0);

await page.waitForSelector('.mermaid-svg svg', { timeout: 20000 });
check('Mermaid renders SVG', (await page.locator('.mermaid-svg svg').count()) > 0);

const viewerBox = await page.locator('.viewer').boundingBox();
check('preview has non-zero height', (viewerBox?.height ?? 0) > 200, JSON.stringify(viewerBox));

// ---- live editing updates the preview (debounce) ----------------------------
await page.locator('.cm-content').click();
await page.keyboard.press('Control+End');
await page.keyboard.type('\n\n## Typed live\n\nfresh paragraph\n');

await page.waitForFunction(
  () => document.querySelector('.markdown-body')?.textContent?.includes('Typed live') ?? false,
  undefined,
  { timeout: 8000 },
);
check('preview updates after typing', true);

// ---- mode switching ---------------------------------------------------------
await page.keyboard.press('Control+1');
await page.waitForSelector('.markdown-body h1', { timeout: 8000 });
await page.waitForSelector('.cm-editor', { state: 'detached', timeout: 8000 });
check('read mode hides the editor', (await page.locator('.cm-editor').count()) === 0);
check('read mode keeps the document', (await page.locator('.markdown-body h1').count()) > 0);

await page.keyboard.press('Control+2');
await page.waitForSelector('.cm-editor', { timeout: 8000 });
check('edit mode hides the preview', (await page.locator('.markdown-body').count()) === 0);
const editorText = await page.locator('.cm-content').innerText();
check('edit mode keeps typed text', editorText.includes('Typed live'));

// ---- search -----------------------------------------------------------------
await page.keyboard.press('Control+3');
await page.waitForSelector('.markdown-body', { timeout: 8000 });
await page.keyboard.press('Control+f');
await page.locator('input[aria-label="Search text"]').fill('diagram');
// Match counting is asynchronous: the status reads "No matches" until the first
// result arrives, so poll for the count instead of reading a transient state.
await page
  .waitForFunction(
    () => /\d+ of \d+/.test(document.querySelector('#search-status')?.textContent ?? ''),
    undefined,
    { timeout: 8000 },
  )
  .catch(() => undefined);
const status = await page.locator('#search-status').innerText();
check('search reports a match count', /\d+ of \d+/.test(status), status);

// ---- TOC --------------------------------------------------------------------
const tocLinks = await page.locator('.toc-link').count();
check('table of contents lists headings', tocLinks >= 3, String(tocLinks));

// ---- replace (Ctrl+H) -------------------------------------------------------
await page.keyboard.press('Control+h');
await page.locator('input[aria-label="Search text"]').fill('diagram');
await page.locator('input[aria-label="Replace with"]').fill('chart');
await page.getByRole('button', { name: 'Replace all' }).click();

await page.waitForFunction(
  () => document.querySelector('.cm-content')?.textContent?.includes('chart:') ?? false,
  undefined,
  { timeout: 8000 },
);
check('replace all edits the source', true);

await page.keyboard.press('Escape');
await page.waitForSelector('.searchbar', { state: 'detached', timeout: 5000 }).catch(() => undefined);

const bodyText = await page.locator('.markdown-body').innerText();
check('content survived every transition', bodyText.includes('Rendering check') && bodyText.includes('Typed live'));

check('no page errors', errors.length === 0, errors.join(' | '));

await browser.close();

const failed = checks.filter((entry) => !entry.ok);
for (const entry of checks) {
  console.log(`${entry.ok ? 'PASS' : 'FAIL'}  ${entry.name}${entry.detail ? `  — ${entry.detail}` : ''}`);
}
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
