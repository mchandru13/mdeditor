/**
 * Markdown pipeline: parse → placeholders → sanitize → themeable HAST.
 *
 * Order is deliberate and load-bearing:
 *   1. remark-parse / gfm / math, chunked for large documents (see below)
 *   2. remark-rehype (math becomes placeholder elements, never KaTeX HTML)
 *   3. mermaid fenced blocks become placeholder elements
 *   4. rehype-highlight (plain, sanitizable HTML)
 *   5. rehype-sanitize with an explicit allowlist
 *   6. trusted post-processing: resource URLs and heading anchors
 *
 * Nothing after step 5 may accept an HTML string from the document.
 *
 * Chunking: micromark's block-container handling is superlinear (a 256 KB file
 * of blockquotes takes ~8.7 s against 0.4 s at 64 KB), so documents above
 * CHUNK_THRESHOLD are parsed in blank-line-separated chunks and their mdast
 * children are concatenated with adjusted positions. Splits only happen at a
 * blank line followed by a column-zero, non-list/non-quote line, never inside a
 * fenced code block. The trade-off is that a list or blockquote spanning such a
 * boundary renders as two adjacent blocks.
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeHighlight from 'rehype-highlight';
import { visit } from 'unist-util-visit';
import { toString } from 'mdast-util-to-string';
import type { Element, Root as HastRoot, Text } from 'hast';
import type { Root as MdastRoot, Html, Nodes } from 'mdast';
import type { Options as RehypeOptions } from 'remark-rehype';

import { resolveResource } from './assetResolver';
import { countWords } from './encoding';
import { createSlugger } from './slug';
import type {
  DocumentStats,
  HeadingEntry,
  PlaceholderSummary,
  RenderOptions,
} from './types';

export const MATH_INLINE_CLASS = 'mdeditor-math-inline';
export const MATH_DISPLAY_CLASS = 'mdeditor-math-display';
export const MERMAID_CLASS = 'mdeditor-mermaid';

/** Documents above this size are parsed in chunks. */
export const CHUNK_THRESHOLD = 64 * 1024;
/** Target chunk size. Smaller chunks stay further from micromark's superlinear
 * region at the cost of slightly more semantic breaks. */
export const CHUNK_SIZE = 16 * 1024;

type SanitizeSchema = NonNullable<Parameters<typeof rehypeSanitize>[0]>;
type RehypeHandlers = NonNullable<RehypeOptions['handlers']>;

const CLASS_NAME_PATTERN =
  /^(hljs(-[\w-]+)?|mdeditor-[\w-]+|footnote[\w-]*|task-list-item|contains-task-list|anchor|math-[\w-]+)$/;

export function buildSanitizeSchema(): SanitizeSchema {
  const base = defaultSchema;
  const wildcard = base.attributes?.['*'] ?? [];

  return {
    ...base,
    tagNames: [
      ...(base.tagNames ?? []),
      'del',
      'input',
      'section',
      'sup',
      'sub',
      'kbd',
      'mark',
      'details',
      'summary',
    ],
    attributes: {
      ...base.attributes,
      '*': [...wildcard, ['className', CLASS_NAME_PATTERN], 'dir', 'lang', 'title'],
      a: [...(base.attributes?.a ?? []), 'target', 'rel'],
      img: [...(base.attributes?.img ?? []), 'width', 'height', 'loading', 'decoding'],
      input: ['type', 'checked', 'disabled'],
      h1: ['id'],
      h2: ['id'],
      h3: ['id'],
      h4: ['id'],
      h5: ['id'],
      h6: ['id'],
      section: [...(base.attributes?.section ?? []), ['className', CLASS_NAME_PATTERN], 'id'],
    },
    protocols: {
      ...base.protocols,
      href: ['http', 'https', 'mailto', 'asset'],
      src: ['http', 'https', 'asset'],
    },
  };
}

const SANITIZE_SCHEMA = buildSanitizeSchema();

/** Raw HTML is disabled: HTML nodes become literal text, so `<b>x</b>` is shown
 * exactly as written and never reaches the DOM as markup. */
function remarkDisableRawHtml() {
  return (tree: MdastRoot) => {
    visit(tree, 'html', (node: Html, index, parent) => {
      if (!parent || index === undefined || index === null) return;
      parent.children[index] = { type: 'text', value: node.value };
    });
  };
}

/** Replaces `<pre><code class="language-mermaid">` with a placeholder element
 * whose text child is the diagram source. Mermaid runs later, in React. */
