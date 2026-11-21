import { forwardRef, useImperativeHandle, useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { createFakePlatform } from '../../src/platform/fake';

vi.mock('../../src/components/Editor/Editor', () => {
  const MockEditor = forwardRef(function MockEditor(
    {
      value,
      onChange,
      spellCheck,
    }: {
      value: string;
      onChange: (value: string) => void;
      docId: string;
      initialScroll: number;
      spellCheck?: boolean;
    },
    ref,
  ) {
    // The mock is controlled, so `replaceRange` has to apply the change through
    // `onChange` the way the real editor's transaction does.
    const valueRef = useRef(value);
    valueRef.current = value;

    useImperativeHandle(ref, () => ({
      focus: () => undefined,
      scrollTo: () => undefined,
      selectRange: () => undefined,
      getSelection: () => ({ from: 0, to: 0 }),
      replaceRange: (from: number, to: number, text: string) => {
        onChange(`${valueRef.current.slice(0, from)}${text}${valueRef.current.slice(to)}`);
      },
      getScrollTop: () => 0,
      restoreScroll: () => undefined,
      lineAtScrollTop: () => 1,
      scrollToLine: () => undefined,
      undo: () => undefined,
      redo: () => undefined,
    }));

    return (
      <textarea
        aria-label="Markdown source editor"
        data-spellcheck={String(spellCheck ?? true)}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  });

  return { Editor: MockEditor };
});

const { App } = await import('../../src/App');

function renderApp(options: Parameters<typeof createFakePlatform>[0] = {}, mode: 'read' | 'edit' | 'split' = 'edit') {
  const platform = createFakePlatform(options);
  const view = render(<App platform={platform} initialMode={mode} />);
  return { platform, ...view };
}

async function openFromClipboard(
  text = '# Pasted\n\nalpha alpha\n',
  options: Parameters<typeof createFakePlatform>[0] = {},
) {
  const result = renderApp({ clipboard: text, ...options });
  fireEvent.click(await screen.findByRole('button', { name: 'From clipboard' }));
  await screen.findByRole('tab', { name: /Pasted document/ });
  return result;
}

describe('workspace modes', () => {
  it('starts empty and explains the available entry points', async () => {
    renderApp();
    expect(await screen.findByText('No document open')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New document' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Browse for file' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open a URL' })).toBeInTheDocument();
  });

  it('creates an untitled document from the empty state', async () => {
    renderApp();
    fireEvent.click(await screen.findByRole('button', { name: 'New document' }));

    expect(await screen.findByRole('tab', { name: /Untitled 1/ })).toBeInTheDocument();
    expect(await screen.findByLabelText('Markdown source editor')).toHaveValue('');
  });

  it('shows only the editor in Edit Mode', async () => {
    await openFromClipboard();
    expect(await screen.findByLabelText('Markdown source editor')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Rendered document' })).toBeNull();
  });

  it('shows only the rendered document in Read Mode', async () => {
    await openFromClipboard('# Title\n\nBody text\n');
    fireEvent.keyDown(window, { key: '1', ctrlKey: true });

    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Rendered document' })).toBeInTheDocument();
    });
    expect(screen.queryByLabelText('Markdown source editor')).toBeNull();
    expect(await screen.findByRole('heading', { name: 'Title' })).toBeInTheDocument();
  });

  it('shows both panes in Split Mode', async () => {
    await openFromClipboard();
    fireEvent.keyDown(window, { key: '3', ctrlKey: true });

    await waitFor(() => {
      expect(screen.queryByLabelText('Markdown source editor')).not.toBeNull();
      expect(screen.getByRole('region', { name: 'Rendered document' })).toBeInTheDocument();
    });
  });

  it('marks the active mode in the radiogroup', async () => {
    await openFromClipboard();
    fireEvent.keyDown(window, { key: '1', ctrlKey: true });

    const radios = await screen.findAllByRole('radio');
    const read = radios.find((radio) => radio.textContent === 'Read');
    expect(read).toHaveAttribute('aria-checked', 'true');
  });

  it('preserves unsaved edits across every mode transition', async () => {
    await openFromClipboard('# Original\n');
    const editor = await screen.findByLabelText('Markdown source editor');

    fireEvent.change(editor, { target: { value: '# Edited\n\nEdited body\n' } });

    for (const key of ['1', '2', '3', '1', '3', '2']) {
      fireEvent.keyDown(window, { key, ctrlKey: true });
      await waitFor(() => {
        const current = screen.queryByLabelText('Markdown source editor');
        if (current) expect(current).toHaveValue('# Edited\n\nEdited body\n');
      });
    }

    expect(await screen.findByLabelText('Markdown source editor')).toHaveValue('# Edited\n\nEdited body\n');
  });
});

describe('tabs and dirty state', () => {
  it('marks a tab as modified when the source changes', async () => {
    const { platform } = renderApp({ files: { 'C:\\docs\\clean.md': 'original\n' } });
    await act(async () => {
      platform.dragDrop(['C:\\docs\\clean.md']);
    });
    await screen.findByRole('tab', { name: /clean.md/ });

    expect(screen.queryByLabelText('Unsaved changes')).toBeNull();

    fireEvent.change(await screen.findByLabelText('Markdown source editor'), {
      target: { value: 'changed' },
    });

    expect(await screen.findByLabelText('Unsaved changes')).toBeInTheDocument();
  });

  it('keeps source state independent per tab', async () => {
    const { platform } = renderApp({
      files: { 'C:\\docs\\a.md': '# A\n', 'C:\\docs\\b.md': '# B\n' },
    });

    await act(async () => {
      platform.dragDrop(['C:\\docs\\a.md', 'C:\\docs\\b.md']);
    });

    const tabs = await screen.findAllByRole('tab');
    expect(tabs).toHaveLength(2);

    fireEvent.click(tabs[0]!);
    fireEvent.change(await screen.findByLabelText('Markdown source editor'), {
      target: { value: '# A edited\n' },
    });

    fireEvent.click(tabs[1]!);
    expect(await screen.findByLabelText('Markdown source editor')).toHaveValue('# B\n');

    fireEvent.click(tabs[0]!);
    expect(await screen.findByLabelText('Markdown source editor')).toHaveValue('# A edited\n');
  });

  it('asks before discarding unsaved changes', async () => {
    const { platform } = renderApp({ clipboard: 'text', confirmResult: false });
    fireEvent.click(await screen.findByRole('button', { name: 'From clipboard' }));
    await screen.findByRole('tab', { name: /Pasted document/ });

    fireEvent.change(await screen.findByLabelText('Markdown source editor'), {
      target: { value: 'changed' },
    });

    fireEvent.keyDown(window, { key: 'w', ctrlKey: true });

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Pasted document/ })).toBeInTheDocument();
    });
    expect(platform.files.size).toBe(0);
  });

  it('closes a clean tab without prompting', async () => {
    const { platform } = renderApp({ files: { 'C:\\docs\\clean.md': 'original\n' } });
    await act(async () => {
      platform.dragDrop(['C:\\docs\\clean.md']);
    });
    await screen.findByRole('tab', { name: /clean.md/ });

    fireEvent.keyDown(window, { key: 'w', ctrlKey: true });

    await waitFor(() => {
      expect(screen.queryByRole('tab')).toBeNull();
    });
  });
});

