import { describe, expect, it } from 'vitest';
import { toHtml } from 'hast-util-to-html';

import {
  CHUNK_SIZE,
  CHUNK_THRESHOLD,
  collectDefinitionLines,
  parseMarkdown,
  renderMarkdown,
  splitMarkdown,
} from '../../src/lib/markdownPipeline';
import type { RenderOptions } from '../../src/lib/types';

const OPTIONS: RenderOptions = {
  base: { kind: 'none' },
  assetOrigin: null,
  disableRichContent: false,
};

function paragraph(index: number): string {
  return `Paragraph ${index} with enough text to matter for chunk boundaries.\n\n`;
}

describe('chunked parsing', () => {
  it('returns a single chunk for small documents', () => {
    const chunks = splitMarkdown('# Title\n\nBody\n');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.startLine).toBe(1);
  });

  it('splits a large document into ordered chunks', () => {
    const source = Array.from({ length: 4000 }, (_, index) => paragraph(index)).join('');
    const chunks = splitMarkdown(source);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((chunk) => chunk.text).join('')).toBe(source);
    expect(chunks[0]?.startLine).toBe(1);
    expect(chunks[1]?.startLine).toBeGreaterThan(1);
  });

  it('never splits inside a fenced code block', () => {
    const code = `${'```js\n'}${'const a = 1;\n'.repeat(4000)}${'```\n'}`;
    const chunks = splitMarkdown(code);

    for (const chunk of chunks) {
      const fences = (chunk.text.match(/^```/gm) ?? []).length;
      expect(fences % 2).toBe(0);
    }
  });

  it('does not split between a paragraph and a setext underline', () => {
    const source = `${'x'.repeat(CHUNK_SIZE)}\n\nTitle\n=====\n\nbody\n`;
    const chunks = splitMarkdown(source);
    expect(chunks.some((chunk) => chunk.text.trimStart().startsWith('Title'))).toBe(true);
  });

  it('keeps heading line numbers absolute after chunking', () => {
    const filler = Array.from({ length: 1200 }, (_, index) => paragraph(index)).join('');
    const source = `${filler}# Late heading\n\nbody\n`;
    expect(source.length).toBeGreaterThan(CHUNK_THRESHOLD);

    const chunked = renderMarkdown(source, OPTIONS);
    const plain = renderMarkdown(source, { ...OPTIONS, chunking: false });

    expect(chunked.headings).toHaveLength(plain.headings.length);
    expect(chunked.headings.at(-1)?.text).toBe('Late heading');
    expect(chunked.headings.at(-1)?.line).toBe(plain.headings.at(-1)?.line);
  });

  it('produces the same headings with and without chunking', () => {
    const source = Array.from({ length: 4000 }, (_, index) => `## Heading ${index}\n\ntext\n\n`).join('');
    expect(source.length).toBeGreaterThan(CHUNK_THRESHOLD);

    const chunked = renderMarkdown(source, OPTIONS);
    const plain = renderMarkdown(source, { ...OPTIONS, chunking: false });

    expect(chunked.headings.map((heading) => heading.id)).toEqual(
      plain.headings.map((heading) => heading.id),
    );
  });

  it('keeps unique slugs across chunk boundaries', () => {
    const source = `${'## Duplicate\n\ntext\n\n'.repeat(2000)}`;
    const chunked = renderMarkdown(source, OPTIONS);
    const ids = chunked.headings.map((heading) => heading.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('parses with chunking enabled by default above the threshold', () => {
    const source = `${'text\n\n'.repeat(30000)}# Final\n`;
    const tree = parseMarkdown(source);
    expect(tree.children.length).toBeGreaterThan(0);
  });

  it('renders the same HTML for simple content with and without chunking', () => {
    const source = Array.from({ length: 1200 }, (_, index) => `## H${index}\n\nbody ${index}\n\n`).join('');
    const withoutChunking = toHtml(renderMarkdown(source, { ...OPTIONS, chunking: false }).hast);
    const withChunking = toHtml(renderMarkdown(source, OPTIONS).hast);

    expect(withChunking).toBe(withoutChunking);
  });

  it(
    'does not split lists or blockquotes across chunk boundaries',
    () => {
      const source = Array.from(
        { length: 1800 },
        (_, index) => `- item ${index} of a list\n\n- second ${index}\n\n> quote ${index}\n\n`,
      ).join('');
      expect(source.length).toBeGreaterThan(CHUNK_THRESHOLD);

      const chunked = renderMarkdown(source, OPTIONS);
      const plain = renderMarkdown(source, { ...OPTIONS, chunking: false });

      expect(toHtml(chunked.hast)).toBe(toHtml(plain.hast));
      expect(chunked.headings.length).toBe(plain.headings.length);
    },
    // The unchunked parse deliberately takes the slow path this test contrasts.
    30000,
  );

  it('resolves reference links whose definition is in a later chunk', () => {
    const filler = Array.from({ length: 1200 }, (_, index) => paragraph(index)).join('');
    const source = `${filler}[link][ref] and [^note]\n\n[ref]: https://example.com/target\n\n[^note]: footnote body\n`;
    expect(source.length).toBeGreaterThan(CHUNK_THRESHOLD);

    const html = toHtml(renderMarkdown(source, OPTIONS).hast);
    const reference = toHtml(renderMarkdown(source, { ...OPTIONS, chunking: false }).hast);

    expect(html).toContain('href="https://example.com/target"');
    expect(html).toContain('footnote-ref');
    expect(html).toBe(reference);
  });

  it('collects definitions outside fenced code blocks only', () => {
    const source = '```\n[not]: a-definition\n```\n\n[real]: https://example.com\n';
    expect(collectDefinitionLines(source)).toEqual(['[real]: https://example.com']);
  });

  it('collects indented continuation lines of a definition', () => {
    const source = '[ref]:\n  https://example.com/target\n\nbody\n';
    expect(collectDefinitionLines(source)).toEqual([
      '[ref]:\n  https://example.com/target',
    ]);
  });

  it('resolves a multi-line definition that sits after a chunk boundary', () => {
    const filler = Array.from({ length: 1200 }, (_, index) => paragraph(index)).join('');
    const source = `${filler}[link][ref]\n\n[ref]:\n  https://example.com/multi\n`;
    expect(source.length).toBeGreaterThan(CHUNK_THRESHOLD);

    expect(toHtml(renderMarkdown(source, OPTIONS).hast)).toContain(
      'href="https://example.com/multi"',
    );
  });

  it('ignores definitions when the document is small enough to parse whole', () => {
    const source = '[a][ref]\n\n[ref]: https://example.com\n';
    const html = toHtml(renderMarkdown(source, OPTIONS).hast);
    expect(html).toContain('href="https://example.com"');
  });
});
