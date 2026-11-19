import { describe, expect, it } from 'vitest';
import { toHtml } from 'hast-util-to-html';

import { isKnownLanguage, rehypeTrimmedHighlight } from '../../src/lib/highlight';
import { renderMarkdown } from '../../src/lib/markdownPipeline';
import type { RenderOptions } from '../../src/lib/types';

const OPTIONS: RenderOptions = {
  base: { kind: 'none' },
  assetOrigin: null,
  disableRichContent: false,
};

function html(source: string): string {
  return toHtml(renderMarkdown(source, OPTIONS).hast);
}

function dom(source: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html(source);
  return host;
}

describe('trimmed highlighting', () => {
  it('knows the registered languages and their aliases', () => {
    for (const language of ['javascript', 'js', 'ts', 'tsx', 'py', 'rs', 'sh', 'yml', 'html']) {
      expect(isKnownLanguage(language), language).toBe(true);
    }
    expect(isKnownLanguage('brainfuck')).toBe(false);
  });

  it('highlights a known language', () => {
    const host = dom('```js\nconst x = 1;\n```');
    const code = host.querySelector('code');

    expect(host.querySelector('.hljs-keyword')).not.toBeNull();
    expect(host.querySelector('.hljs-number')).not.toBeNull();
    expect(code?.classList.contains('language-js')).toBe(true);
  });

  it('highlights alias languages such as typescript and python', () => {
    expect(html('```ts\nconst x: number = 1;\n```')).toContain('hljs-keyword');
    expect(html('```py\ndef f():\n    return 1\n```')).toContain('hljs-keyword');
  });

  it('leaves an unknown language as plain code instead of failing', () => {
    const host = dom('```brainfuck\n++[>++<-]\n```');
    const code = host.querySelector('code');

    expect(code?.classList.contains('language-brainfuck')).toBe(true);
    expect(host.querySelector('[class*="hljs-"]')).toBeNull();
    expect(code?.textContent?.trim()).toBe('++[>++<-]');
  });

  it('leaves indented code and language-less fences plain', () => {
    const output = html('```\nplain text\n```');
    expect(output).toContain('<pre><code>plain text');
  });

  it('keeps highlighting the rest of the document when one block is unknown', () => {
    const output = html('```brainfuck\n++\n```\n\n```js\nconst a = 1;\n```');
    expect(output).toContain('hljs-keyword');
  });

  it('escapes code content', () => {
    const host = dom('```js\nconst html = "<script>";\n```');
    expect(host.querySelector('script')).toBeNull();
    expect(host.querySelector('code')?.textContent).toContain('<script>');
  });

  it('supports restricting the allowed languages', () => {
    const tree = renderMarkdown('```js\nconst a = 1;\n```', {
      ...OPTIONS,
      disableRichContent: true,
    }).hast;

    rehypeTrimmedHighlight(['python'])(tree);
    expect(toHtml(tree)).not.toContain('hljs-keyword');

    const allowedTree = renderMarkdown('```js\nconst a = 1;\n```', {
      ...OPTIONS,
      disableRichContent: true,
    }).hast;
    rehypeTrimmedHighlight(['js'])(allowedTree);
    expect(toHtml(allowedTree)).toContain('hljs-keyword');
  });
});
