import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { createFakePlatform } from '../../src/platform/fake';
import { App } from '../../src/App';

/**
 * Add Comment in Read Mode and from the preview.
 *
 * Read Mode mounts no editor at all, so the command used to be dead there — and
 * a selection in the rendered document is the natural one to comment on. These
 * cases were untested: every other test selected text in the source editor.
 */

async function openInReadMode(markdown: string) {
  const platform = createFakePlatform({ clipboard: markdown });
  render(<App platform={platform} initialMode="read" />);
  fireEvent.click(await screen.findByRole('button', { name: 'From clipboard' }));
  await screen.findByRole('tab', { name: /Pasted document/ });
  await waitFor(() => expect(document.querySelector('.markdown-body p')).not.toBeNull());
  return { platform };
}

/** Selects rendered text in the preview, the way a reader does. */
function selectInPreview(text: string) {
  const paragraph = [...document.querySelectorAll('.markdown-body p')].find((p) =>
    p.textContent?.includes(text),
  );
  if (!paragraph?.firstChild) throw new Error('paragraph not found');
  const node = paragraph.firstChild;
  const start = (node.textContent ?? '').indexOf(text);
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, start + text.length);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return selection?.toString() ?? '';
}

describe('Add Comment from the preview', () => {
  it('works in Read Mode, where no editor is mounted', async () => {
    const { platform } = await openInReadMode(
      'The cache is invalidated on write.\n\nA second paragraph.\n',
    );

    expect(selectInPreview('cache is invalidated')).toBe('cache is invalidated');
    await act(async () => {
      platform.emitMenu('edit.comment');
    });

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    // The anchor is the paragraph that was selected, not the document start.
    expect(screen.getByText(/Attached after/).textContent).toContain('cache is invalidated');
  });

  it('inserts the comment after that paragraph in the source', async () => {
    const { platform } = await openInReadMode(
      'The cache is invalidated on write.\n\nA second paragraph.\n',
    );

    selectInPreview('cache is invalidated');
    await act(async () => {
      platform.emitMenu('edit.comment');
    });

    fireEvent.change(await screen.findByLabelText('Comment'), {
      target: { value: 'read mode note' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add comment' }));

    // Back to a mode with an editor so the source can be inspected. The real
    // editor is a lazy CodeMirror chunk whose label sits on its content element,
    // so read text rather than a textarea value.
    await act(async () => {
      platform.emitMenu('view.edit');
    });
    const editor = await waitFor(
      () => screen.getByLabelText('Markdown source editor') as HTMLElement,
      { timeout: 15000 },
    );
    const source = editor.textContent ?? '';
    expect(source).toContain('> [!comment]');
    expect(source).toContain('> read mode note');
    expect(source.indexOf('[!comment]')).toBeLessThan(source.indexOf('A second paragraph.'));
  });

  it('asks for a selection when nothing is selected in Read Mode', async () => {
    const { platform } = await openInReadMode('Just one paragraph.\n');
    window.getSelection()?.removeAllRanges();

    await act(async () => {
      platform.emitMenu('edit.comment');
    });

    expect(await screen.findByText(/Select text in the document first/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('offers Add Comment on the right-click menu over a selection', async () => {
    const { platform } = await openInReadMode('Right click me please.\n');
    selectInPreview('click me');

    const body = document.querySelector('.markdown-body');
    expect(body).not.toBeNull();
    fireEvent.contextMenu(body!, { clientX: 120, clientY: 90 });

    const item = await screen.findByRole('menuitem', { name: 'Add Comment…' });
    fireEvent.click(item);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    void platform;
  });

  it('does not offer the menu without a selection', async () => {
    await openInReadMode('Nothing selected here.\n');
    window.getSelection()?.removeAllRanges();

    fireEvent.contextMenu(document.querySelector('.markdown-body')!, { clientX: 10, clientY: 10 });
    expect(screen.queryByRole('menuitem', { name: 'Add Comment…' })).toBeNull();
  });
});

describe('right-click on a rendered comment', () => {
  const TWO = [
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

  async function openWithTwoComments() {
    const platform = createFakePlatform({ clipboard: TWO });
    render(<App platform={platform} initialMode="read" />);
    fireEvent.click(await screen.findByRole('button', { name: 'From clipboard' }));
    await screen.findByRole('tab', { name: /Pasted document/ });
    await waitFor(() => {
      expect(document.querySelectorAll('.markdown-body .mdeditor-comment')).toHaveLength(2);
    });
    return { platform };
  }

  /** Right-clicks the *second* rendered comment. */
  function rightClickSecondComment() {
    const comments = document.querySelectorAll('.markdown-body .mdeditor-comment');
    expect(comments).toHaveLength(2);
    fireEvent.contextMenu(comments[1]!, { clientX: 100, clientY: 200 });
  }

  it('offers Edit and Remove for that comment, not Add', async () => {
    await openWithTwoComments();
    rightClickSecondComment();

    expect(await screen.findByRole('menuitem', { name: 'Edit Comment…' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Remove Comment' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Add Comment…' })).toBeNull();
  });

  it('edits the comment that was right-clicked, not the caret one', async () => {
    await openWithTwoComments();
    rightClickSecondComment();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit Comment…' }));

    const dialog = await screen.findByRole('dialog', { name: 'Edit comment' });
    // Read Mode has no editor caret at all, so this can only come from the
    // rendered comment that was clicked.
    expect((dialog.querySelector('#comment-body') as HTMLTextAreaElement).value).toBe('second note');
  });

  it('removes the comment that was right-clicked and leaves the other', async () => {
    const { platform } = await openWithTwoComments();
    rightClickSecondComment();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove Comment' }));

    await waitFor(() => {
      expect(document.querySelectorAll('.markdown-body .mdeditor-comment')).toHaveLength(1);
    });
    // The first comment is the one left behind.
    const remaining = document.querySelector('.markdown-body .mdeditor-comment')?.textContent ?? '';
    expect(remaining).toContain('first note');
    expect(remaining).not.toContain('second note');
    void platform;
  });
});