describe('saving', () => {
  it('writes to the chosen path and clears the dirty marker', async () => {
    const { platform } = renderApp({ clipboard: '# Save me\n', savePath: 'C:\\out\\note.md' });
    fireEvent.click(await screen.findByRole('button', { name: 'From clipboard' }));
    await screen.findByRole('tab', { name: /Pasted document/ });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(platform.files.get('C:\\out\\note.md')).toContain('# Save me');
    });
    await waitFor(() => {
      expect(screen.queryByLabelText('Unsaved changes')).toBeNull();
    });
    expect(screen.getByRole('tab', { name: /note.md/ })).toBeInTheDocument();
  });

  it('reports a failed save without dropping the buffer', async () => {
    const { platform } = renderApp({
      clipboard: 'content',
      savePath: 'C:\\out\\x.md',
      writeFileError: 'disk is full',
    });

    fireEvent.click(await screen.findByRole('button', { name: 'From clipboard' }));
    await screen.findByRole('tab', { name: /Pasted document/ });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/Save failed: disk is full/)).toBeInTheDocument();
    expect(await screen.findByLabelText('Markdown source editor')).toHaveValue('content');
    expect(platform.files.size).toBe(0);
  });
});

describe('search', () => {
  it('counts matches and navigates between them', async () => {
    await openFromClipboard('# Heading\n\nalpha alpha alpha\n');

    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    const input = await screen.findByLabelText('Search text');
    fireEvent.change(input, { target: { value: 'alpha' } });

    await waitFor(() => {
      expect(screen.getByText('1 of 3')).toBeInTheDocument();
    });

    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(screen.getByText('2 of 3')).toBeInTheDocument();
    });

    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    await waitFor(() => {
      expect(screen.getByText('1 of 3')).toBeInTheDocument();
    });
  });

  it('reports when nothing matches', async () => {
    await openFromClipboard('some text');
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    fireEvent.change(await screen.findByLabelText('Search text'), {
      target: { value: 'absent' },
    });

    await waitFor(() => {
      expect(screen.getByText('No matches')).toBeInTheDocument();
    });
  });

  it('closes on Escape', async () => {
    await openFromClipboard('some text');
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    expect(await screen.findByLabelText('Search text')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByLabelText('Search text')).toBeNull();
    });
  });

  it('searches the source in Edit Mode', async () => {
    await openFromClipboard('# Title\n\nneedle here\nneedle again\n');
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    fireEvent.change(await screen.findByLabelText('Search text'), {
      target: { value: 'needle' },
    });

    await waitFor(() => {
      expect(screen.getByText('1 of 2')).toBeInTheDocument();
    });
  });
});

