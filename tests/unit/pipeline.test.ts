import { describe, expect, it } from 'vitest';
import { toHtml } from 'hast-util-to-html';

import {
  MERMAID_CLASS,
  MATH_DISPLAY_CLASS,
  MATH_INLINE_CLASS,
  renderMarkdown,
} from '../../src/lib/markdownPipeline';
import type { RenderOptions } from '../../src/lib/types';

const OPTIONS: RenderOptions = {
  base: { kind: 'none' },
  assetOrigin: 'http://asset.localhost',
  disableRichContent: false,
};

function render(source: string, overrides: Partial<RenderOptions> = {}) {
  return renderMarkdown(source, { ...OPTIONS, ...overrides });
}

function html(source: string, overrides: Partial<RenderOptions> = {}): string {
  return toHtml(render(source, overrides).hast);
}

describe('markdown pipeline: GFM', () => {
  it('renders tables', () => {
    const output = html('| a | b |\n| - | - |\n| 1 | 2 |\n');
    expect(output).toContain('<table>');
    expect(output).toContain('<th>a</th>');
    expect(output).toContain('<td>1</td>');
  });

  it('renders task lists as disabled checkboxes', () => {
    const output = html('- [x] done\n- [ ] todo\n');
    expect(output).toContain('type="checkbox"');
    expect(output).toContain('disabled');
    expect(output).toContain('checked');
    expect(output).toContain('class="contains-task-list"');
  });

  it('renders strikethrough', () => {
    expect(html('~~gone~~')).toContain('<del>gone</del>');
  });

  it('renders footnotes', () => {
    const output = html('Text[^1]\n\n[^1]: Note\n');
    expect(output).toContain('footnote-ref');
    expect(output).toContain('class="footnotes"');
  });

  it('renders nested lists', () => {
    const output = html('- a\n  - b\n');
    expect(output).toContain('<ul>');
    expect(output.match(/<ul>/g)?.length).toBe(2);
  });

  it('renders autolinks', () => {
    const output = html('See https://example.com for details');
    expect(output).toContain('href="https://example.com"');
  });

  it('renders horizontal rules', () => {
    expect(html('a\n\n---\n\nb')).toContain('<hr>');
  });
});

describe('markdown pipeline: headings', () => {
  it('adds stable ids and anchors', () => {
    const result = render('# One\n\n## Two\n');
    expect(result.headings.map((heading) => heading.id)).toEqual(['one', 'two']);
    expect(result.headings.map((heading) => heading.depth)).toEqual([1, 2]);

    const output = toHtml(result.hast);
    expect(output).toContain('id="one"');
    expect(output).toContain('class="anchor"');
    expect(output).toContain('href="#one"');
  });

  it('de-duplicates repeated headings', () => {
    const result = render('# Intro\n\n# Intro\n\n# Intro\n');
    expect(result.headings.map((heading) => heading.id)).toEqual(['intro', 'intro-1', 'intro-2']);
  });

  it('records source lines for scroll anchoring', () => {
    const result = render('# First\n\ntext\n\n## Second\n');
    expect(result.headings[0]?.line).toBe(1);
    expect(result.headings[1]?.line).toBe(5);
  });

  it('counts words and reading time', () => {
    const result = render('# Title\n\none two three\n');
    expect(result.stats.words).toBe(4);
    expect(result.stats.readingMinutes).toBe(1);
  });
});

describe('markdown pipeline: math and diagrams', () => {
  it('turns inline math into placeholders, not KaTeX markup', () => {
    const result = render('Euler: $e^{i\\pi}+1=0$');
    expect(result.placeholders.math).toBe(1);
    expect(toHtml(result.hast)).toContain(`class="${MATH_INLINE_CLASS}"`);
    expect(toHtml(result.hast)).not.toContain('katex');
    expect(result.placeholders.math).toBeGreaterThan(0);
  });

  it('turns block math into display placeholders', () => {
    const result = render('$$\n\\int_0^1 x dx\n$$');
    expect(result.placeholders.math).toBe(1);
    expect(toHtml(result.hast)).toContain(MATH_DISPLAY_CLASS);
  });

  it('turns mermaid fences into placeholders with the source preserved', () => {
    const result = render('```mermaid\ngraph TD;\nA-->B;\n```');
    const output = toHtml(result.hast);

    expect(result.placeholders.mermaid).toBe(1);
    expect(output).toContain(MERMAID_CLASS);
    expect(output).toContain('graph TD;');
    expect(output).not.toContain('<pre>');
  });

  it('leaves ordinary code fences highlighted, not placeholdered', () => {
    const result = render('```js\nconst a = 1;\n```');
    const output = toHtml(result.hast);

    expect(result.placeholders.mermaid).toBe(0);
    expect(output).toContain('hljs');
    expect(output).toContain('language-js');
  });

  it('degrades to plain placeholders when rich content is disabled', () => {
    const result = render('```mermaid\ngraph TD;\nA-->B;\n```', { disableRichContent: true });
    expect(result.placeholders.mermaid).toBe(0);
    expect(toHtml(result.hast)).toContain('mdeditor-placeholder');
  });
});

describe('markdown pipeline: resources', () => {
  it('resolves local images through the asset protocol', () => {
    const output = html('![alt](img/a.png)', {
      base: { kind: 'file', dir: 'C:\\docs' },
    });
    expect(output).toContain('http://asset.localhost/');
    expect(output).toContain('alt="alt"');
  });

  it('resolves remote relatives against the remote base', () => {
    const output = html('[docs](guide/intro.md)', {
      base: { kind: 'remote', url: 'https://example.com/a/readme.md' },
    });
    expect(output).toContain('https://example.com/a/guide/intro.md');
  });

  it('marks external links with noopener noreferrer', () => {
    const output = html('[x](https://example.com)');
    expect(output).toContain('target="_blank"');
    expect(output).toContain('rel="noopener noreferrer"');
  });

  it('keeps unresolved pasted relatives as-is', () => {
    const output = html('![alt](img/a.png)', { base: { kind: 'none' } });
    expect(output).toContain('src="img/a.png"');
  });
});
