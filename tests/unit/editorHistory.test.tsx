import { createRef, type RefObject } from 'react';
import { describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { undo, undoDepth } from '@codemirror/commands';

import { Editor, type EditorHandle } from '../../src/components/Editor/Editor';

function element(ref: RefObject<EditorHandle | null>, docId: string, value: string) {
  return (
    <Editor
      ref={ref}
      docId={docId}
      value={value}
      onChange={() => undefined}
      initialScroll={0}
    />
  );
}

function mount(docId: string, value: string) {
  const ref = createRef<EditorHandle>();
  const view = render(element(ref, docId, value));
  const host = view.container.querySelector('.editor-host, .editor, div');
  if (!host) throw new Error('editor host missing');
  const editor = EditorView.findFromDOM(host as HTMLElement);
  if (!editor) throw new Error('editor view not mounted');
  return {
    editor,
    ref,
    rerender: (nextDocId: string, nextValue: string) =>
      view.rerender(element(ref, nextDocId, nextValue)),
  };
}

describe('editor undo history', () => {
  it('does not let undo cross a tab switch', () => {
    const { rerender, editor } = mount('a', 'AAAA');

    act(() => {
      editor.dispatch({ changes: { from: 4, insert: '-mine' }, userEvent: 'input.type' });
    });
    expect(undoDepth(editor.state)).toBe(1);

    rerender('b', 'BBBB');
    expect(editor.state.doc.toString()).toBe('BBBB');
    // The outgoing document's history must be gone, not merely remapped.
    expect(undoDepth(editor.state)).toBe(0);

    act(() => {
      undo(editor);
    });
    expect(editor.state.doc.toString()).toBe('BBBB');

    // A fresh edit in this tab is still undoable.
    act(() => {
      editor.dispatch({ changes: { from: 4, insert: '!' }, userEvent: 'input.type' });
    });
    expect(undoDepth(editor.state)).toBe(1);
    act(() => {
      undo(editor);
    });
    expect(editor.state.doc.toString()).toBe('BBBB');
  });

  it('keeps an external replace undoable and a first load undo-proof', () => {
    const { rerender, editor } = mount('c', '');

    // First load of a restored tab: nothing to lose, so it stays out of history.
    rerender('c', 'loaded from disk');
    expect(editor.state.doc.toString()).toBe('loaded from disk');
    expect(undoDepth(editor.state)).toBe(0);
    act(() => {
      undo(editor);
    });
    expect(editor.state.doc.toString()).toBe('loaded from disk');

    // Edit > Replace / Replace All arrive through the same path and must remain
    // undoable, so the reset must not be applied here when history exists.
    act(() => {
      editor.dispatch({ changes: { from: 0, insert: 'note: ' }, userEvent: 'input.type' });
    });
    rerender('c', 'replaced by Replace All');
    expect(editor.state.doc.toString()).toBe('replaced by Replace All');
    expect(undoDepth(editor.state)).toBeGreaterThan(0);
  });

  it('keeps the first edit after opening a file undoable', () => {
    const { rerender, editor } = mount('d', 'from disk');
    // Loading into a non-empty buffer is not a load: the history is empty here
    // only because the document was swapped in, and the user's first edit must
    // still be undoable.
    expect(undoDepth(editor.state)).toBe(0);

    rerender('d', 'from disk\n\n> [!comment] me\n>\n> note\n');
    expect(editor.state.doc.toString()).toContain('[!comment]');
    expect(undoDepth(editor.state)).toBeGreaterThan(0);

    act(() => {
      undo(editor);
    });
    expect(editor.state.doc.toString()).toBe('from disk');
  });

  it('makes a range replacement undoable even in an empty document', () => {
    const { ref, editor } = mount('e', '');

    act(() => {
      ref.current!.replaceRange(0, 0, '> [!comment] me\n');
    });
    expect(editor.state.doc.toString()).toBe('> [!comment] me\n');
    // This is how Add Comment applies its edit: one transaction, so undo works
    // where the value-prop path would treat it as a restored load.
    expect(undoDepth(editor.state)).toBeGreaterThan(0);

    act(() => {
      undo(editor);
    });
    expect(editor.state.doc.toString()).toBe('');
  });
});
