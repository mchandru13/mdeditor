/**
 * Packaged-app security regression check.
 *
 * Attaches to the real WebView2 app over CDP and verifies, against behaviour
 * rather than configuration:
 *   1. a Mermaid `click` link cannot navigate the webview away
 *   2. remote images are not fetched until the per-document opt-in
 *   3. after opting in, they do load
 *   4. hostile Markdown still renders inert
 *   5. the window still closes after all of it
 *
 * Leaves the user's settings.json as it found it.
 */
import { chromium } from 'playwright-core';
import { spawn, execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const EXE = process.argv[2] ?? join('src-tauri', 'target', 'release', 'mdeditor.exe');
const PORT = 9360;
const SETTINGS = join(process.env.APPDATA, 'com.rea.mdeditor', 'settings.json');
const BACKUP = join(process.env.TEMP, 'settings.sec-backup.json');
const TMP = join(process.env.TEMP, 'sec-verify');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const checks = [];
const check = (name, ok, detail = '') => checks.push({ name, ok: Boolean(ok), detail });

if (existsSync(SETTINGS)) copyFileSync(SETTINGS, BACKUP);
mkdirSync(TMP, { recursive: true });

const NAV = join(TMP, 'nav.md');
const REMOTE = join(TMP, 'remote.md');
writeFileSync(
  NAV,
  '# nav\n\n```mermaid\ngraph TD;\n  A[hi];\n  click A href "https://example.com/escape"\n```\n',
);
writeFileSync(
  REMOTE,
  '# remote\n\n![pixel](https://httpbin.org/image/png)\n\n![local](sibling.png)\n',
);

// A local sibling image so "local images still work" is tested too.
const SIBLING = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
writeFileSync(join(TMP, 'sibling.png'), SIBLING);

function killAll() {
  try {
    execFileSync('taskkill.exe', ['/F', '/IM', 'mdeditor.exe']);
  } catch {
    /* not running */
  }
}
function countProcesses() {
  try {
    const out = execFileSync('tasklist.exe', ['/FI', 'IMAGENAME eq mdeditor.exe', '/NH'], {
      encoding: 'utf8',
    });
    return (out.match(/mdeditor\.exe/g) ?? []).length;
  } catch {
    return -1;
  }
}

killAll();
await sleep(800);

spawn(EXE, ['--file', NAV], {
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
  stdio: 'ignore',
});

let browser = null;
for (let i = 0; i < 60 && !browser; i++) {
  await sleep(500);
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  } catch {
    browser = null;
  }
}
if (!browser) {
  console.log(JSON.stringify({ error: 'could not attach to the packaged app' }));
  process.exit(1);
}

const context = browser.contexts()[0];
const page = context.pages()[0];
const externalRequests = [];
page.on('request', (r) => {
  if (!r.url().startsWith('http://tauri.localhost') && !r.url().startsWith('http://localhost')) {
    externalRequests.push(r.url());
  }
});

await page.waitForSelector('[role="tab"]', { timeout: 40000 });
await page.waitForTimeout(7000);

// ---- 1. Mermaid link navigation ---------------------------------------------
const anchors = await page.evaluate(() =>
  [...document.querySelectorAll('.mermaid-svg svg a')].map((a) => ({
    xlink: a.getAttributeNS('http://www.w3.org/1999/xlink', 'href'),
  })),
);
check('mermaid link renders as an anchor', anchors.length === 1, JSON.stringify(anchors));

const before = await page.evaluate(() => location.href);
if (anchors.length) {
  await page.locator('.mermaid-svg svg a').first().click({ force: true }).catch(() => undefined);
  await page.waitForTimeout(3000);
}
const after = await page.evaluate(() => location.href);
check('mermaid link does not navigate the webview', after === before, `${before} -> ${after}`);
check('app UI still present after the click', (await page.locator('.markdown-body').count()) > 0);

// ---- 2. hostile markdown is inert -------------------------------------------
const HOSTILE = join(TMP, 'hostile.md');
writeFileSync(
  HOSTILE,
  [
    '<script>window.__pwned=1</script>',
    '<img src=x onerror="window.__pwned=2">',
    '<iframe src="https://example.com"></iframe>',
    '[js](javascript:window.__pwned=3)',
    '![js](javascript:window.__pwned=4)',
    '```mermaid',
    'graph TD;',
    '  A["<script>window.__pwned=5</script>"];',
    '```',
    '',
  ].join('\n\n'),
);
// Opened from disk rather than pasted: a pasted document is dirty, and the
// close-confirm dialog would then block the final check.
spawn(EXE, ['--file', HOSTILE], { stdio: 'ignore' });
await sleep(9000);

const hostileState = await page.evaluate(() => ({
  pwned: window.__pwned ?? null,
  scripts: document.querySelectorAll('.markdown-body script').length,
  iframes: document.querySelectorAll('.markdown-body iframe').length,
  onAttrs: [...document.querySelectorAll('.markdown-body *')].filter((el) =>
    [...el.attributes].some((a) => a.name.startsWith('on')),
  ).length,
  jsHref: [...document.querySelectorAll('.markdown-body a')].filter((a) =>
    /^javascript:/i.test(a.getAttribute('href') ?? ''),
  ).length,
}));
check(
  'hostile markdown stays inert',
  hostileState.pwned === null &&
    hostileState.scripts === 0 &&
    hostileState.iframes === 0 &&
    hostileState.onAttrs === 0 &&
    hostileState.jsHref === 0,
  JSON.stringify(hostileState),
);

