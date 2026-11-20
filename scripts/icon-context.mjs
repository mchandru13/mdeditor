/**
 * Show the generated icon the way Windows actually presents it: a desktop
 * shortcut, a taskbar slot, and the Alt-Tab switcher. Light and dark.
 */
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const icon = readFileSync(join('src-tauri/icons', '128x128.png')).toString('base64');
const url = `data:image/png;base64,${icon}`;

const desktop = (bg, label, textColor) =>
  `<div style="position:relative;width:132px;height:112px;background:${bg};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;border-radius:6px">
     <img src="${url}" style="width:48px;height:48px" />
     <div style="font:11px system-ui;color:${textColor};text-align:center;line-height:1.2">Markdown Editor</div>
     <div style="font:10px system-ui;color:${textColor};opacity:.6">${label}</div>
   </div>`;

const taskbar = (bg) =>
  `<div style="display:flex;align-items:center;gap:10px;height:44px;padding:0 12px;background:${bg};border-radius:8px;width:340px">
     <img src="${url}" style="width:24px;height:24px" />
     <div style="width:1px;height:20px;background:rgba(128,128,128,.4)"></div>
     <img src="${url}" style="width:20px;height:20px" />
     <img src="${url}" style="width:16px;height:16px" />
     <div style="font:11px system-ui;color:#9aa0a6;margin-left:auto">24 / 20 / 16 px</div>
   </div>`;

const altTab = (bg, textColor) =>
  `<div style="display:flex;gap:10px;padding:14px;background:${bg};border-radius:8px">
     <img src="${url}" style="width:64px;height:64px" />
     <div style="display:flex;flex-direction:column;gap:3px">
       <div style="font:13px system-ui;color:${textColor}">Markdown Editor</div>
       <div style="font:11px system-ui;color:${textColor};opacity:.6">README.md — Read Mode</div>
     </div>
   </div>`;

const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#e9eaec;font:12px system-ui;display:flex;flex-direction:column;gap:22px">
  <div style="display:flex;gap:20px">
    ${desktop('#ffffff', 'desktop, light', '#1f2328')}
    ${desktop('#1b1d21', 'desktop, dark', '#e6e6e6')}
  </div>
  <div style="display:flex;flex-direction:column;gap:8px">
    ${taskbar('#f3f3f3')}
    ${taskbar('#202124')}
  </div>
  <div style="display:flex;gap:16px">
    ${altTab('#ffffff', '#1f2328')}
    ${altTab('#202124', '#e6e6e6')}
  </div>
</body></html>`;

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const page = await browser.newPage({ viewport: { width: 720, height: 420 }, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: 'load' });
await page.screenshot({ path: 'design/icon-in-context.png', fullPage: true });
await browser.close();
console.log('wrote design/icon-in-context.png');
