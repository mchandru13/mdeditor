/**
 * Standalone HTML export.
 *
 * Only app-generated markup is assembled here: the input tree is already
 * sanitized, KaTeX output is produced with `trust: false`, and Mermaid SVG is
 * validated before inlining. No document-supplied HTML string is ever written.
 */

import { toHtml } from 'hast-util-to-html';
import { visit } from 'unist-util-visit';
import type { Element, Root } from 'hast';

import { MERMAID_CLASS, MATH_DISPLAY_CLASS, MATH_INLINE_CLASS } from './markdownPipeline';

export const EXPORT_LIMIT_BYTES = 25 * 1024 * 1024;

export interface ExportReport {
  bytes: number;
  imagesEmbedded: number;
  imagesRemote: number;
  imagesUnavailable: number;
  diagramsRendered: number;
  diagramsFailed: number;
  mathRendered: number;
  fontsEmbedded: number;
  truncated: boolean;
}

export interface ExportOptions {
  tree: Root;
  title: string;
  theme: 'light' | 'dark';
  css: string;
  katexCss: string;
  fonts: Record<string, string>;
  renderMermaid: (source: string) => Promise<string>;
  fetchAsDataUrl: (url: string) => Promise<string | null>;
  assetOrigins: string[];
  limitBytes?: number;
}

export class ExportTooLargeError extends Error {
  readonly projectedBytes: number;

  constructor(projectedBytes: number, limit: number) {
    super(
      `The export would be ${Math.round(projectedBytes / 1024 / 1024)} MB, over the ${Math.round(
        limit / 1024 / 1024,
      )} MB limit.`,
    );
    this.name = 'ExportTooLargeError';
    this.projectedBytes = projectedBytes;
  }
}

const UNSAFE_SVG = /<script|onload\s*=|onerror\s*=|javascript:/i;

export function isSafeSvg(svg: string): boolean {
  return !UNSAFE_SVG.test(svg);
}

function textOfEl(node: Element): string {
  return node.children
    .map((child) => {
      if (child.type === 'text') return child.value;
      if (child.type === 'element') return textOfEl(child);
      return '';
    })
    .join('');
}

function classListOf(node: Element): string[] {
  const value = node.properties?.className;
  return Array.isArray(value) ? value.map(String) : [];
}

