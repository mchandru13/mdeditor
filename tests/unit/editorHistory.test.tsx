import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { undo, undoDepth } from '@codemirror/commands';

import { Editor, type EditorHandle } from '../../src/components/Editor/Editor';

function element(docId: string, value: string) {
  return (
    <Editor
      ref={createRef<EditorHandle>()}
      docId={docId}
      value={value}
      onChange={() => undefined}
      initialScroll={0}
    />
  );
}

function mount(docId: string, value: string) {
  const view = render(element(docId, value));
  const host = view.container.querySelector('.editor-host, .editor, div');
  if (!host) throw new Error('editor host missing');
  const editor = EditorView.findFromDOM(host as HTMLElement);
  if (!editor) throw new Error('editor view not mounted');
  return { rerender: view.rerender, editor };
}

describe('editor undo history', () => {
  it('does not let undo cross a tab switch', () => {
    const { rerender, editor } = mount('a', 'AAAA');

    act(() => {
      editor.dispatch({ changes: { from: 4, insert: '-mine' }, userEvent: 'input.type' });
    });
    expect(undoDepth(editor.state)).toBe(1);

    rerender(element('b', 'BBBB'));
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
    rerender(element('c', 'loaded from disk'));
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
    rerender(element('c', 'replaced by Replace All'));
    expect(editor.state.doc.toString()).toBe('replaced by Replace All');
    expect(undoDepth(editor.state)).toBeGreaterThan(0);
  });
});
