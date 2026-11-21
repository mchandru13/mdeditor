import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EditorView } from '@codemirror/view';

import { createFakePlatform } from '../../src/platform/fake';
import { App } from '../../src/App';

/**
 * Add Comment against the *real* CodeMirror editor.
 *
 * `tests/integration/app.test.tsx` mocks the editor, and the mock returned a
 * constant selection regardless of what the user had selected — which hid a real
 * bug where the command refused a good selection (and another where it accepted
 * a collapsed caret). These tests mount the real editor and drive its selection
 * through CodeMirror itself, so the command reads what a user's selection
 * actually is.
 */
async function openDocument(markdown: string) {
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

/** Selects `[from, to)` in the real editor, as clicking and dragging would. */
function select(platform: ReturnType<typeof createFakePlatform>, view: EditorView, from: number, to: number) {
  act(() => {
    view.dispatch({ selection: { anchor: from, head: to } });
  });
  act(() => {
    platform.emitMenu('edit.comment');
  });
}

describe('Add Comment with the real editor', () => {
  it('refuses a collapsed caret with an actionable message', async () => {
    const { platform, view } = await openDocument('alpha beta gamma\n');

    act(() => {
      view.dispatch({ selection: { anchor: 3 } });
    });
    await act(async () => {
      platform.emitMenu('edit.comment');
    });

    expect(await screen.findByText(/Select the text to comment on first/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens for a real selection and inserts the comment at that paragraph', async () => {
    const { platform, view } = await openDocument('alpha beta gamma\n\nsecond paragraph\n');

    select(platform, view, 0, 'alpha beta gamma'.length);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText(/Attached after/).textContent).toContain('alpha beta gamma');

    fireEvent.change(screen.getByLabelText('Comment'), { target: { value: 'real note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add comment' }));

    await waitFor(() => {
      expect(view.state.doc.toString()).toContain('> [!comment]');
    });
    expect(view.state.doc.toString()).toContain('> real note');
    // The comment lands after the annotated paragraph, before the next one.
    expect(view.state.doc.toString()).toContain('> real note\n\nsecond paragraph');
  });

  it('is undoable in the real editor', async () => {
    const { platform, view } = await openDocument('alpha beta gamma\n');

    select(platform, view, 0, 'alpha beta gamma'.length);
    fireEvent.change(await screen.findByLabelText('Comment'), { target: { value: 'undo me' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add comment' }));
    await waitFor(() => expect(view.state.doc.toString()).toContain('undo me'));

    act(() => {
      view.dispatch({});
    });
    // Undo through the app's own command, not a direct CodeMirror call.
    await act(async () => {
      platform.emitMenu('edit.undo');
    });
    expect(view.state.doc.toString()).toBe('alpha beta gamma\n');
  });
});
