/**
 * Document comments, stored in the document itself.
 *
 * A comment is a blockquote whose first paragraph is the marker line:
 *
 *   > [!comment] chand 2026-11-21
 *   >
 *   > Is this safe when the write fails halfway through?
 *
 * The file is the store, so any editor or LLM reading the Markdown sees the
 * comment next to the text it annotates. Nothing here touches the DOM or HAST:
 * this module works on source offsets only, because the commands that use it
 * run in Edit Mode where no render exists. `commentBlockStarts` is also used by
 * the renderer, so one rule decides what a comment is in both places.
 *
 * Offsets, never lines: on a chunked (>64 KB) document the pipeline's line
 * numbers drift, while offsets stay exact.
 */

/** Marker that opens a comment block. Matches Obsidian's callout grammar. */
export const COMMENT_MARKER = '[!comment]';

/** Upper bound on one stored comment block, marker and quoting included. */
export const MAX_COMMENT_BYTES = 4 * 1024;

/** Longest header the dialog accepts. It is a single line, not an essay. */
export const MAX_COMMENT_HEADER_CHARS = 120;

const HEADER_PATTERN = /^\[!comment\](?: (.*))?$/;

/**
 * Extract the header text from a marker line, or null when it is not one.
 *
 * The renderer uses this too, so there is exactly one definition of what a
 * marker line is.
 */
export function commentHeaderText(line: string): string | null {
  const match = HEADER_PATTERN.exec(line);
  return match ? (match[1] ?? '') : null;
}

const BLOCKQUOTE_LINE = /^ {0,3}>/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const INDENTED_CODE = /^(?: {4,}|\t)/;

interface Line {
  text: string;
  /** Offset of the first character of the line. */
  start: number;
  /** Offset just past the line's last character, excluding the newline. */
  end: number;
}

/** Splits into lines while remembering each line's source offsets. */
function splitLines(source: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== '\n') continue;
    // Offsets stay in the original string, so dropping a CR here cannot shift
    // anything; it only keeps CRLF files parseable.
    lines.push({ text: source.slice(start, index).replace(/\r$/, ''), start, end: index });
    start = index + 1;
  }
  if (start <= source.length) {
    lines.push({ text: source.slice(start).replace(/\r$/, ''), start, end: source.length });
  }
  return lines;
}

/** Strips a blockquote marker and at most one following space. */
function stripQuote(line: string): string {
  const match = /^ {0,3}> ?(.*)$/.exec(line);
  return match ? match[1]! : line;
}

/**
 * Marks lines that sit inside a fenced or indented code block.
 *
 * Both matter: the chunker's fence rule ignores four-space-indented code, so a
 * comment-looking line there must be excluded by its own check rather than
 * inherited from the fence tracker.
 */
