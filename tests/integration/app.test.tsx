import { forwardRef, useImperativeHandle } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { createFakePlatform } from '../../src/platform/fake';

vi.mock('../../src/components/Editor/Editor', () => {
  const MockEditor = forwardRef(function MockEditor(
    {
      value,
      onChange,
    }: {
      value: string;
      onChange: (value: string) => void;
      docId: string;
      initialScroll: number;
    },
    ref,
  ) {
    useImperativeHandle(ref, () => ({
      focus: () => undefined,
      scrollTo: () => undefined,
      selectRange: () => undefined,
      getScrollTop: () => 0,
      restoreScroll: () => undefined,
      lineAtScrollTop: () => 1,
      scrollToLine: () => undefined,
    }));

    return (
      <textarea
        aria-label="Markdown source editor"
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

async function openFromClipboard(text = '# Pasted\n\nalpha alpha\n') {
  const result = renderApp({ clipboard: text });
  fireEvent.click(await screen.findByRole('button', { name: 'From clipboard' }));
  await screen.findByRole('tab', { name: /Pasted document/ });
  return result;
}

describe('workspace modes', () => {
  it('starts empty and explains the available entry points', async () => {
    renderApp();
    expect(await screen.findByText('No document open')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Browse for file' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open a URL' })).toBeInTheDocument();
  });

  it('shows only the editor in Edit Mode', async () => {
    await openFromClipboard();
    expect(screen.getByLabelText('Markdown source editor')).toBeInTheDocument();
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
      expect(screen.getByLabelText('Markdown source editor')).toBeInTheDocument();
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
    const editor = screen.getByLabelText('Markdown source editor');

    fireEvent.change(editor, { target: { value: '# Edited\n\nEdited body\n' } });

    for (const key of ['1', '2', '3', '1', '3', '2']) {
      fireEvent.keyDown(window, { key, ctrlKey: true });
      await waitFor(() => {
        const current = screen.queryByLabelText('Markdown source editor');
        if (current) expect(current).toHaveValue('# Edited\n\nEdited body\n');
      });
    }

    expect(screen.getByLabelText('Markdown source editor')).toHaveValue('# Edited\n\nEdited body\n');
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

    fireEvent.change(screen.getByLabelText('Markdown source editor'), {
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
    fireEvent.change(screen.getByLabelText('Markdown source editor'), {
      target: { value: '# A edited\n' },
    });

    fireEvent.click(tabs[1]!);
    expect(screen.getByLabelText('Markdown source editor')).toHaveValue('# B\n');

    fireEvent.click(tabs[0]!);
    expect(screen.getByLabelText('Markdown source editor')).toHaveValue('# A edited\n');
  });

  it('asks before discarding unsaved changes', async () => {
    const { platform } = renderApp({ clipboard: 'text', confirmResult: false });
    fireEvent.click(await screen.findByRole('button', { name: 'From clipboard' }));
    await screen.findByRole('tab', { name: /Pasted document/ });

    fireEvent.change(screen.getByLabelText('Markdown source editor'), {
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
    expect(screen.getByLabelText('Markdown source editor')).toHaveValue('content');
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

describe('accessibility', () => {
  it('exposes named controls and a tablist', async () => {
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
