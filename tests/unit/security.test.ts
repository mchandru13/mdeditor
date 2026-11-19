import { describe, expect, it } from 'vitest';
import { toHtml } from 'hast-util-to-html';

import { buildSanitizeSchema, renderMarkdown } from '../../src/lib/markdownPipeline';
import { buildStandaloneHtml, isSafeSvg } from '../../src/lib/exportHtml';
import type { RenderOptions } from '../../src/lib/types';

const OPTIONS: RenderOptions = {
  base: { kind: 'none' },
  assetOrigin: 'http://asset.localhost',
  disableRichContent: false,
};

function render(source: string) {
  const result = renderMarkdown(source, OPTIONS);
  return { html: toHtml(result.hast), result };
}

/** Parses rendered output so assertions are about real DOM semantics rather than
 * string escaping. */
function toDom(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
}

const FORBIDDEN_ELEMENTS = 'script, iframe, object, embed, style, form, foreignObject';

function unsafeAttributes(root: HTMLElement): string[] {
  const offenders: string[] = [];
  for (const element of Array.from(root.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      if (/^on/i.test(attribute.name)) offenders.push(`${element.tagName}[${attribute.name}]`);
      if (/^\s*(javascript|vbscript|data:text\/html|file):/i.test(attribute.value)) {
        offenders.push(`${element.tagName}[${attribute.name}=${attribute.value}]`);
      }
    }
  }
  return offenders;
}

const PAYLOADS: { name: string; source: string }[] = [
  { name: 'script tag', source: '<script>alert(1)</script>' },
  { name: 'img onerror', source: '<img src=x onerror="alert(1)">' },
  { name: 'svg onload', source: '<svg onload="alert(1)"></svg>' },
  { name: 'iframe srcdoc', source: '<iframe srcdoc="<script>alert(1)</script>"></iframe>' },
  { name: 'object data', source: '<object data="data:text/html,<script>alert(1)</script>"></object>' },
  { name: 'style import', source: '<style>@import url("https://evil.test/x.css")</style>' },
  { name: 'foreignObject', source: '<svg><foreignObject><iframe src="x"></iframe></foreignObject></svg>' },
  { name: 'javascript link', source: '[click](javascript:alert(1))' },
  { name: 'encoded javascript link', source: '[click](&#106;avascript:alert(1))' },
  { name: 'vbscript link', source: '[click](vbscript:msgbox(1))' },
  { name: 'data uri image', source: '![x](data:text/html;base64,PHNjcmlwdD4=)' },
  { name: 'file uri image', source: '![x](file:///C:/Windows/win.ini)' },
  { name: 'html comment script', source: '<!--<script>alert(1)</script>-->' },
  { name: 'onclick attribute', source: '<a href="#" onclick="alert(1)">x</a>' },
  { name: 'form post', source: '<form action="https://evil.test"><input name="x"></form>' },
];