describe('remote documents', () => {
  it('opens a remote URL through the explicit dialog', async () => {
    const { platform } = renderApp({
      fetchResult: { text: '# Remote\n\nbody\n', finalUrl: 'https://example.com/readme.md' },
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Open URL' }));
    fireEvent.change(await screen.findByLabelText('HTTPS URL'), {
      target: { value: 'https://example.com/readme.md' },
    });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Open' }));

    expect(await screen.findByRole('tab', { name: /readme.md/ })).toBeInTheDocument();
    expect(platform.openedUrls).toEqual([]);
  });

  it('rejects non-HTTPS URLs before fetching', async () => {
    const { platform } = renderApp();
    fireEvent.click(await screen.findByRole('button', { name: 'Open URL' }));
    fireEvent.change(await screen.findByLabelText('HTTPS URL'), {
      target: { value: 'http://example.com/a.md' },
    });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Open' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Only HTTPS URLs are supported');
    expect(platform.files.size).toBe(0);
  });

  it('surfaces fetch failures in the dialog', async () => {
    renderApp({ fetchResult: new Error('HTTP 404') });
    fireEvent.click(await screen.findByRole('button', { name: 'Open URL' }));
    fireEvent.change(await screen.findByLabelText('HTTPS URL'), {
      target: { value: 'https://example.com/missing.md' },
    });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Open' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 404');
  });
});

