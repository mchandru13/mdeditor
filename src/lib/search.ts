/**
 * In-document search.
 *
 * Matching is performed per text node and highlights are applied either through
 * the CSS Custom Highlight API or by wrapping text in `<mark>`. No code path
 * builds markup from a string, so search can never inject HTML.
 */

export interface TextMatch {
  node: Text;
  start: number;
  end: number;
}

export interface SourceMatch {
  start: number;
  end: number;
}

const SKIPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT']);
// Comments are editorial: they are styled as notes and left out of search in
// Read/Split Mode, matching their exclusion from statistics and export.
const SKIPPED_CLASSES = ['mdeditor-mermaid', 'mdeditor-math-inline', 'mdeditor-math-display', 'mdeditor-katex', 'mdeditor-comment'];

export const DEFAULT_MATCH_LIMIT = 5000;

function shouldSkip(element: Element | null): boolean {
  let current: Element | null = element;
  while (current) {
    if (SKIPPED_TAGS.has(current.tagName)) return true;
    const className = current.getAttribute('class');
    if (className && SKIPPED_CLASSES.some((name) => className.includes(name))) return true;
    current = current.parentElement;
  }
  return false;
}

export function findTextMatches(
  root: Node,
  query: string,
  caseSensitive = false,
  limit = DEFAULT_MATCH_LIMIT,
): TextMatch[] {
  if (query.length === 0) return [];

  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: TextMatch[] = [];

  let node = walker.nextNode();
  while (node && matches.length < limit) {
    const textNode = node as Text;
    if (!shouldSkip(textNode.parentElement)) {
      const haystack = caseSensitive ? textNode.data : textNode.data.toLowerCase();
      let index = haystack.indexOf(needle);

      while (index !== -1 && matches.length < limit) {
        matches.push({ node: textNode, start: index, end: index + needle.length });
        index = haystack.indexOf(needle, index + needle.length);
      }
    }
    node = walker.nextNode();
  }

  return matches;
}

export function findSourceMatches(
  source: string,
  query: string,
  caseSensitive = false,
  limit = DEFAULT_MATCH_LIMIT,
): SourceMatch[] {
  if (query.length === 0) return [];

  const haystack = caseSensitive ? source : source.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: SourceMatch[] = [];

  let index = haystack.indexOf(needle);
  while (index !== -1 && matches.length < limit) {
    matches.push({ start: index, end: index + needle.length });
    index = haystack.indexOf(needle, index + needle.length);
  }

  return matches;
}

export function matchRanges(matches: TextMatch[]): Range[] {
  return matches.map((match) => {
    const range = match.node.ownerDocument.createRange();
    range.setStart(match.node, match.start);
    range.setEnd(match.node, match.end);
    return range;
  });
}

interface HighlightRegistry {
  set(name: string, value: unknown): void;
  delete(name: string): void;
}

interface HighlightCtor {
  new (...ranges: Range[]): unknown;
}

const ALL_HIGHLIGHT = 'mdeditor-search';
const ACTIVE_HIGHLIGHT = 'mdeditor-search-active';

interface CssWithHighlights {
  highlights?: HighlightRegistry;
}

function getHighlightSupport(): { registry: HighlightRegistry; ctor: HighlightCtor } | null {
  const css = (globalThis as { CSS?: CssWithHighlights }).CSS;
  const ctor = (globalThis as { Highlight?: HighlightCtor }).Highlight;
  if (!css?.highlights || typeof ctor !== 'function') return null;
  return { registry: css.highlights, ctor };
}

export interface Highlighter {
  apply(matches: TextMatch[], activeIndex: number): void;
  clear(): void;
}

/**
 * Applies highlight decorations. Uses the CSS Custom Highlight API when
 * available and falls back to `<mark>` elements otherwise (older runtimes and
 * jsdom). Marks created by the fallback are removed by `clear` and never survive
 * into copy or export because those read the source, not the preview.
 */
export function createHighlighter(): Highlighter {
  const support = getHighlightSupport();
  let marks: HTMLElement[] = [];

  const clearMarks = () => {
    for (const mark of marks) {
      const parent = mark.parentNode;
      if (!parent) continue;
      parent.replaceChild(mark.ownerDocument.createTextNode(mark.textContent ?? ''), mark);
      parent.normalize();
    }
    marks = [];
  };

  const clear = () => {
    clearMarks();
    support?.registry.delete(ALL_HIGHLIGHT);
    support?.registry.delete(ACTIVE_HIGHLIGHT);
  };

  const applyFallback = (matches: TextMatch[], activeIndex: number) => {
    clearMarks();

    // Group by node and wrap from the end so offsets stay valid.
    const byNode = new Map<Text, TextMatch[]>();
    for (const match of matches) {
      const list = byNode.get(match.node);
      if (list) list.push(match);
      else byNode.set(match.node, [match]);
    }

    for (const [node, list] of byNode) {
      const doc = node.ownerDocument;
      for (const match of list.slice().reverse()) {
        const range = doc.createRange();
        range.setStart(node, match.start);
        range.setEnd(node, match.end);
        const mark = doc.createElement('mark');
        mark.className =
          matches[activeIndex] === match ? 'search-hit search-hit-active' : 'search-hit';
        try {
          range.surroundContents(mark);
          marks.push(mark);
        } catch {
          // A range spanning element boundaries cannot be wrapped; skip it.
        }
      }
    }
  };

  return {
    apply(matches, activeIndex) {
      if (!support) {
        applyFallback(matches, activeIndex);
        return;
      }

      clearMarks();
      const ranges = matchRanges(matches);
      support.registry.set(ALL_HIGHLIGHT, new support.ctor(...ranges));

      const active = ranges[activeIndex];
      if (active) {
        support.registry.set(ACTIVE_HIGHLIGHT, new support.ctor(active));
      } else {
        support.registry.delete(ACTIVE_HIGHLIGHT);
      }
    },
    clear,
  };
}