describe('security: sanitization', () => {
  for (const payload of PAYLOADS) {
    it(`neutralises ${payload.name}`, () => {
      const { html } = render(payload.source);
      const dom = toDom(html);

      expect(dom.querySelectorAll(FORBIDDEN_ELEMENTS)).toHaveLength(0);
      expect(unsafeAttributes(dom)).toEqual([]);
      for (const node of Array.from(dom.querySelectorAll('[src], [href]'))) {
        const target = node.getAttribute('src') ?? node.getAttribute('href') ?? '';
        expect(target).not.toMatch(/^\s*(javascript|vbscript|data:text\/html|file):/i);
      }
    });
  }

  it('shows raw HTML as literal text rather than dropping it silently', () => {
    const dom = toDom(render('<b>bold</b>').html);
    expect(dom.textContent).toBe('<b>bold</b>');
    expect(dom.querySelector('b')).toBeNull();
  });

  it('keeps http and https links', () => {
    const dom = toDom(render('[a](https://example.com) [b](http://example.com)').html);
    expect(dom.querySelector('a[href="https://example.com"]')).not.toBeNull();
    expect(dom.querySelector('a[href="http://example.com"]')).not.toBeNull();
  });

  it('keeps mailto links', () => {
    const dom = toDom(render('[mail](mailto:a@b.test)').html);
    expect(dom.querySelector('a[href="mailto:a@b.test"]')).not.toBeNull();
  });

  it('adds rel=noopener noreferrer to external links', () => {
    const dom = toDom(render('[x](https://example.com)').html);
    const link = dom.querySelector('a');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link?.getAttribute('target')).toBe('_blank');
  });

  it('does not allow style attributes or dangerous elements in the schema', () => {
    const schema = buildSanitizeSchema();
    expect(schema.attributes?.['*']).not.toContain('style');
    expect(schema.tagNames).not.toContain('iframe');
    expect(schema.tagNames).not.toContain('script');
    expect(schema.tagNames).not.toContain('svg');
  });

  it('strips image sources with unsupported protocols', () => {
    const dom = toDom(render('![x](data:image/svg+xml;base64,PHN2Zz4=)').html);
    expect(dom.querySelector('img')?.hasAttribute('src')).toBe(false);
  });

  it('allows highlight.js classes so code stays highlighted', () => {
    const dom = toDom(render('```js\nconst a = 1;\n```').html);
    expect(dom.querySelector('.hljs-keyword')).not.toBeNull();
    expect(dom.querySelector('.hljs-number')).not.toBeNull();
  });
});

describe('security: mermaid', () => {
  it('rejects SVG containing script or handlers', () => {
    expect(isSafeSvg('<svg><script>alert(1)</script></svg>')).toBe(false);
    expect(isSafeSvg('<svg onload="alert(1)"></svg>')).toBe(false);
    expect(isSafeSvg('<svg><a href="javascript:alert(1)">x</a></svg>')).toBe(false);
    expect(isSafeSvg('<svg><rect width="1"/></svg>')).toBe(true);
  });

  it('keeps mermaid source as text, never as HTML', () => {
    const dom = toDom(render('```mermaid\n<html><script>alert(1)</script></html>\n```').html);
    expect(dom.querySelector('script')).toBeNull();
    expect(dom.textContent).toContain('<script>alert(1)</script>');
  });
});

describe('security: exported HTML', () => {
  const tree = renderMarkdown('# Title\n\n![x](https://example.com/a.png)\n', OPTIONS).hast;

  const baseOptions = {
    title: 'Doc',
    theme: 'light' as const,
    css: 'body{}',
    katexCss: '',
    fonts: {},
    assetOrigins: ['http://asset.localhost'],
    renderMermaid: async () => '<svg></svg>',
    fetchAsDataUrl: async () => null,
  };

  it('is inert and declares a no-script CSP', async () => {
    const { html } = await buildStandaloneHtml({ ...baseOptions, tree });
    const dom = toDom(html);

    expect(html).toContain('http-equiv="Content-Security-Policy"');
    expect(html).toContain("default-src 'none'");
    expect(dom.querySelectorAll('script, iframe, object, embed')).toHaveLength(0);
    expect(unsafeAttributes(dom)).toEqual([]);
  });

  it('never emits absolute local filesystem paths', async () => {
    const localTree = renderMarkdown('![x](img/a.png)', {
      ...OPTIONS,
      base: { kind: 'file', dir: 'C:\\Users\\secret\\docs' },
    }).hast;

    const { html, report } = await buildStandaloneHtml({ ...baseOptions, tree: localTree });

    expect(html).not.toContain('secret');
    expect(html).not.toContain('C:\\');
    expect(report.imagesUnavailable).toBe(1);
    expect(html).toContain('missing image');
  });

  it('escapes the document title', async () => {
    const { html } = await buildStandaloneHtml({
      ...baseOptions,
      tree,
      title: '<script>alert(1)</script>',
    });

    expect(toDom(html).querySelector('script')).toBeNull();
    expect(html).toContain('&lt;script&gt;');
  });
});