describe('menu commands', () => {
  it('switches modes from View commands', async () => {
    const { platform } = await openFromClipboard('text');

    await act(async () => {
      platform.emitMenu('view.read');
    });
    const radios = await screen.findAllByRole('radio');
    expect(radios.find((radio) => radio.textContent === 'Read')).toHaveAttribute(
      'aria-checked',
      'true',
    );

    await act(async () => {
      platform.emitMenu('view.split');
    });
    await waitFor(() => {
      expect(screen.queryByLabelText('Markdown source editor')).not.toBeNull();
    });
  });

  it('toggles the contents sidebar from the View menu', async () => {
    const { platform } = await openFromClipboard('# One\n\n## Two\n');

    await act(async () => {
      platform.emitMenu('view.read');
    });
    await screen.findByRole('navigation', { name: 'Table of contents' });

    await act(async () => {
      platform.emitMenu('view.toc');
    });
    await waitFor(() => {
      expect(screen.queryByRole('navigation', { name: 'Table of contents' })).toBeNull();
    });
  });

  it('saves through the File menu', async () => {
    const { platform } = renderApp({ clipboard: '# saved from menu\n', savePath: 'C:\\out\\menu.md' });
    fireEvent.click(await screen.findByRole('button', { name: 'From clipboard' }));
    await screen.findByRole('tab', { name: /Pasted document/ });

    await act(async () => {
      platform.emitMenu('file.save');
    });

    await waitFor(() => {
      expect(platform.files.get('C:\\out\\menu.md')).toContain('# saved from menu');
    });
  });

  it('opens the search bar from Edit > Find', async () => {
    const { platform } = await openFromClipboard('needle');

    await act(async () => {
      platform.emitMenu('edit.find');
    });
    expect(await screen.findByLabelText('Search text')).toBeInTheDocument();
  });

  it('writes a comment into the document from Edit > Add Comment', async () => {
    const { platform } = await openFromClipboard('alpha beta\n');

    // The editor is lazy-loaded; Ctrl+Alt+M needs a mounted editor to read the
    // selection from, and refuses with a message rather than guessing offsets.
    await screen.findByLabelText('Markdown source editor');

    await act(async () => {
      platform.emitMenu('edit.comment');
    });

    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Comment'), {
      target: { value: 'why is this here?' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add comment' }));

    await waitFor(() => {
      const editor = screen.getByLabelText('Markdown source editor') as HTMLTextAreaElement;
      expect(editor.value).toContain('alpha beta');
      expect(editor.value).toContain('> [!comment]');
      expect(editor.value).toContain('> why is this here?');
    });
  });

  it('refuses to comment in Read Mode', async () => {
    const { platform } = await openFromClipboard('# Read only\n');

    await act(async () => {
      platform.emitMenu('view.read');
    });
    await act(async () => {
      platform.emitMenu('edit.comment');
    });

    expect(await screen.findByText(/Switch to Edit or Split mode/)).toBeInTheDocument();
  });

  it('shows the shortcut reference and About box from Help', async () => {
    const { platform } = renderApp();

    await act(async () => {
      platform.emitMenu('help.shortcuts');
    });
    const shortcuts = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(shortcuts).toHaveTextContent('Ctrl+S');

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    await act(async () => {
      platform.emitMenu('help.about');
    });
    expect(await screen.findByRole('dialog', { name: 'About Markdown Editor' })).toBeInTheDocument();
  });

  it('asks before exiting with unsaved changes', async () => {
    const { platform } = renderApp({ clipboard: 'text', confirmResult: false });
    fireEvent.click(await screen.findByRole('button', { name: 'From clipboard' }));
    await screen.findByRole('tab', { name: /Pasted document/ });

    fireEvent.change(await screen.findByLabelText('Markdown source editor'), {
      target: { value: 'changed' },
    });

    await act(async () => {
      platform.emitMenu('file.exit');
    });

    // confirmResult is false, so closeWindow must not have been called; the tab stays.
    expect(platform.closeRequests).toBe(0);
    expect(screen.queryByRole('tab')).not.toBeNull();
  });

  it('ignores unknown command ids', async () => {
    const { platform } = renderApp({ clipboard: 'text' });
    fireEvent.click(await screen.findByRole('button', { name: 'From clipboard' }));

    await act(async () => {
      platform.emitMenu('does.not.exist');
    });
    expect(screen.queryByRole('tab')).not.toBeNull();
  });
});

describe('new documents', () => {
  it('creates an untitled document from the File menu', async () => {
    const { platform } = renderApp();

    await act(async () => {
      platform.emitMenu('file.new');
    });

    expect(await screen.findByRole('tab', { name: /Untitled 1/ })).toBeInTheDocument();
    expect(screen.queryByLabelText('Unsaved changes')).toBeNull();
  });

  it('numbers new documents without reusing titles', async () => {
    const { platform } = renderApp();

    await act(async () => {
      platform.emitMenu('file.new');
    });
    await screen.findByRole('tab', { name: /Untitled 1/ });

    await act(async () => {
      platform.emitMenu('file.new');
    });
    expect(await screen.findByRole('tab', { name: /Untitled 2/ })).toBeInTheDocument();
  });

  it('creates a document with Ctrl+N', async () => {
    renderApp();
    fireEvent.keyDown(window, { key: 'n', ctrlKey: true });

    expect(await screen.findByRole('tab', { name: /Untitled 1/ })).toBeInTheDocument();
  });

  it('saves a new document through Save As', async () => {
    const { platform } = renderApp({ savePath: 'C:\\out\\fresh.md' });

    await act(async () => {
      platform.emitMenu('file.new');
    });
    await screen.findByRole('tab', { name: /Untitled 1/ });

    fireEvent.change(await screen.findByLabelText('Markdown source editor'), {
      target: { value: '# fresh\n' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(platform.files.get('C:\\out\\fresh.md')).toContain('# fresh');
    });
    expect(await screen.findByRole('tab', { name: /fresh.md/ })).toBeInTheDocument();
  });
});

describe('replace', () => {
  it('replaces every occurrence with Ctrl+H', async () => {
    await openFromClipboard('alpha alpha ALPHA\n');

    fireEvent.keyDown(window, { key: 'h', ctrlKey: true });
    fireEvent.change(await screen.findByLabelText('Search text'), {
      target: { value: 'alpha' },
    });
    fireEvent.change(screen.getByLabelText('Replace with'), { target: { value: 'beta' } });

    fireEvent.click(screen.getByRole('button', { name: 'Replace all' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Markdown source editor')).toHaveValue('beta beta beta\n');
    });
    expect(screen.getByText('Replaced 3 occurrences.')).toBeInTheDocument();
  });

  it('replaces only the current match', async () => {
    await openFromClipboard('alpha alpha\n');

    fireEvent.keyDown(window, { key: 'h', ctrlKey: true });
    fireEvent.change(await screen.findByLabelText('Search text'), {
      target: { value: 'alpha' },
    });
    fireEvent.change(screen.getByLabelText('Replace with'), { target: { value: 'beta' } });

    fireEvent.click(screen.getByRole('button', { name: /^Replace$/ }));

    await waitFor(() => {
      expect(screen.getByLabelText('Markdown source editor')).toHaveValue('beta alpha\n');
    });
  });

  it('respects the case-sensitive toggle', async () => {
    await openFromClipboard('alpha ALPHA\n');

    fireEvent.keyDown(window, { key: 'h', ctrlKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'Aa' }));
    fireEvent.change(await screen.findByLabelText('Search text'), {
      target: { value: 'ALPHA' },
    });
    fireEvent.change(screen.getByLabelText('Replace with'), { target: { value: 'X' } });

    fireEvent.click(screen.getByRole('button', { name: 'Replace all' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Markdown source editor')).toHaveValue('alpha X\n');
    });
  });

  it('disables replacement in Read Mode and explains why', async () => {
    await openFromClipboard('alpha\n');

    fireEvent.keyDown(window, { key: '1', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'h', ctrlKey: true });

    expect(await screen.findByLabelText('Replace with')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Replace all' })).toBeDisabled();
    expect(screen.getByText('Switch to Edit or Split to replace')).toBeInTheDocument();
  });

  it('keeps the current match index while replacing', async () => {
    await openFromClipboard('a a a\n');

    fireEvent.keyDown(window, { key: 'h', ctrlKey: true });
    fireEvent.change(await screen.findByLabelText('Search text'), {
      target: { value: 'a' },
    });
    fireEvent.change(screen.getByLabelText('Replace with'), { target: { value: 'b' } });

    await waitFor(() => {
      expect(screen.getByText('1 of 3')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /^Replace$/ }));

    await waitFor(() => {
      expect(screen.getByLabelText('Markdown source editor')).toHaveValue('b a a\n');
      expect(screen.getByText('1 of 2')).toBeInTheDocument();
    });
  });
});

describe('external file changes', () => {
  async function openFile(path: string, platform: ReturnType<typeof createFakePlatform>) {
    await act(async () => {
      platform.dragDrop([path]);
    });
    await screen.findByRole('tab', { name: new RegExp(path.split('\\').pop() ?? '') });
  }

  it('reloads a clean buffer when the file changes on disk', async () => {
    const { platform } = renderApp({ files: { 'C:\\docs\\a.md': '# One\n' } });
    await openFile('C:\\docs\\a.md', platform);
    expect(await screen.findByLabelText('Markdown source editor')).toHaveValue('# One\n');

    platform.writeExternally('C:\\docs\\a.md', '# Two\n');
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => {
      expect(screen.getByLabelText('Markdown source editor')).toHaveValue('# Two\n');
    });
    expect(screen.getByText(/was reloaded from disk/)).toBeInTheDocument();
  });

  it('asks before discarding edits and keeps them when declined', async () => {
    const { platform } = renderApp({
      files: { 'C:\\docs\\b.md': '# Original\n' },
      confirmResult: false,
    });
    await openFile('C:\\docs\\b.md', platform);

    fireEvent.change(await screen.findByLabelText('Markdown source editor'), {
      target: { value: '# Mine\n' },
    });

    platform.writeExternally('C:\\docs\\b.md', '# Theirs\n');
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => {
      expect(screen.getByLabelText('Markdown source editor')).toHaveValue('# Mine\n');
    });
  });

  it('reloads over edits when the user confirms', async () => {
    const { platform } = renderApp({
      files: { 'C:\\docs\\c.md': '# Original\n' },
      confirmResult: true,
    });
    await openFile('C:\\docs\\c.md', platform);

    fireEvent.change(await screen.findByLabelText('Markdown source editor'), {
      target: { value: '# Mine\n' },
    });

    platform.writeExternally('C:\\docs\\c.md', '# Theirs\n');
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => {
      expect(screen.getByLabelText('Markdown source editor')).toHaveValue('# Theirs\n');
    });
  });

  it('does not prompt again after the user keeps the local copy', async () => {
    const { platform } = renderApp({
      files: { 'C:\\docs\\d.md': '# Original\n' },
      confirmResult: false,
    });
    await openFile('C:\\docs\\d.md', platform);

    fireEvent.change(await screen.findByLabelText('Markdown source editor'), {
      target: { value: '# Mine\n' },
    });

    platform.writeExternally('C:\\docs\\d.md', '# Theirs\n');
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => {
      expect(screen.getByLabelText('Markdown source editor')).toHaveValue('# Mine\n');
    });

    // Same disk state, no further change: the prompt must not repeat.
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(screen.getByLabelText('Markdown source editor')).toHaveValue('# Mine\n');
  });
});

