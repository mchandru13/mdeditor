import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, undo } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

import type { DocId } from '../../lib/types';

export interface EditorHandle {
  focus(): void;
  scrollTo(position: number): void;
  selectRange(start: number, end: number): void;
  getScrollTop(): number;
  restoreScroll(top: number): void;
  /** 1-based line currently at the top of the viewport. */
  lineAtScrollTop(top: number): number;
  scrollToLine(line: number): void;
  undo(): void;
  redo(): void;
}

export interface EditorProps {
  docId: DocId;
  value: string;
  onChange: (value: string) => void;
  onScroll?: (scrollTop: number) => void;
  /** Restored when switching tabs. */
  initialScroll: number;
  readOnly?: boolean;
  /** WebView spell checking. On by default; off is useful for code-heavy notes. */
  spellCheck?: boolean;
}

/**
 * CodeMirror 6 wrapper. Scrolling is read from the editor's scroll DOM rather
 * than through a decoration layer so synchronized scroll stays cheap on large
 * documents. CodeMirror's own search keymap is deliberately not installed.
 */
const highlight = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--md-heading)', fontWeight: '600' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.link, color: 'var(--accent)', textDecoration: 'underline' },
  { tag: tags.url, color: 'var(--accent)' },
  { tag: tags.monospace, color: 'var(--md-code)' },
  { tag: tags.keyword, color: 'var(--md-keyword)' },
  { tag: tags.string, color: 'var(--md-string)' },
  { tag: tags.number, color: 'var(--md-number)' },
  { tag: tags.comment, color: 'var(--md-comment)', fontStyle: 'italic' },
  { tag: tags.processingInstruction, color: 'var(--md-mark)' },
  { tag: tags.contentSeparator, color: 'var(--text-muted)' },
]);

export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(
  { docId, value, onChange, onScroll, initialScroll, readOnly = false, spellCheck = true },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const currentDocRef = useRef<DocId>(docId);
  const onChangeRef = useRef(onChange);
  const readOnlyCompartment = useRef(new Compartment());
  const spellCheckCompartment = useRef(new Compartment());

  onChangeRef.current = onChange;

  /** Content attributes, kept in one place so `aria-label` cannot be lost. */
  const contentAttributes = useCallback(
    (enabled: boolean) => ({
      'aria-label': 'Markdown source editor',
      spellcheck: enabled ? 'true' : 'false',
    }),
    [],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        highlightSpecialChars(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        markdown(),
        syntaxHighlighting(highlight),
        EditorView.lineWrapping,
        spellCheckCompartment.current.of(EditorView.contentAttributes.of(contentAttributes(spellCheck))),
        readOnlyCompartment.current.of(EditorState.readOnly.of(readOnly)),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString());
        }),
      ],
    });

    const view = new EditorView({ state, parent: host });
    viewRef.current = view;
    if (initialScroll > 0) view.scrollDOM.scrollTop = initialScroll;

    const scrollHandler = () => onScroll?.(view.scrollDOM.scrollTop);
    view.scrollDOM.addEventListener('scroll', scrollHandler, { passive: true });

    return () => {
      view.scrollDOM.removeEventListener('scroll', scrollHandler);
      view.destroy();
      viewRef.current = null;
    };
    // The editor is created once; value and doc swaps are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swap documents: replace content and restore that tab's scroll position.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || currentDocRef.current === docId) return;

    currentDocRef.current = docId;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      selection: { anchor: 0 },
      scrollIntoView: false,
    });
    view.scrollDOM.scrollTop = initialScroll;
    view.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  // External content changes (reload, undo from outside) without a doc swap.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;

    const selection = view.state.selection.main;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
      selection: { anchor: Math.min(selection.anchor, value.length) },
      scrollIntoView: false,
    });
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: readOnlyCompartment.current.reconfigure(EditorState.readOnly.of(readOnly)),
    });
  }, [readOnly]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: spellCheckCompartment.current.reconfigure(
        EditorView.contentAttributes.of(contentAttributes(spellCheck)),
      ),
    });
  }, [spellCheck, contentAttributes]);

  useImperativeHandle(ref, () => ({
    focus() {
      viewRef.current?.focus();
    },
    scrollTo(position: number) {
      const view = viewRef.current;
      if (!view) return;
      const clamped = Math.max(0, Math.min(position, view.state.doc.length));
      view.dispatch({ selection: { anchor: clamped }, scrollIntoView: true });
      view.focus();
    },
    selectRange(start: number, end: number) {
      const view = viewRef.current;
      if (!view) return;
      const length = view.state.doc.length;
      view.dispatch({
        selection: { anchor: Math.min(start, length), head: Math.min(end, length) },
        scrollIntoView: true,
      });
      view.focus();
    },
    getScrollTop() {
      return viewRef.current?.scrollDOM.scrollTop ?? 0;
    },
    restoreScroll(top: number) {
      const view = viewRef.current;
      if (view && top > 0) view.scrollDOM.scrollTop = top;
    },
    lineAtScrollTop(top: number) {
      const view = viewRef.current;
      if (!view) return 1;
      const block = view.lineBlockAtHeight(Math.max(0, top));
      return view.state.doc.lineAt(block.from).number;
    },
    scrollToLine(line: number) {
      const view = viewRef.current;
      if (!view) return;
      const total = view.state.doc.lines;
      const clamped = Math.max(1, Math.min(line, total));
      const block = view.lineBlockAt(view.state.doc.line(clamped).from);
      view.scrollDOM.scrollTop = Math.max(0, block.top);
    },
    undo() {
      const view = viewRef.current;
      if (!view) return;
      undo(view);
      view.focus();
    },
    redo() {
      const view = viewRef.current;
      if (!view) return;
      redo(view);
      view.focus();
    },
  }));

  return <div className="editor" ref={hostRef} />;
});