function codeLineMask(lines: Line[]): boolean[] {
  const mask = new Array<boolean>(lines.length).fill(false);
  let fence: string | null = null;

  for (const [index, line] of lines.entries()) {
    const fenceMarker = FENCE_OPEN.exec(line.text)?.[1] ?? null;

    if (fence) {
      mask[index] = true;
      if (fenceMarker && fenceMarker[0] === fence[0] && fenceMarker.length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (fenceMarker) {
      fence = fenceMarker;
      mask[index] = true;
      continue;
    }
    if (INDENTED_CODE.test(line.text)) mask[index] = true;
  }

  return mask;
}

/**
 * Source offsets of every canonical comment block's `>`.
 *
 * A comment is a blockquote whose marker owns its own paragraph: the marker line
 * is followed either by another quoted line that is blank or by the end of the
 * blockquote. That is exactly the form {@link insertBlockComment} writes, and it
 * is the only form the renderer can tell apart from quoted prose — a paragraph
 * holding the marker followed by more text looks identical in the tree whether
 * the author wrote a `>` separator or not.
 *
 * This may recognise a block whose marker the Markdown parser turns into
 * something other than text (a reference definition named `[!comment]`, or a
 * marker line that is actually indented code). The renderer then simply declines
 * to tag it, which is the safe direction: nothing is hidden or stripped.
 *
 * The scan is a single linear pass; no pattern is run over the whole document,
 * which keeps a hostile file from turning it quadratic.
 */
export function commentBlockStarts(source: string): number[] {
  return scanComments(source).map((comment) => comment.start);
}

export interface CommentBlock {
  /** Offset of the blockquote's `>`. */
  start: number;
  /** Offset just past the block's last line, before its newline. */
  end: number;
  /** Header text after the marker, e.g. "chand 2026-11-21". */
  header: string;
  /** Body lines with the blockquote prefixes stripped. */
  body: string;
}

/**
 * Every canonical comment block, with the offsets needed to remove one.
 *
 * Shares its rule with the renderer (`commentBlockStarts` is derived from this),
 * so what the app offers to edit or remove is exactly what it renders as a
 * comment.
 */
export function scanComments(source: string): CommentBlock[] {
  const lines = splitLines(source);
  const code = codeLineMask(lines);
  const blocks: CommentBlock[] = [];

  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (code[index] || !BLOCKQUOTE_LINE.test(line.text)) {
      index += 1;
      continue;
    }

    // Collect the blockquote: consecutive `>`-prefixed lines.
    let end = index;
    while (end + 1 < lines.length && !code[end + 1] && BLOCKQUOTE_LINE.test(lines[end + 1]!.text)) {
      end += 1;
    }

    // Extra spaces after `>` are tolerated, matching how Markdown reads them.
    const markerLine = stripQuote(line.text).replace(/^[ \t]+/, '');
    const ownsParagraph = end === index || stripQuote(lines[index + 1]!.text).trim() === '';
    const header = commentHeaderText(markerLine);
    if (header !== null && ownsParagraph) {
      const bodyLines: string[] = [];
      for (let cursor = index + 1; cursor <= end; cursor += 1) {
        bodyLines.push(stripQuote(lines[cursor]!.text));
      }
      // The marker's own blank `>` separator is structural, not content.
      if (bodyLines.length > 0 && bodyLines[0]!.trim() === '') bodyLines.shift();
      blocks.push({
        start: line.start + line.text.indexOf('>'),
        end: lines[end]!.end,
        header,
        body: bodyLines.join('\n').replace(/\s+$/, ''),
      });
    }

    index = end + 1;
  }

  return blocks;
}

/**
 * Removes one comment block, leaving a single blank line between its neighbours.
 *
 * Normalises rather than restoring the original whitespace: the source does not
 * record how many blank lines surrounded the block before it was inserted, so
 * anything else would be guesswork. Document text on both sides is preserved.
 */
export function removeCommentBlock(source: string, block: CommentBlock): string {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const left = source.slice(0, block.start).replace(/(?:\r?\n)+$/, '');
  const right = source.slice(block.end).replace(/^(?:\r?\n)+/, '');
  if (left === '') return right;
  if (right === '') return `${left}${eol}`;
  return `${left}${eol}${eol}${right}`;
}

/** Removes every comment block, keeping the rest of the document intact. */
export function removeAllCommentBlocks(source: string): { source: string; removed: number } {
  const blocks = scanComments(source);
  let next = source;
  // Remove from the end so earlier offsets stay valid.
  for (const block of [...blocks].reverse()) next = removeCommentBlock(next, block);
  return { source: next, removed: blocks.length };
}

/**
 * True when the line begins a construct this version refuses to anchor inside.
 *
 * A blockquote placed after a list item leaves the list, which would anchor the
 * comment to the whole list rather than the item the user selected, so refusing
 * with a message is better than a silently wrong anchor.
 */
function isUnsupportedBlockStart(line: string): boolean {
  return (
    BLOCKQUOTE_LINE.test(line) ||
    /^\s*\|/.test(line) ||
    /^ {0,3}(?:[-*+]|\d+[.)])\s/.test(line) ||
    INDENTED_CODE.test(line)
  );
}

/** Start of the blank-line-delimited block containing `index`. */
function blockStart(lines: Line[], index: number): number {
  let cursor = index;
  while (cursor > 0 && lines[cursor - 1]!.text.trim() !== '') cursor -= 1;
  return cursor;
}

/** End of the blank-line-delimited block containing `index` (exclusive). */
function blockEnd(lines: Line[], index: number): number {
  let cursor = index;
  while (cursor < lines.length && lines[cursor]!.text.trim() !== '') cursor += 1;
  return cursor;
}

export interface InsertPoint {
  /** Offset at which the new block should be inserted. */
  at: number;
  /** Offset where the preceding block ends, recorded as the anchor. */
  anchorEnd: number;
}