// ---- 2b. a comment cannot hide document content -----------------------------
// The comment feature exempts a block from statistics, search and exported HTML.
// That is only safe if the block really is a comment, so probe the shapes that
// look similar: a marker only, a marker whose body is a heading, a marker
// followed by a list, and a soft-wrapped marker (which is quoted prose).
const COMMENT_CASES = join(TMP, 'comment-cases.md');
writeFileSync(
  COMMENT_CASES,
  [
    'Visible prose paragraph.',
    '',
    '> [!comment] chand',
    '>',
    '> Editorial note. <script>window.__pwned=6</script>',
    '',
    '> [!comment] x',
    '>',
    '> # Heading inside a comment',
    '',
    '> [!comment] soft wrap',
    '> quoted prose that must stay in the export',
    '',
    '> [!comment] x',
    '> - list item that must stay',
    '',
  ].join('\n'),
);
spawn(EXE, ['--file', COMMENT_CASES], { stdio: 'ignore' });
await sleep(9000);

const commentState = await page.evaluate(() => {
  const body = document.querySelector('.markdown-body');
  return {
    pwned: window.__pwned ?? null,
    scripts: body?.querySelectorAll('script').length ?? -1,
    // Two canonical blocks in the fixture: the note, and the heading below its
    // own `>` separator line.
    comments: body?.querySelectorAll('.mdeditor-comment').length ?? -1,
    // A heading inside a comment is editorial: it must not get an anchor id and
    // so cannot appear in the table of contents.
    commentHeadingId: body?.querySelector('.mdeditor-comment h1')?.id ?? '',
    // Text that is not a canonical comment must survive.
    keptProse: body?.textContent?.includes('quoted prose that must stay in the export') ?? false,
    keptItem: body?.textContent?.includes('list item that must stay') ?? false,
    noteVisible: body?.textContent?.includes('Editorial note.') ?? false,
  };
});
check(
  'tags exactly the canonical comment blocks',
  commentState.comments === 2,
  JSON.stringify(commentState),
);
check(
  'a heading inside a comment cannot reach the outline',
  commentState.commentHeadingId === '',
  JSON.stringify(commentState),
);
check('comment syntax cannot execute script', commentState.pwned === null && commentState.scripts === 0, JSON.stringify(commentState));
check(
  'non-comment content is never hidden',
  commentState.keptProse && commentState.keptItem && commentState.noteVisible,
  JSON.stringify(commentState),
);

// ---- 3. remote images blocked, then opt-in -----------------------------------
externalRequests.length = 0;
// Open through the app's own file command path: reuse the dialog-free route by
// launching a second instance, which forwards the path to this window.
spawn(EXE, ['--file', REMOTE], { stdio: 'ignore' });
await sleep(9000);

const blockedState = await page.evaluate(() => ({
  banners: document.querySelectorAll('.remote-images').length,
  blocked: document.querySelectorAll('.markdown-body .mdeditor-remote-image').length,
  imgs: [...document.querySelectorAll('.markdown-body img')].map((i) => i.getAttribute('src')),
  bannerText: document.querySelector('.remote-images p')?.textContent ?? '',
}));
check(
  'remote image is replaced with a placeholder',
  blockedState.blocked >= 1,
  JSON.stringify(blockedState),
);
check(
  'no request was made to the remote image host',
  !externalRequests.some((u) => u.includes('httpbin.org')),
  JSON.stringify(externalRequests),
);
check(
  'local sibling image still resolves',
  blockedState.imgs.some((src) => src?.includes('asset.localhost')),
  JSON.stringify(blockedState.imgs),
);

const loadButton = page.getByRole('button', { name: 'Load images' });
if (await loadButton.count()) {
  await loadButton.first().click();
  await page.waitForTimeout(8000);
}
const allowedState = await page.evaluate(() => ({
  imgs: [...document.querySelectorAll('.markdown-body img')].map((i) => ({
    src: i.getAttribute('src'),
    width: i.naturalWidth,
  })),
}));
check(
  'opt-in loads the remote image',
  allowedState.imgs.some((i) => i.src?.includes('httpbin.org') && i.width > 0),
  JSON.stringify(allowedState.imgs),
);

// ---- 4. the window still closes ---------------------------------------------
await browser.close().catch(() => undefined);
await sleep(500);
const beforeClose = countProcesses();
try {
  execFileSync('taskkill.exe', ['/IM', 'mdeditor.exe'], { encoding: 'utf8' });
} catch {
  /* nothing to close */
}
await sleep(7000);
const afterClose = countProcesses();
check(
  'window closes after navigating/linking',
  afterClose === 0,
  `before=${beforeClose} after=${afterClose}`,
);

killAll();
if (existsSync(BACKUP)) copyFileSync(BACKUP, SETTINGS);

const failed = checks.filter((c) => !c.ok);
for (const c of checks) {
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  — ${c.detail}` : ''}`);
}
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
