import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EditorView } from '@codemirror/view';

import { createFakePlatform } from '../../src/platform/fake';
import { App } from '../../src/App';

/**
 * Edit Comment, Remove Comment and Remove All Comments.
 *
 * Driven through the native menu ids, because that is how the commands are
 * reached in the packaged app; the shortcut and the right-click menu are covered
 * elsewhere.
 */
const WITH_COMMENTS = [
  'First paragraph.',
  '',
  '> [!comment] chand',
  '>',
  '> first note',
  '',
  'Second paragraph.',
  '',
  '> [!comment]',
  '>',
  '> second note',
  '',
].join('\n');

/** The real editor: the comment commands read CodeMirror's selection. */
async function openEditor(markdown: string) {
  const platform = createFakePlatform({ clipboard: markdown });
  render(<App platform={platform} initialMode="edit" />);
  fireEvent.click(await screen.findByRole('button', { name: 'From clipboard' }));
  await screen.findByRole('tab', { name: /Pasted document/ });
  const content = await waitFor(() => {
    const view = document.querySelector('.cm-content');
    expect(view).not.toBeNull();
    return view as HTMLElement;
  });
  const view = EditorView.findFromDOM(content);
  if (!view) throw new Error('CodeMirror view not mounted');
  return { platform, view };
}

function value(view: EditorView) {
  return view.state.doc.toString();
}

/** Puts the caret inside the first comment block. */
function caretInFirstComment(view: EditorView) {
  const at = view.state.doc.toString().indexOf('first note');
  act(() => {
    view.dispatch({ selection: { anchor: at } });
  });
}

describe('manage comments', () => {
  it('edits the comment the caret is in', async () => {
    const { platform, view } = await openEditor(WITH_COMMENTS);
    caretInFirstComment(view);

    await act(async () => {
      platform.emitMenu('edit.comment.edit');
    });

    const dialog = await screen.findByRole('dialog', { name: 'Edit comment' });
    expect((screen.getByLabelText('Comment') as HTMLTextAreaElement).value).toBe('first note');

    fireEvent.change(screen.getByLabelText('Comment'), { target: { value: 'first note edited' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save comment' }));

    await waitFor(() => {
      expect(value(view)).toContain('first note edited');
    });
    // Edited in place: one block, not two.
    expect(value(view)).not.toContain('first note\n');
    expect(value(view).match(/\[!comment\]/g)).toHaveLength(2);
    expect(value(view)).toContain('second note');
    void dialog;
  });

  it('removes the comment being edited', async () => {
    const { platform, view } = await openEditor(WITH_COMMENTS);
    caretInFirstComment(view);
    await act(async () => {
      platform.emitMenu('edit.comment.edit');
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Remove comment' }));

    await waitFor(() => {
      expect(value(view)).not.toContain('first note');
    });
    expect(value(view)).toContain('First paragraph.');
    expect(value(view)).toContain('second note');
    expect(value(view).match(/\[!comment\]/g)).toHaveLength(1);
  });

  it('removes every comment and keeps the prose', async () => {
    const { platform, view } = await openEditor(WITH_COMMENTS);

    await act(async () => {
      platform.emitMenu('edit.comment.removeAll');
    });

    await waitFor(() => {
      expect(value(view)).not.toContain('[!comment]');
    });
    expect(value(view)).toBe('First paragraph.\n\nSecond paragraph.\n');
    expect(await screen.findByText(/Removed 2 comments/)).toBeInTheDocument();
  });

  it('says so when there is nothing to remove', async () => {
    const { platform } = await openEditor('Only prose.\n');

    await act(async () => {
      platform.emitMenu('edit.comment.removeAll');
    });
    expect(await screen.findByText(/no comments/)).toBeInTheDocument();
  });

  it('explains when the document has no comments to edit', async () => {
    const { platform } = await openEditor('Only prose.\n');

    await act(async () => {
      platform.emitMenu('edit.comment.edit');
    });
    expect(await screen.findByText(/no comments/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
