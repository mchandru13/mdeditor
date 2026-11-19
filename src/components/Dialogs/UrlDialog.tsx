import { useEffect, useId, useRef, useState } from 'react';

interface UrlDialogProps {
  onCancel: () => void;
  onOpen: (url: string) => void;
  error?: string | null;
  busy?: boolean;
}

/** Modal for the explicit remote-document entry point. HTTPS only. */
export function UrlDialog({ onCancel, onOpen, error, busy }: UrlDialogProps) {
  const [value, setValue] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    inputRef.current?.focus();
    const previous = document.activeElement as HTMLElement | null;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button, input, [href], select, textarea, [tabindex]:not([tabindex="-1"])',
      );
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
  }, [onCancel]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();

    if (!trimmed) {
      setLocalError('Enter a URL.');
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      setLocalError('That is not a valid URL.');
      return;
    }

    if (parsed.protocol !== 'https:') {
      setLocalError('Only HTTPS URLs are supported.');
      return;
    }

    setLocalError(null);
    onOpen(trimmed);
  };

  return (
    <div className="modal-backdrop" data-modal-open="true">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={dialogRef}
      >
        <h2 id={titleId}>Open Markdown from URL</h2>
        <p className="modal-hint">Remote documents are fetched once, over HTTPS, and never auto-refreshed.</p>

        <form onSubmit={submit}>
          <label className="field-label" htmlFor="url-input">
            HTTPS URL
          </label>
          <input
            id="url-input"
            ref={inputRef}
            className="text-input"
            type="url"
            inputMode="url"
            placeholder="https://example.com/README.md"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />

          {localError ?? error ? (
            <p className="field-error" role="alert">
              {localError ?? error}
            </p>
          ) : null}

          <div className="modal-actions">
            <button type="button" className="button ghost" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="button primary" disabled={busy}>
              {busy ? 'Opening…' : 'Open'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
