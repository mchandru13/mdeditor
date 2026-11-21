import { describe, expect, it } from 'vitest';
import { toHtml } from 'hast-util-to-html';

import {
  MERMAID_CLASS,
  MATH_DISPLAY_CLASS,
  MATH_INLINE_CLASS,
  renderMarkdown,
} from '../../src/lib/markdownPipeline';
import { commentBlockStarts } from '../../src/lib/comments';
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

  it('blocks remote images by default so opening a file cannot beacon', () => {
    const output = render('![tracker](https://attacker.test/pixel.png)', {
      base: { kind: 'file', dir: 'C:\\docs' },
    });

    // The URL may survive as a tooltip, but never as a fetchable attribute.
    expect(toHtml(output.hast)).not.toContain('<img');
    expect(toHtml(output.hast)).not.toContain('src="https://attacker.test');
    expect(toHtml(output.hast)).toContain('mdeditor-remote-image');
    expect(output.placeholders.blockedRemoteImages).toBe(1);
  });

  it('loads remote images when the document opts in', () => {
    const output = render('![tracker](https://attacker.test/pixel.png)', {
      base: { kind: 'file', dir: 'C:\\docs' },
      remoteImages: 'allow',
    });

    expect(toHtml(output.hast)).toContain('https://attacker.test/pixel.png');
    expect(output.placeholders.blockedRemoteImages).toBe(0);
  });

  it('still resolves local images when remote images are blocked', () => {
    const output = render('![local](img/a.png)', {
      base: { kind: 'file', dir: 'C:\\docs' },
    });

    expect(toHtml(output.hast)).toContain('http://asset.localhost/');
    expect(output.placeholders.blockedRemoteImages).toBe(0);
  });

  it('keeps the alt text visible when a remote image is blocked', () => {
    const output = render('![a chart](https://attacker.test/c.png)', { base: { kind: 'none' } });
    expect(toHtml(output.hast)).toContain('a chart');
  });
});

describe('markdown pipeline: comments', () => {
  const COMMENT = '> [!comment] chand 2026-11-21\n>\n> Is this safe?\n';

  it('marks a comment blockquote so it can be styled', () => {
    const output = html(`${COMMENT}`);
    expect(output).toContain('class="mdeditor-comment"');
    expect(output).toContain('mdeditor-comment-header');
    expect(output).toContain('chand 2026-11-21');
    expect(output).toContain('Is this safe?');
  });

  it('drops the marker text from the rendered header', () => {
    expect(html(COMMENT)).not.toContain('[!comment]');
  });

  it('leaves an ordinary blockquote alone', () => {
    const output = html('> just a quote\n');
    expect(output).not.toContain('mdeditor-comment');
  });

  it('leaves a quoted marker mid-sentence alone', () => {
    const output = html('> He wrote [!comment] in the margin.\n');
    expect(output).not.toContain('mdeditor-comment');
  });

  it('does not treat a comment inside a fence as a comment', () => {
    const output = html(['```', '> [!comment] x', '> body', '```', ''].join('\n'));
    expect(output).not.toContain('mdeditor-comment');
    expect(output).toContain('[!comment]');
  });

  it('excludes comment text from the word count', () => {
    const withComment = render(`one two three\n\n${COMMENT}`);
    const withoutComment = render('one two three\n');
    expect(withComment.stats.words).toBe(withoutComment.stats.words);
  });

  it('sanitizes markup inside a comment body like any other document text', () => {
    const output = html('> [!comment]\n>\n> **bold** and [x](https://e.test)\n');
    expect(output).toContain('<strong>bold</strong>');
    expect(output).toContain('href="https://e.test"');
  });

  it('does not let a comment inject script', () => {
    const output = html('> [!comment]\n>\n> <script>alert(1)</script>\n');
    expect(output).not.toContain('<script');
  });
});

describe('markdown pipeline: comment vs quote boundaries', () => {
  it('keeps inline formatting in the header', () => {
    const output = html('> [!comment] **chand** 2026-11-21\n>\n> body\n');
    expect(output).toContain('mdeditor-comment-header');
    expect(output).toContain('<strong>chand</strong>');
    expect(output).not.toContain('[!comment]');
  });

  it('does not tag a quote whose second paragraph is a marker', () => {
    const source = '> - keep this list item\n>\n> [!comment] note\n';
    const output = html(source);
    expect(output).not.toContain('mdeditor-comment');
    expect(output).toContain('keep this list item');
    // The list item is real content, so it is counted.
    expect(render(source).stats.words).toBeGreaterThan(0);
  });

  it('does not tag a soft-wrapped marker, matching the source scanner', () => {
    const output = html('> [!comment] chand\n> internal note\n');
    expect(output).not.toContain('mdeditor-comment');
    expect(output).toContain('[!comment]');
  });

  it('does not put a heading inside a comment in the outline', () => {
    const output = render('> [!comment]\n>\n> # Not a section\n>\n> body\n');
    expect(output.headings).toHaveLength(0);
  });
});

