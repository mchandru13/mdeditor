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
import { rehypeTrimmedHighlight } from './highlight';
import { visit } from 'unist-util-visit';
import { toString } from 'mdast-util-to-string';
import type { Element, Nodes as HastNodes, Root as HastRoot, Text } from 'hast';
import type { Root as MdastRoot, Html, Nodes } from 'mdast';
import type { Options as RehypeOptions } from 'remark-rehype';

import { resolveResource } from './assetResolver';
import { commentBlockStarts, commentHeaderText } from './comments';
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
    rehypeTrimmedHighlight()(tree);
    return tree;
  } catch {
    // A highlight.js failure must never break the document.
    return tree;
  }
}

export function toText(node: Element | Text | HastRoot): string {
  if (node.type === 'text') return node.value;
  return node.children.map((child) => toText(child as Element | Text)).join('');
}

/** HTML used by word/character counts and search summaries. */
export function hastToPlainText(tree: HastRoot): string {
  return toText(tree).replace(/\s+/g, ' ').trim();
}

export const COMMENT_CLASS = 'mdeditor-comment';
export const COMMENT_HEADER_CLASS = 'mdeditor-comment-header';

/**
 * Marks comment blockquotes so they can be styled and excluded from statistics.
 *
 * The source scanner decides what a comment is, not the HAST shape: a canonical
 * comment and a quoted paragraph that merely starts with the marker produce the
 * same elements, because the `>` separator line leaves no node behind. Matching
 * the blockquote's source offset against `commentBlockStarts` is therefore the
 * only way the renderer can agree with the parser — and it matters, because a
 * tagged quote is hidden from search and stripped from exports.
 *
 * Only the marker text is replaced; inline formatting the author typed in the
 * header is kept as sanitized nodes.
 */
function markComments(tree: HastRoot, source: string): void {
  const starts = new Set(commentBlockStarts(source));

  visit(tree, 'element', (node: Element) => {
    if (node.tagName !== 'blockquote') return;
    const start = node.position?.start?.offset;
    if (start === undefined || !starts.has(start)) return;

    // The scanner matched the block; this only locates the marker to strip it.
    const first = node.children.find((child): child is Element => child.type === 'element');
    if (!first || first.tagName !== 'p') return;
    const text = first.children[0];
    if (text?.type !== 'text') return;
    const headerText = commentHeaderText(text.value);
    if (headerText === null) return;

    node.properties = { ...node.properties, className: [COMMENT_CLASS] };
    first.properties = { ...first.properties, className: [COMMENT_HEADER_CLASS] };
    // Replace only the marker prefix so `> [!comment] **chand**` keeps "chand".
    first.children[0] = { type: 'text', value: headerText };
  });
}

/**
 * Every node inside a comment blockquote, so statistics and the outline can
 * ignore editorial text.
 *
 * One depth-carrying walk: collecting marked roots and then re-walking each of
 * them is quadratic on nested blockquotes, which a hostile file can stack
 * thousands deep.
 */
function editorialNodes(tree: HastRoot): Set<HastNodes> {
  const inside = new Set<HastNodes>();

  const walk = (node: HastNodes, inComment: boolean): void => {
    let editorial = inComment;
    if (node.type === 'element') {
      const classes = node.properties?.className;
      if (Array.isArray(classes) && classes.map(String).includes(COMMENT_CLASS)) {
        editorial = true;
      }
    }
    if (editorial) inside.add(node);
    if (node.type === 'root' || node.type === 'element') {
      for (const child of node.children) walk(child, editorial);
    }
  };

  walk(tree, false);
  return inside;
}

interface PostProcessResult {
  headings: HeadingEntry[];
  placeholders: PlaceholderSummary;
  text: string;
}

/** True for an http(s) URL that points at a remote host. */
function isRemoteUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/**
 * Replaces a remote image with inert text. The element is mutated in place, so
 * the node keeps its position in the tree and the surrounding layout survives.
 */
function blockRemoteImage(element: Element, url: string, counter: { count: number }): void {
  const alt = typeof element.properties?.alt === 'string' ? element.properties.alt : '';
  const label = alt.trim().length > 0 ? alt : url;
  element.tagName = 'span';
  element.properties = {
    className: ['mdeditor-remote-image'],
    title: `Remote image not loaded: ${url}`,
  };
  element.children = [{ type: 'text', value: `[remote image: ${label}]` }];
  counter.count += 1;
}

/**
 * Single-pass post-processing: resource URLs, placeholder counts and the plain
 * text used for statistics are collected in one traversal; heading ids and
 * anchors in a second, element-only traversal. Running four separate walks (as
 * the naive version did) cost ~160 ms on a 200 KB document.
 */