export function inlineKatexFonts(css: string, fonts: Record<string, string>): { css: string; embedded: number } {
  let embedded = 0;

  const rewritten = css.replace(/url\((["']?)fonts\/([^)"']+)\1\)/g, (match, quote: string, name: string) => {
    const dataUrl = fonts[name];
    if (!dataUrl) return match;
    embedded += 1;
    return `url(${quote}${dataUrl}${quote})`;
  });

  // The stylesheet lists woff2, woff and ttf sources. Only woff2 is embedded, so
  // the remaining relative URLs would 404 from an exported file; drop those
  // sources instead of shipping dead references.
  const withoutDeadSources = rewritten
    .replace(
      /,\s*url\((["']?)fonts\/[^)"']+\.(?:woff|ttf|otf)\1\)\s*(?:format\((["'])[^)]*\2\))?/g,
      '',
    )
    .replace(/url\((["']?)fonts\/[^)"']+\.(?:woff|ttf|otf)\1\)\s*(?:format\([^)]*\))?/g, '');

  return { css: withoutDeadSources, embedded };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function buildStandaloneHtml(options: ExportOptions): Promise<{
  html: string;
  report: ExportReport;
}> {
  const limit = options.limitBytes ?? EXPORT_LIMIT_BYTES;
  const tree = structuredClone<Root>(options.tree);

  const report: ExportReport = {
    bytes: 0,
    imagesEmbedded: 0,
    imagesRemote: 0,
    imagesUnavailable: 0,
    diagramsRendered: 0,
    diagramsFailed: 0,
    mathRendered: 0,
    fontsEmbedded: 0,
    truncated: false,
  };

  const replacements = new Map<Element, Element>();

  visit(tree, 'element', (node: Element, index, parent) => {
    if (!parent || index === undefined || index === null) return;
    const classes = classListOf(node);

    if (classes.includes(MERMAID_CLASS)) {
      const placeholder: Element = { type: 'element', tagName: 'div', properties: { className: ['pending-mermaid'] }, children: [] };
      parent.children[index] = placeholder;
      replacements.set(node, placeholder);
      return;
    }

    if (classes.includes(MATH_INLINE_CLASS) || classes.includes(MATH_DISPLAY_CLASS)) {
      const placeholder: Element = { type: 'element', tagName: 'span', properties: { className: ['pending-math'] }, children: [] };
      parent.children[index] = placeholder;
      replacements.set(node, placeholder);
    }
  });

  const katex = await import('katex');

  for (const [node, placeholder] of replacements) {
    const classes = classListOf(node);
    const source = textOfEl(node);

    if (classes.includes(MERMAID_CLASS)) {
      try {
        const svg = await options.renderMermaid(source);
        if (!isSafeSvg(svg)) throw new Error('diagram contained unsafe markup');
        placeholder.tagName = 'div';
        placeholder.properties = { className: ['mermaid-export'] };
        placeholder.children = [{ type: 'raw', value: svg }];
        report.diagramsRendered += 1;
      } catch {
        placeholder.tagName = 'pre';
        placeholder.properties = { className: ['mermaid-failed'] };
        placeholder.children = [{ type: 'text', value: source }];
        report.diagramsFailed += 1;
      }
      continue;
    }

    const display = classes.includes(MATH_DISPLAY_CLASS);
    try {
      const html = katex.default.renderToString(source, {
        displayMode: display,
        throwOnError: false,
        trust: false,
        strict: 'ignore',
      });
      placeholder.tagName = display ? 'div' : 'span';
      placeholder.properties = { className: [display ? 'math-display' : 'math-inline'] };
      placeholder.children = [{ type: 'raw', value: html }];
      report.mathRendered += 1;
    } catch {
      placeholder.tagName = display ? 'pre' : 'code';
      placeholder.properties = {};
      placeholder.children = [{ type: 'text', value: source }];
    }
  }

  const images: Element[] = [];
  visit(tree, 'element', (node: Element) => {
    if (node.tagName === 'img') images.push(node);
  });

  for (const image of images) {
    const src = image.properties?.src;
    if (typeof src !== 'string' || src.length === 0) continue;

    if (options.assetOrigins.some((origin) => src.startsWith(origin))) {
      const dataUrl = await options.fetchAsDataUrl(src);
      if (dataUrl) {
        image.properties.src = dataUrl;
        report.imagesEmbedded += 1;
      } else {
        const alt = typeof image.properties.alt === 'string' ? image.properties.alt : 'image';
        image.tagName = 'span';
        image.properties = { className: ['image-missing'] };
        image.children = [{ type: 'text', value: `[missing image: ${alt}]` }];
        report.imagesUnavailable += 1;
      }
    } else if (/^https:\/\//i.test(src)) {
      report.imagesRemote += 1;
    } else {
      // Plain-http images are not embedded and are blocked by the export CSP,
      // so they become an explicit placeholder instead of a broken image.
      const alt = typeof image.properties.alt === 'string' ? image.properties.alt : 'image';
      image.tagName = 'span';
      image.properties = { className: ['image-missing'] };
      image.children = [{ type: 'text', value: `[missing image: ${alt}]` }];
      report.imagesUnavailable += 1;
    }
  }

  const katexCss = inlineKatexFonts(options.katexCss, options.fonts);
  report.fontsEmbedded = katexCss.embedded;

  const body = toHtml(tree, { allowDangerousHtml: true });
  const css = `${options.css}\n${katexCss.css}`;

  const html = `<!doctype html>
<html lang="en" data-theme="${options.theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; font-src data:">
<title>${escapeHtml(options.title)}</title>
<style>${css}</style>
</head>
<body>
<main class="markdown-body">${body}</main>
</body>
</html>
`;

  const bytes = new TextEncoder().encode(html).length;
  report.bytes = bytes;
  report.truncated = false;

  if (bytes > limit) {
    throw new ExportTooLargeError(bytes, limit);
  }

  return { html, report };
}

export function formatReport(report: ExportReport): string {
  const parts = [
    `${(report.bytes / 1024).toFixed(0)} KB written`,
    `${report.imagesEmbedded} image(s) embedded`,
  ];

  if (report.imagesRemote > 0) parts.push(`${report.imagesRemote} remote image(s) kept`);
  if (report.imagesUnavailable > 0) parts.push(`${report.imagesUnavailable} image(s) unavailable`);
  if (report.diagramsRendered > 0) parts.push(`${report.diagramsRendered} diagram(s) rendered`);
  if (report.diagramsFailed > 0) parts.push(`${report.diagramsFailed} diagram(s) failed`);
  if (report.fontsEmbedded === 0) parts.push('math fonts not embedded');

  return parts.join(' · ');
}