describe('markdown pipeline: comment canonical form', () => {
  it('keeps a list under a marker-only blockquote', () => {
    const source = '> [!comment] x\n> - keep this item\n';
    const output = render(source);
    expect(toHtml(output.hast)).not.toContain('mdeditor-comment');
    expect(output.stats.words).toBeGreaterThan(0);
  });

  it('keeps content when a formatted header is followed by a note', () => {
    const source = '> [!comment] **chand**\n> internal note\n';
    const output = render(source);
    expect(toHtml(output.hast)).not.toContain('mdeditor-comment');
    expect(output.stats.words).toBeGreaterThan(0);
  });

  it('keeps a code fence under a marker-only blockquote', () => {
    const source = '> [!comment] x\n> ```\n> code\n> ```\n';
    expect(toHtml(render(source).hast)).not.toContain('mdeditor-comment');
  });

  it('still marks the canonical form with a formatted header', () => {
    const output = html('> [!comment] **chand**\n>\n> body\n');
    expect(output).toContain('mdeditor-comment-header');
    expect(output).toContain('<strong>chand</strong>');
    expect(output).not.toContain('[!comment]');
  });
});

describe('markdown pipeline: comment agreement', () => {
  function taggedComments(source: string): number {
    let count = 0;
    visitTree(render(source).hast);
    return count;

    function visitTree(node: { type: string; tagName?: string; properties?: unknown; children?: unknown[] }) {
      if (node.type === 'element' && node.tagName === 'blockquote') {
        const classes = (node.properties as { className?: unknown } | undefined)?.className;
        if (Array.isArray(classes) && classes.map(String).includes('mdeditor-comment')) count += 1;
      }
      for (const child of (node.children ?? []) as typeof node[]) visitTree(child);
    }
  }

  it('tags exactly the blocks the source scanner calls comments', () => {
    const docs = [
      '> [!comment] chand\n>\n> body\n',
      '> [!comment]\n',
      '> [!comment] chand\n> internal note\n',
      '> [!comment] **chand**\n> internal note\n',
      '> [!comment] x\n> - list item\n',
      '> [!comment] x\n>\n> - list item\n',
      '```\n> [!comment] x\n>\n> body\n```\n',
      '> [!comment] a\n>\n> one\n\n> [!comment] b\n>\n> two\n',
      'plain\n\n> quote\n\n> [!comment] me\n>\n> body\n',
    ];
    for (const source of docs) {
      expect(taggedComments(source)).toBe(commentBlockStarts(source).length);
    }
  });

  it('reports outline lines that do not drift past a comment heading', () => {
    const source = [
      '# Real one',
      '',
      '> [!comment] me',
      '>',
      '> # Inside comment',
      '>',
      '> body',
      '',
      '# Real two',
      '',
    ].join('\n');
    const output = render(source);
    expect(output.headings.map((heading) => heading.text)).toEqual(['Real one', 'Real two']);
    expect(output.headings[1]?.line).toBe(9);
  });
});

describe('markdown pipeline: comment scanner over-approximation', () => {
  it('declines to tag a scanned block whose marker is not text, hiding nothing', () => {
    const source = '[!comment]: https://e.test\n\n> [!comment]\n>\n> internal note\n';
    expect(commentBlockStarts(source)).toHaveLength(1);
    const output = render(source);
    expect(toHtml(output.hast)).not.toContain('mdeditor-comment');
    expect(output.stats.words).toBeGreaterThan(0);
  });

  it('declines to tag a marker line that parses as indented code', () => {
    const source = '>     [!comment] x\n>\n> body\n';
    expect(commentBlockStarts(source)).toHaveLength(1);
    const output = render(source);
    expect(toHtml(output.hast)).not.toContain('mdeditor-comment');
    expect(output.stats.words).toBeGreaterThan(0);
  });
});

describe('markdown pipeline: comment statistics', () => {
  it('does not count a blocked remote-image placeholder inside a comment', () => {
    const withComment = render(
      'Body text.\n\n> [!comment] me\n>\n> ![diagram](https://example.com/a.png)\n',
    );
    const withoutComment = render('Body text.\n');
    expect(withComment.placeholders.blockedRemoteImages).toBe(1);
    expect(withComment.stats.words).toBe(withoutComment.stats.words);
    expect(withComment.stats.characters).toBe(withoutComment.stats.characters);
  });
});