function rehypeMermaidPlaceholders() {
  return (tree: HastRoot) => {
    visit(tree, 'element', (node: Element, index, parent) => {
      if (node.tagName !== 'pre' || !parent || index === undefined) return;

      const code = node.children.find(
        (child): child is Element => child.type === 'element' && child.tagName === 'code',
      );
      if (!code) return;

      const classes = Array.isArray(code.properties?.className)
        ? code.properties.className.map(String)
        : [];
      if (!classes.includes('language-mermaid')) return;

      const source = code.children
        .map((child) => (child.type === 'text' ? child.value : ''))
        .join('');

      const placeholder: Element = {
        type: 'element',
        tagName: 'div',
        properties: { className: [MERMAID_CLASS] },
        children: [{ type: 'text', value: source }],
      };

      parent.children[index] = placeholder;
      return undefined;
    });
  };
}

function applyHighlight(tree: HastRoot): HastRoot {
  try {
    return unified()
      .use(rehypeHighlight, { detect: false })
      .runSync(tree) as HastRoot;
  } catch {
    // Unknown language or a highlight.js failure must never break the document.
    return tree;
  }
}

function rewriteResources(tree: HastRoot, options: RenderOptions): void {
  visit(tree, 'element', (node: Element) => {
    if (node.tagName !== 'img' && node.tagName !== 'a') return;
    const key = node.tagName === 'img' ? 'src' : 'href';
    const value = node.properties?.[key];
    if (typeof value !== 'string') return;

    const resolved = resolveResource(value, options.base, options.assetOrigin);
    node.properties[key] = resolved.url;

    if (node.tagName === 'a' && !resolved.local && !resolved.url.startsWith('#')) {
      node.properties.target = '_blank';
      node.properties.rel = ['noopener', 'noreferrer'];
    }
  });
}

function addHeadingAnchors(tree: HastRoot): HeadingEntry[] {
  const nextSlug = createSlugger();
  const headings: HeadingEntry[] = [];

  visit(tree, 'element', (node: Element) => {
    if (!/^h[1-6]$/.test(node.tagName)) return;

    const text = toText(node).trim();
    const id = nextSlug(text);
    const depth = Number(node.tagName.slice(1));

    node.properties = { ...node.properties, id };
    node.children.unshift({
      type: 'element',
      tagName: 'a',
      properties: {
        className: ['anchor'],
        href: `#${id}`,
        ariaHidden: 'true',
        tabIndex: -1,
      },
      children: [{ type: 'text', value: '#' }],
    });

    headings.push({ id, text, depth, line: 0 });
  });

  return headings;
}

function collectHeadingLines(tree: MdastRoot): number[] {
  const lines: number[] = [];
  visit(tree, 'heading', (node) => {
    lines.push(node.position?.start.line ?? 1);
  });
  return lines;
}

export function toText(node: Element | Text | HastRoot): string {
  if (node.type === 'text') return node.value;
  return node.children.map((child) => toText(child as Element | Text)).join('');
}

/** HTML used by word/character counts and search summaries. */
export function hastToPlainText(tree: HastRoot): string {
  return toText(tree).replace(/\s+/g, ' ').trim();
}

export interface RenderOutput {
  hast: HastRoot;
  headings: HeadingEntry[];
  stats: DocumentStats;
  placeholders: PlaceholderSummary;
  /** Stage timings in milliseconds, used by the benchmark script. */
  timings: { parse: number; transform: number; sanitize: number; total: number };
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export interface MarkdownChunk {
  text: string;
  startLine: number;
  startOffset: number;
}

/**
 * Splits a document at blank lines, never inside a fenced code block and never
 * immediately before a setext underline or a list/quote continuation.
 */
export function splitMarkdown(source: string, maxChars = CHUNK_SIZE): MarkdownChunk[] {
  if (source.length <= maxChars) {
    return [{ text: source, startLine: 1, startOffset: 0 }];
  }

  const lines = source.split('\n');
  const chunks: MarkdownChunk[] = [];
  let buffer: string[] = [];
  let size = 0;
  let fence: string | null = null;
  let startLine = 1;
  let startOffset = 0;
  let offset = 0;

  const flush = (nextLine: number, nextOffset: number) => {
    // The newline that separated the last buffered line from the next chunk
    // belongs to the chunk that ends here, so concatenating chunks restores the
    // original source exactly.
    chunks.push({ text: `${buffer.join('\n')}\n`, startLine, startOffset });
    buffer = [];
    size = 0;
    startLine = nextLine;
    startOffset = nextOffset;
  };

  for (const [index, line] of lines.entries()) {
    const fenceMarker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1] ?? null;
    const previousBlank = buffer.length > 0 && (buffer[buffer.length - 1] ?? '').trim() === '';
    const startsAtColumnZero = line.length > 0 && !/^[ \t]/.test(line);
    const isSetextUnderline = /^(=+|-+)\s*$/.test(line);
    const isListOrQuote = /^([-*+]\s|\d+[.)]\s|>)/.test(line);

    if (
      !fence &&
      previousBlank &&
      startsAtColumnZero &&
      !isSetextUnderline &&
      !isListOrQuote &&
      size >= maxChars
    ) {
      flush(index + 1, offset);
    }

