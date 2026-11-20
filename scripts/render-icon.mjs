/**
 * Rasterise the icon master SVG with the engine the app already ships with
 * (Chromium/WebView2 via Edge), then hand the result to `tauri icon`.
 *
 * This exists because the icon must be reproducible from source. An image
 * generator would be a one-off; `design/icon-master.svg` is the source of truth.
 *
 * Usage: node scripts/render-icon.mjs
 */
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const SVG = readFileSync('design/icon-master.svg', 'utf8');
const SIZE = 1024;

// Transparent background: the icon is a glyph, not a tile.
const page_html = `<!doctype html><html><body style="margin:0;background:transparent">
${SVG}
</body></html>`;

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const page = await browser.newPage({
  viewport: { width: SIZE, height: SIZE },
  deviceScaleFactor: 1,
});
await page.setContent(page_html, { waitUntil: 'load' });
// omitBackground keeps the alpha channel instead of painting white.
const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: SIZE, height: SIZE } });
await browser.close();

const dir = mkdtempSync(join(tmpdir(), 'mdeditor-icon-'));
const out = join(dir, 'app-icon.png');
writeFileSync(out, png);
writeFileSync('app-icon.png', png);
console.log(JSON.stringify({ rendered: out, copiedTo: 'app-icon.png', bytes: png.length }, null, 2));
