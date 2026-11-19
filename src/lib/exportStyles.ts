/** Self-contained stylesheet for exported HTML. Uses literal values (no build
 * pipeline, no external requests) and mirrors the viewer's typography. */
export const EXPORT_CSS = `
:root{color-scheme:light;--bg:#ffffff;--text:#1c1e21;--muted:#5c636b;--border:#d8dbe0;--inset:#f4f5f6;--accent:#1b64c4;--code:#7a2f8a;--kw:#9b1d5c;--str:#1a6b3c;--num:#8a4b00;--com:#6b7280}
html[data-theme="dark"]{color-scheme:dark;--bg:#1b1d21;--text:#e6e8ea;--muted:#a7adb6;--border:#343940;--inset:#23262b;--accent:#6aa8f5;--code:#e0a6f5;--kw:#ff8ab8;--str:#8fd6a8;--num:#f0b072;--com:#8b919a}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:'Segoe UI',system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.65}
.markdown-body{max-width:78ch;margin:0 auto;padding:32px 24px 64px;overflow-wrap:break-word}
.markdown-body>:first-child{margin-top:0}
h1,h2,h3,h4,h5,h6{position:relative;margin:1.6em 0 .6em;line-height:1.25;font-weight:650;scroll-margin-top:16px}
h1{font-size:1.9em;padding-bottom:.3em;border-bottom:1px solid var(--border)}
h2{font-size:1.45em;padding-bottom:.25em;border-bottom:1px solid var(--border)}
h3{font-size:1.2em}h4{font-size:1.05em}
p,ul,ol,blockquote,table{margin:0 0 1em}
ul,ol{padding-left:1.6em}
li+li{margin-top:.25em}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
.anchor{display:none}
blockquote{margin-left:0;padding:.2em 1em;color:var(--muted);border-left:3px solid var(--border);background:var(--inset);border-radius:0 4px 4px 0}
hr{height:1px;border:0;background:var(--border);margin:2em 0}
img{max-width:100%;height:auto;border-radius:4px}
table{width:100%;border-collapse:collapse;font-size:.95em;display:block;overflow-x:auto}
th,td{border:1px solid var(--border);padding:6px 10px;text-align:left;vertical-align:top}
thead th{background:var(--inset);font-weight:600}
code{font-family:'Cascadia Mono',Consolas,ui-monospace,monospace;font-size:.88em;padding:.15em .35em;background:var(--inset);border:1px solid var(--border);border-radius:4px}
pre{margin:0 0 1em;padding:12px 14px;overflow-x:auto;background:var(--inset);border:1px solid var(--border);border-radius:6px;font-size:13px;line-height:1.5}
pre code{padding:0;border:0;background:transparent;font-size:inherit}
.contains-task-list{list-style:none;padding-left:.4em}
.task-list-item{display:flex;gap:.5em;align-items:baseline}
input[type=checkbox]{margin:0}
.footnotes{margin-top:2.5em;padding-top:1em;border-top:1px solid var(--border);font-size:.9em;color:var(--muted)}
.math-display{display:block;margin:1em 0;overflow-x:auto;overflow-y:hidden;padding:4px 0}
.mermaid-export{margin:1em 0;padding:12px;border:1px solid var(--border);border-radius:6px;text-align:center;overflow-x:auto}
.mermaid-export svg{max-width:100%;height:auto}
.mermaid-failed{white-space:pre-wrap}
.image-missing{display:inline-block;padding:2px 6px;border:1px dashed var(--border);border-radius:4px;color:var(--muted);font-size:.9em}
.hljs{color:var(--text);background:transparent}
.hljs-comment,.hljs-quote{color:var(--com);font-style:italic}
.hljs-keyword,.hljs-selector-tag,.hljs-literal,.hljs-type{color:var(--kw)}
.hljs-string,.hljs-regexp,.hljs-addition{color:var(--str)}
.hljs-number,.hljs-built_in,.hljs-symbol{color:var(--num)}
.hljs-title,.hljs-section,.hljs-name{color:var(--accent);font-weight:600}
.hljs-attr,.hljs-attribute,.hljs-variable,.hljs-template-variable{color:var(--code)}
.hljs-emphasis{font-style:italic}.hljs-strong{font-weight:700}
@media print{.markdown-body{max-width:none;padding:0}pre,table,blockquote,.math-display,.mermaid-export{break-inside:avoid}}
`;