describe('command line arguments', () => {
  it('opens the file passed with --file', async () => {
    renderApp({ startupFile: 'C:\\docs\\cli.md', files: { 'C:\\docs\\cli.md': '# From CLI\n' } });

    expect(await screen.findByRole('tab', { name: /cli.md/ })).toBeInTheDocument();
    expect(await screen.findByLabelText('Markdown source editor')).toHaveValue('# From CLI\n');
  });

  it('ignores a --file path that is not Markdown', async () => {
    renderApp({ startupFile: 'C:\\docs\\notes.txt', files: { 'C:\\docs\\notes.txt': 'x' } });

    await waitFor(() => {
      expect(screen.getByText(/Only \.md and \.markdown files are supported/)).toBeInTheDocument();
    });
  });
});

describe('file association', () => {
  it('opens a file handed over by a second launch', async () => {
    const { platform } = renderApp({ files: { 'C:\\docs\\drop.md': '# Dropped\n' } });

    await act(async () => {
      platform.openFileExternally('C:\\docs\\drop.md');
    });

    expect(await screen.findByRole('tab', { name: /drop.md/ })).toBeInTheDocument();
    expect(await screen.findByLabelText('Markdown source editor')).toHaveValue('# Dropped\n');
  });

  it('rejects a non-Markdown file handed over by a second launch', async () => {
    const { platform } = renderApp({ files: { 'C:\\docs\\a.txt': 'x' } });

    await act(async () => {
      platform.openFileExternally('C:\\docs\\a.txt');
    });

    expect(
      await screen.findByText(/Only \.md and \.markdown files are supported/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('tab')).toBeNull();
  });
});

describe('remote images', () => {
  async function openInReadMode(markdown: string) {
    const result = renderApp({ clipboard: markdown }, 'read');
    fireEvent.click(await screen.findByRole('button', { name: 'From clipboard' }));
    await screen.findByRole('tab', { name: /Pasted document/ });
    return result;
  }

  it('blocks remote images and offers to load them', async () => {
    const { container } = await openInReadMode(
      '# Remote\n\n![tracker](https://attacker.test/pixel.png)\n',
    );

    expect(await screen.findByText(/1 remote image not loaded/i)).toBeInTheDocument();
    expect(container.querySelector('.markdown-body img')).toBeNull();
    expect(screen.getByText(/\[remote image: tracker\]/)).toBeInTheDocument();
  });

  it('loads them after the per-document opt-in', async () => {
    const { container } = await openInReadMode(
      '# Remote\n\n![tracker](https://attacker.test/pixel.png)\n',
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Load images' }));

    await waitFor(() => {
      const img = container.querySelector('.markdown-body img');
      expect(img?.getAttribute('src')).toBe('https://attacker.test/pixel.png');
    });
  });

  it('does not offer the opt-in when there is nothing to load', async () => {
    await openInReadMode('# Plain\n\nno images here\n');
    expect(screen.queryByRole('button', { name: 'Load images' })).toBeNull();
  });
});

describe('preferences', () => {
  it('turns spell check off and persists the choice', async () => {
    const { platform } = await openFromClipboard('# prose\n\nteh quikc brown\n');
    expect(screen.getByLabelText('Markdown source editor')).toHaveAttribute(
      'data-spellcheck',
      'true',
    );

    await act(async () => {
      platform.emitMenu('view.spellCheck');
    });

    await waitFor(() => {
      expect(screen.getByLabelText('Markdown source editor')).toHaveAttribute(
        'data-spellcheck',
        'false',
      );
    });

    await waitFor(
      () => {
        const latest = platform.settingsWrites.at(-1);
        expect(JSON.parse(latest ?? '{}')).toMatchObject({ spellCheck: false });
      },
      { timeout: 4000 },
    );
  });

  it('restores a persisted spell check preference', async () => {
    const settings = JSON.stringify({
      version: 1,
      theme: 'system',
      mode: 'split',
      tocVisible: true,
      spellCheck: false,
      splitRatio: 0.5,
      docs: [],
      activeIndex: 0,
    });
    renderApp({ settings });
    await screen.findByRole('button', { name: 'New document' });
    fireEvent.click(screen.getByRole('button', { name: 'New document' }));
    expect(await screen.findByLabelText('Markdown source editor')).toHaveAttribute(
      'data-spellcheck',
      'false',
    );
  });

  it('leaves a settings file it refuses untouched instead of overwriting it', async () => {
    // A version this build does not understand must be refused without writing,
    // otherwise the recovery data it holds is silently destroyed on launch.
    const settings = JSON.stringify({
      version: 99,
      theme: 'dark',
      mode: 'split',
      tocVisible: true,
      spellCheck: true,
      splitRatio: 0.5,
      docs: [
        {
          title: 'recovered',
          origin: { kind: 'pasted', baseDir: null },
          recoverySource: 'RECOVERY-MARKER',
          encoding: { bom: false, eol: '\n' },
          scroll: { editor: 0, preview: 0 },
        },
      ],
      activeIndex: 0,
    });

    const { platform } = renderApp({ settings });
    expect(
      await screen.findByText(/Stored settings could not be read/i),
    ).toBeInTheDocument();

    // Well past the 800 ms debounce: nothing may be written over the refused file.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(platform.settingsWrites).toEqual([]);
  });

  it('persists the workspace mode and theme', async () => {
    const { platform } = renderApp({}, 'split');
    fireEvent.keyDown(window, { key: '1', ctrlKey: true });
    fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'dark' } });

    await waitFor(
      () => {
        expect(platform.settingsWrites.length).toBeGreaterThan(0);
      },
      { timeout: 4000 },
    );

    const latest = platform.settingsWrites.at(-1);
    const parsed = JSON.parse(latest ?? '{}') as { mode?: string; theme?: string };
    expect(parsed.mode).toBe('read');
    expect(parsed.theme).toBe('dark');
  });

  it('restores persisted preferences on start', async () => {
    const settings = JSON.stringify({
      version: 1,
      theme: 'dark',
      mode: 'edit',
      tocVisible: false,
      splitRatio: 0.3,
      docs: [],
      activeIndex: 0,
    });

    renderApp({ settings });

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('dark');
    });

    const radios = screen.getAllByRole('radio');
    const edit = radios.find((radio) => radio.textContent === 'Edit');
    expect(edit).toHaveAttribute('aria-checked', 'true');
  });
});

describe('accessibility', () => {  it('exposes named controls and a tablist', async () => {
    await openFromClipboard('text');

    expect(screen.getByRole('toolbar', { name: 'Document actions' })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Open documents' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Workspace mode' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close Pasted document' })).toBeInTheDocument();
  });

  it('moves tab focus with arrow keys', async () => {
    const { platform } = renderApp({
      files: { 'C:\\docs\\a.md': '# A\n', 'C:\\docs\\b.md': '# B\n' },
    });

    await act(async () => {
      platform.dragDrop(['C:\\docs\\a.md', 'C:\\docs\\b.md']);
    });

    const tabs = await screen.findAllByRole('tab');
    tabs[1]!.focus();
    fireEvent.keyDown(tabs[1]!, { key: 'ArrowLeft' });

    await waitFor(() => {
      expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    });
  });
});