function postProcess(tree: HastRoot, options: RenderOptions): PostProcessResult {
  const textParts: string[] = [];
  const placeholders = { mermaid: 0, math: 0 };
  const blocked = { count: 0 };
  const allowRemoteImages = options.remoteImages === 'allow';
  const editorial = editorialNodes(tree);

  visit(tree, (node) => {
    if (node.type === 'text') {
      if (!editorial.has(node)) textParts.push(node.value);
      return;
    }

    if (node.type !== 'element') return;
    const element = node;

    if (element.tagName === 'img' || element.tagName === 'a') {
      const key = element.tagName === 'img' ? 'src' : 'href';
      const value = element.properties?.[key];
      if (typeof value === 'string') {
        const resolved = resolveResource(value, options.base, options.assetOrigin);
        element.properties[key] = resolved.url;
        if (element.tagName === 'a' && !resolved.local && !resolved.url.startsWith('#')) {
          element.properties.target = '_blank';
          element.properties.rel = ['noopener', 'noreferrer'];
        }
        // A document must not be able to phone home just by being opened. Local
        // files resolve through the asset protocol (resolved.local), so only
        // genuinely remote http(s) URLs are affected.
        if (
          element.tagName === 'img' &&
          !allowRemoteImages &&
          !resolved.local &&
          isRemoteUrl(resolved.url)
        ) {
          blockRemoteImage(element, resolved.url, blocked);
          // The placeholder text is created after the editorial set was built, so
          // add it explicitly: a blocked image inside a comment is still comment
          // text and must not reach the word count.
          if (editorial.has(element)) {
            for (const child of element.children) editorial.add(child);
          }
        }
      }
    }

    const classes = element.properties?.className;
    if (Array.isArray(classes)) {
      const names = classes.map(String);
      if (names.includes(MERMAID_CLASS)) placeholders.mermaid += 1;
      if (names.includes(MATH_INLINE_CLASS) || names.includes(MATH_DISPLAY_CLASS)) {
        placeholders.math += 1;
      }
    }
  });

  const nextSlug = createSlugger();
  const headings: HeadingEntry[] = [];

  visit(tree, 'element', (node: Element) => {
    if (node.tagName.length !== 2 || node.tagName[0] !== 'h') return;
    // A heading typed inside a comment is editorial, not a section of the
    // document; it must not appear in the outline or get an anchor id.
    if (editorial.has(node)) return;
    const depth = Number(node.tagName.slice(1));
    if (!Number.isInteger(depth) || depth < 1 || depth > 6) return;

    const text = toText(node).trim();
    const id = nextSlug(text);

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

    // The HAST position survives sanitize and chunking, and unlike an index into
    // a separate mdast list it cannot drift when a heading inside a comment is
    // skipped above it.
    headings.push({ id, text, depth, line: node.position?.start.line ?? 1 });
  });

  return {
    headings,
    placeholders: { ...placeholders, blockedRemoteImages: blocked.count },
    text: textParts.join('').replace(/\s+/g, ' ').trim(),
  };
}

export interface RenderOutput {
  hast: HastRoot;
  headings: HeadingEntry[];
  stats: DocumentStats;
  placeholders: PlaceholderSummary;
  /** Stage timings in milliseconds, used by the benchmark script. */
  timings: {
    parse: number;
    transform: number;
    sanitize: number;
    post: number;
    total: number;
  };
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
    position.start.line = Math.max(1, position.start.line + lineDelta);
    position.end.line = Math.max(1, position.end.line + lineDelta);
    if (typeof position.start.offset === 'number') {
      position.start.offset = Math.max(0, position.start.offset + offsetDelta);
    }
    if (typeof position.end.offset === 'number') {
      position.end.offset = Math.max(0, position.end.offset + offsetDelta);
    }
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

  // Link reference definitions and footnote definitions are global to a
  // document, but micromark resolves them per parse. Every chunk therefore gets
  // a copy of the definitions block, and positions are shifted back afterwards.
  const definitions = collectDefinitionLines(source);
  const prefix = definitions.length > 0 ? `${definitions.join('\n')}\n\n` : '';
  const prefixLines = definitions.length > 0 ? definitions.length + 1 : 0;

  const root: MdastRoot = { type: 'root', children: [] };
  for (const chunk of splitMarkdown(source)) {
    const tree = PARSER.parse(`${prefix}${chunk.text}`);
    offsetPositions(tree, chunk.startLine - 1 - prefixLines, chunk.startOffset - prefix.length);
    root.children.push(...tree.children);
  }

  return root;
}

/** Collects reference and footnote definitions outside fenced code blocks,
 * including indented continuation lines. */
export function collectDefinitionLines(source: string): string[] {
  const lines = source.split('\n');
  const found: string[] = [];
  const seen = new Set<string>();
  let fence: string | null = null;
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    const fenceMarker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1] ?? null;

    if (fence) {
      if (fenceMarker && fenceMarker[0] === fence[0] && fenceMarker.length >= fence.length) {
        fence = null;
      }
      index += 1;
      continue;
    }

    if (fenceMarker) {
      fence = fenceMarker;
      index += 1;
      continue;
    }

    if (/^ {0,3}\[[^\]]+\]:/.test(line)) {
      const block = [line];
      let cursor = index + 1;
      while (cursor < lines.length && /^[ \t]+\S/.test(lines[cursor] ?? '')) {
        block.push(lines[cursor] ?? '');
        cursor += 1;
      }

      const definition = block.join('\n');
      if (!seen.has(definition)) {
        seen.add(definition);
        found.push(definition);
      }

      index = cursor;
      continue;
    }

    index += 1;
  }

  return found;
}

export function renderMarkdown(source: string, options: RenderOptions): RenderOutput {
  const startedAt = now();

  const parseStarted = now();
  const mdast = parseMarkdown(source, options.chunking ?? true);
  const parseTime = now() - parseStarted;

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

  const postStarted = now();

  // Tag comment blockquotes before statistics are collected, so their text can
  // be excluded from word and character counts.
  markComments(tree, source);

  // Large documents keep placeholders as plain text blocks instead of
  // expensive diagram/math components.
  if (options.disableRichContent) {
    flattenPlaceholders(tree);
  }

  const post = postProcess(tree, options);
  const words = countWords(post.text);
  const postTime = now() - postStarted;

  return {
    hast: tree,
    headings: post.headings,
    stats: {
      words,
      characters: post.text.length,
      readingMinutes: words === 0 ? 0 : Math.max(1, Math.round(words / 200)),
    },
    placeholders: post.placeholders,
    timings: {
      parse: round(parseTime),
      transform: round(transformTime),
      sanitize: round(sanitizeTime),
      post: round(postTime),
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
