import { describe, expect, it } from 'vitest';

import {
  EXPORT_LIMIT_BYTES,
  ExportTooLargeError,
  buildStandaloneHtml,
  formatReport,
  inlineKatexFonts,
} from '../../src/lib/exportHtml';
import { KATEX_CSS, KATEX_FONTS } from '../../src/lib/katexAssets';
import { renderMarkdown } from '../../src/lib/markdownPipeline';
import type { RenderOptions } from '../../src/lib/types';

const OPTIONS: RenderOptions = {
  base: { kind: 'none' },
  assetOrigin: 'http://asset.localhost',
  disableRichContent: false,
};

function treeFor(source: string, overrides: Partial<RenderOptions> = {}) {
  return renderMarkdown(source, { ...OPTIONS, ...overrides }).hast;
}

const baseOptions = {
  title: 'Doc',
  theme: 'light' as const,
  css: 'body{}',
  katexCss: '',
  fonts: {},
  assetOrigins: ['http://asset.localhost'],
  renderMermaid: async () => '<svg role="img"></svg>',
  fetchAsDataUrl: async () => null,
};

describe('standalone HTML export', () => {
  it('reports sizes and a no-script CSP', async () => {
    const { html, report } = await buildStandaloneHtml({ ...baseOptions, tree: treeFor('# Hi\n') });

    expect(html).toContain('<!doctype html>');
    expect(html).toContain("default-src 'none'");
    expect(report.bytes).toBeGreaterThan(0);
    expect(report.bytes).toBe(new TextEncoder().encode(html).length);
  });

  it('renders math to KaTeX markup', async () => {
    const { html, report } = await buildStandaloneHtml({
      ...baseOptions,
      tree: treeFor('$a^2$'),
    });

    expect(report.mathRendered).toBe(1);
    expect(html).toContain('katex');
    expect(html).not.toContain('mdeditor-math-inline');
  });

  it('inlines rendered diagrams', async () => {
    const { html, report } = await buildStandaloneHtml({
      ...baseOptions,
      tree: treeFor('```mermaid\ngraph TD; A-->B;\n```'),
    });

    expect(report.diagramsRendered).toBe(1);
    expect(html).toContain('<svg');
    expect(html).toContain('mermaid-export');
  });

  it('keeps the source when a diagram fails', async () => {
    const { html, report } = await buildStandaloneHtml({
      ...baseOptions,
      tree: treeFor('```mermaid\nnonsense(\n```'),
      renderMermaid: async () => {
        throw new Error('bad diagram');
      },
    });

    expect(report.diagramsFailed).toBe(1);
    expect(html).toContain('nonsense(');
    expect(html).toContain('mermaid-failed');
  });

  it('embeds local images and counts remote ones', async () => {
    const local = await buildStandaloneHtml({
      ...baseOptions,
      tree: treeFor('![a](img/a.png)', { base: { kind: 'file', dir: 'C:\\docs' } }),
      fetchAsDataUrl: async () => 'data:image/png;base64,AAAA',
    });

    expect(local.report.imagesEmbedded).toBe(1);
    expect(local.html).toContain('data:image/png;base64,AAAA');

    const remote = await buildStandaloneHtml({
      ...baseOptions,
      tree: treeFor('![a](https://example.com/a.png)', { remoteImages: 'allow' }),
    });

    expect(remote.report.imagesRemote).toBe(1);
    expect(remote.html).toContain('https://example.com/a.png');
  });

  it('replaces plain-http images, which the export CSP blocks', async () => {
    const { html, report } = await buildStandaloneHtml({
      ...baseOptions,
      tree: treeFor('![a](http://example.com/a.png)', { remoteImages: 'allow' }),
    });

    expect(report.imagesRemote).toBe(0);
    expect(report.imagesUnavailable).toBe(1);
    expect(html).not.toContain('http://example.com/a.png');
    expect(html).toContain('missing image');
  });

  it('refuses exports above the size limit', async () => {
    await expect(
      buildStandaloneHtml({
        ...baseOptions,
        tree: treeFor('# Hi\n'),
        limitBytes: 64,
      }),
    ).rejects.toBeInstanceOf(ExportTooLargeError);
  });

  it('uses the documented default limit', () => {
    expect(EXPORT_LIMIT_BYTES).toBe(25 * 1024 * 1024);
  });

  it('formats a report that names every counted category', () => {
    const message = formatReport({
      bytes: 2048,
      imagesEmbedded: 2,
      imagesRemote: 1,
      imagesUnavailable: 1,
      diagramsRendered: 3,
      diagramsFailed: 1,
      mathRendered: 2,
      fontsEmbedded: 0,
      truncated: false,
    });

    expect(message).toContain('2 KB written');
    expect(message).toContain('2 image(s) embedded');
    expect(message).toContain('1 remote image(s) kept');
    expect(message).toContain('1 image(s) unavailable');
    expect(message).toContain('3 diagram(s) rendered');
    expect(message).toContain('1 diagram(s) failed');
    expect(message).toContain('math fonts not embedded');
  });
});

describe('KaTeX font inlining', () => {
  it('bundles the stylesheet and the fonts the exporter needs', () => {
    expect(KATEX_CSS).toContain('@font-face');
    expect(Object.keys(KATEX_FONTS).length).toBeGreaterThan(0);

    const { embedded } = inlineKatexFonts(KATEX_CSS, KATEX_FONTS);
    expect(embedded).toBeGreaterThan(0);
  });

  it('replaces font URLs with data URLs when available', () => {
    const css = '@font-face{src:url(fonts/KaTeX_Main-Regular.woff2) format("woff2")}';
    const { css: output, embedded } = inlineKatexFonts(css, {
      'KaTeX_Main-Regular.woff2': 'data:font/woff2;base64,AAAA',
    });

    expect(embedded).toBe(1);
    expect(output).toContain('data:font/woff2;base64,AAAA');
    expect(output).not.toContain('fonts/KaTeX_Main-Regular.woff2');
  });

  it('leaves unknown fonts untouched and reports zero', () => {
    const css = 'url(fonts/Unknown.woff2)';
    const { css: output, embedded } = inlineKatexFonts(css, {});
    expect(embedded).toBe(0);
    expect(output).toBe(css);
  });

  it('drops woff and ttf sources that would 404 in an exported file', () => {
    const css =
      'src:url(fonts/A.woff2) format("woff2"),url(fonts/A.woff) format("woff"),url(fonts/A.ttf) format("truetype")';
    const { css: output, embedded } = inlineKatexFonts(css, {
      'A.woff2': 'data:font/woff2;base64,AAAA',
    });

    expect(embedded).toBe(1);
    expect(output).toContain('data:font/woff2;base64,AAAA');
    expect(output).not.toContain('.woff)');
    expect(output).not.toContain('.ttf)');
    expect(output).not.toContain('fonts/A');
  });

  it('removes every relative font reference from the real KaTeX stylesheet', () => {
    const { css, embedded } = inlineKatexFonts(KATEX_CSS, KATEX_FONTS);
    expect(embedded).toBeGreaterThan(0);
    expect(css).not.toMatch(/url\(["']?fonts\//);
  });
});