/**
 * Finds where a comment for the given selection should be inserted.
 *
 * Returns null when the selection sits inside a list, table, blockquote or code
 * block, where a top-level blockquote would not anchor to what the user picked.
 */
export function findInsertPoint(
  source: string,
  selectionStart: number,
  selectionEnd: number,
): InsertPoint | null {
  const lines = splitLines(source);
  const code = codeLineMask(lines);
  const clamp = (value: number): number => Math.max(0, Math.min(value, source.length));

  const lineAt = (offset: number): number => {
    const target = clamp(offset);
    for (const [index, line] of lines.entries()) {
      if (target <= line.end) return index;
    }
    return Math.max(0, lines.length - 1);
  };

  const startIndex = lineAt(Math.min(selectionStart, selectionEnd));
  const endIndex = lineAt(Math.max(selectionStart, selectionEnd));
  if (code[startIndex] || code[endIndex]) return null;

  // Both ends of the selection must sit in supported top-level blocks: a
  // selection that begins inside a list is refused even when it ends in prose.
  for (const index of [startIndex, endIndex]) {
    const start = blockStart(lines, index);
    const firstLine = lines[start]?.text ?? '';
    if (isUnsupportedBlockStart(firstLine)) return null;
  }

  const endLine = endIndex;
  const start = blockStart(lines, endLine);
  const end = blockEnd(lines, endLine);

  // Every line of the block must be a plain top-level line; a table body or list
  // continuation can start with something innocuous after the first line.
  for (let cursor = start; cursor < end; cursor += 1) {
    if (code[cursor] || isUnsupportedBlockStart(lines[cursor]!.text)) return null;
  }

  const insertIndex = end;
  const at = insertIndex < lines.length ? lines[insertIndex]!.start : source.length;
  const anchorLine = end > 0 ? lines[end - 1]! : null;
  return { at, anchorEnd: anchorLine ? anchorLine.end : 0 };
}

/**
 * Renders the canonical source text for one comment block.
 *
 * The header is forced onto the marker line as a single line of text: a newline
 * there would end the paragraph and turn the block into something the parser and
 * renderer both read as a quote rather than a comment.
 */
export function formatCommentBlock(header: string, body: string): string {
  const flatHeader = header.replace(/\s+/g, ' ').trim();
  const marker = flatHeader ? `${COMMENT_MARKER} ${flatHeader}` : COMMENT_MARKER;
  const bodyLines = body
    .replace(/\r\n/g, '\n')
    .replace(/\s+$/, '')
    .split('\n');
  const quoted = bodyLines.map((line) => (line.trim() === '' ? '>' : `> ${line}`));
  return [`> ${marker}`, '>', ...quoted].join('\n');
}

export interface InsertResult {
  source: string;
  /** Range replaced by the insertion, for applying it as one editor transaction. */
  insertion: { from: number; to: number; text: string };
}

/**
 * Inserts a comment block at a point returned by {@link findInsertPoint}.
 *
 * One blank line separates the block from whatever follows it, and one is added
 * before it unless the preceding text already ends with one. The insertion is
 * returned as a range so the caller can apply it as a single undoable editor
 * transaction instead of replacing the whole buffer through the value prop.
 */
export function insertBlockComment(
  source: string,
  point: InsertPoint,
  header: string,
  body: string,
): InsertResult {
  const block = formatCommentBlock(header, body);
  const before = source.slice(0, point.at);
  const after = source.slice(point.at);

  const prefix = before.length > 0 && !/\n\n$/.test(before) ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
  const suffix = after.length === 0 || after.startsWith('\n') ? '\n' : '\n\n';
  const text = `${prefix}${block}${suffix}`;

  return {
    source: `${before}${text}${after}`,
    insertion: { from: point.at, to: point.at, text },
  };
}

/** True when a comment can be stored without loss or runaway size. */
export function validateComment(header: string, body: string): string | null {
  if (body.trim() === '') return 'A comment needs some text.';
  if (header.length > MAX_COMMENT_HEADER_CHARS) {
    return `The header is ${header.length} characters; the limit is ${MAX_COMMENT_HEADER_CHARS}.`;
  }
  const bytes = new TextEncoder().encode(formatCommentBlock(header, body)).length;
  if (bytes > MAX_COMMENT_BYTES) {
    return `Comment is ${bytes} bytes; the limit is ${MAX_COMMENT_BYTES}.`;
  }
  return null;
}
