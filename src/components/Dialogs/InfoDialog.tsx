import { useEffect, useId, useRef } from 'react';

import { version as APP_VERSION } from '../../../package.json';

export type InfoDialogKind = 'shortcuts' | 'about';

const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: 'Ctrl+1 / 2 / 3', action: 'Read, Edit, Split mode' },
  { keys: 'Ctrl++ / Ctrl+-', action: 'Zoom the document in or out' },
  { keys: 'Ctrl+0', action: 'Reset the zoom to 100%' },
  { keys: 'Ctrl+F', action: 'Search in the document' },
  { keys: 'Ctrl+H', action: 'Search and replace' },
  { keys: 'Ctrl+Shift+M', action: 'Add a comment to the selected text' },
  { keys: 'Enter / Shift+Enter', action: 'Next / previous match' },
  { keys: 'Ctrl+S', action: 'Save' },
  { keys: 'Ctrl+Shift+S', action: 'Save As' },
  { keys: 'Ctrl+O', action: 'Open file' },
  { keys: 'Ctrl+W', action: 'Close tab' },
  { keys: 'Ctrl+P', action: 'Print / Export PDF' },
  { keys: 'Escape', action: 'Dismiss search or dialog' },
];

interface InfoDialogProps {
  kind: InfoDialogKind;
  onClose: () => void;
}

/** Keyboard-shortcut reference and About box, reachable from the Help menu. */
export function InfoDialog({ kind, onClose }: InfoDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button, [href]');
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" data-modal-open="true">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={dialogRef}
      >
        <h2 id={titleId}>{kind === 'shortcuts' ? 'Keyboard shortcuts' : 'About Markdown Editor'}</h2>

        {kind === 'shortcuts' ? (
          <table className="shortcut-table">
            <tbody>
              {SHORTCUTS.map((shortcut) => (
                <tr key={shortcut.keys}>
                  <th scope="row">
                    <kbd>{shortcut.keys}</kbd>
                  </th>
                  <td>{shortcut.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <>
            <p>Markdown Editor {APP_VERSION}</p>
            <p className="modal-hint">
              A local-first Markdown viewer and editor built with Tauri, Rust, React and TypeScript.
              Documents are rendered with Unified, sanitized with rehype-sanitize, and nothing leaves
              the machine unless you explicitly open a remote URL.
            </p>
          </>
        )}

        <div className="modal-actions">
          <button type="button" className="button primary" onClick={onClose} ref={closeRef}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