    if (fence) {
      if (
        fenceMarker &&
        fenceMarker[0] === fence[0] &&
        fenceMarker.length >= fence.length
      ) {
        fence = null;
      }
    } else if (fenceMarker) {
      fence = fenceMarker;
    }

    buffer.push(line);
    size += line.length + 1;
    offset += line.length + 1;
  }

  if (buffer.length > 0) {
    chunks.push({ text: buffer.join('\n'), startLine, startOffset });
  }

  return chunks;
}

function offsetPositions(tree: MdastRoot, lineDelta: number, offsetDelta: number): void {
  visit(tree, (node: Nodes) => {
    const position = node.position;
    if (!position) return;
    position.start.line += lineDelta;
    position.end.line += lineDelta;
    if (typeof position.start.offset === 'number') position.start.offset += offsetDelta;
    if (typeof position.end.offset === 'number') position.end.offset += offsetDelta;
  });
}

const PARSER = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkDisableRawHtml)
  .use(remarkRehype, {
    handlers: {
      inlineMath: (_state, node) => mathElement(node, false),
      math: (_state, node) => mathElement(node, true),
    } satisfies RehypeHandlers,
  });

/** Parses with chunking above the threshold, merging positions back. */
export function parseMarkdown(source: string, chunked = true): MdastRoot {
  if (!chunked || source.length <= CHUNK_THRESHOLD) {
    return PARSER.parse(source);
  }

  const root: MdastRoot = { type: 'root', children: [] };
  for (const chunk of splitMarkdown(source)) {
    const tree = PARSER.parse(chunk.text);
    if (chunk.startLine > 1 || chunk.startOffset > 0) {
      offsetPositions(tree, chunk.startLine - 1, chunk.startOffset);
    }
    root.children.push(...tree.children);
  }

  return root;
}

export function renderMarkdown(source: string, options: RenderOptions): RenderOutput {
  const startedAt = now();

  const parseStarted = now();
  const mdast = parseMarkdown(source, options.chunking ?? true);
  const parseTime = now() - parseStarted;

  const headingLines = collectHeadingLines(mdast);
  const transformStarted = now();
  let tree = PARSER.runSync(mdast);
  rehypeMermaidPlaceholders()(tree);

  if (!options.disableRichContent) {
    tree = applyHighlight(tree);
  }

  const transformTime = now() - transformStarted;

  const sanitizeStarted = now();
  tree = unified().use(rehypeSanitize, SANITIZE_SCHEMA).runSync(tree);
  const sanitizeTime = now() - sanitizeStarted;

  rewriteResources(tree, options);

  // Large documents keep placeholders as plain text blocks instead of
  // expensive diagram/math components.
  if (options.disableRichContent) {
    flattenPlaceholders(tree);
  }

  const headings = addHeadingAnchors(tree);
  for (const [index, heading] of headings.entries()) {
    heading.line = headingLines[index] ?? 1;
  }
  const plain = hastToPlainText(tree);
  const words = countWords(plain);

  return {
    hast: tree,
    headings,
    stats: {
      words,
      characters: plain.length,
      readingMinutes: words === 0 ? 0 : Math.max(1, Math.round(words / 200)),
    },
    placeholders: {
      mermaid: countByClass(tree, MERMAID_CLASS),
      math: countByClass(tree, MATH_INLINE_CLASS) + countByClass(tree, MATH_DISPLAY_CLASS),
    },
    timings: {
      parse: round(parseTime),
      transform: round(transformTime),
      sanitize: round(sanitizeTime),
      total: round(now() - startedAt),
    },
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function mathElement(node: unknown, display: boolean): Element {
  return {
    type: 'element',
    tagName: display ? 'div' : 'span',
    properties: {
      className: [display ? MATH_DISPLAY_CLASS : MATH_INLINE_CLASS],
    },
    children: [{ type: 'text', value: toString(node) }],
  };
}

function countByClass(tree: HastRoot, className: string): number {
  let count = 0;
  visit(tree, 'element', (node: Element) => {
    const classes = node.properties?.className;
    if (Array.isArray(classes) && classes.map(String).includes(className)) count += 1;
  });
  return count;
}

function flattenPlaceholders(tree: HastRoot): void {
  visit(tree, 'element', (node: Element) => {
    const classes = node.properties?.className;
    if (!Array.isArray(classes)) return;
    const names = classes.map(String);
    if (names.includes(MERMAID_CLASS)) {
      node.tagName = 'pre';
      node.properties = { className: ['mdeditor-placeholder'] };
      return;
    }
    if (names.includes(MATH_INLINE_CLASS) || names.includes(MATH_DISPLAY_CLASS)) {
      node.tagName = names.includes(MATH_INLINE_CLASS) ? 'code' : 'pre';
      node.properties = { className: ['mdeditor-placeholder'] };
    }
  });
}
