import { useEffect, useId, useRef, useState } from 'react';

import {
  MAX_COMMENT_BYTES,
  MAX_COMMENT_HEADER_CHARS,
  formatCommentBlock,
  validateComment,
} from '../../lib/comments';

interface CommentDialogProps {
  onCancel: () => void;
  onSubmit: (comment: { header: string; body: string }) => void;
  /** Where the comment will be attached, shown so the target is unambiguous. */
  target: string;
}

/**
 * Modal for adding a comment. Mirrors `UrlDialog`'s focus trap and Escape
 * handling so the two dialogs cannot drift apart.
 */
export function CommentDialog({ onCancel, onSubmit, target }: CommentDialogProps) {
  const [header, setHeader] = useState('');
  const [body, setBody] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  // Kept in a ref so a re-render of App cannot re-run the focus effect below.
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  const titleId = useId();
  const hintId = useId();

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    bodyRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button, input, textarea, [href], select, [tabindex]:not([tabindex="-1"])',
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
  }, []);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const problem = validateComment(header, body);
    if (problem) {
      setLocalError(problem);
      return;
    }
    setLocalError(null);
    onSubmit({ header: header.trim(), body: body.replace(/\s+$/, '') });
  };

  const storedBytes = new TextEncoder().encode(formatCommentBlock(header, body)).length;

  return (
    <div className="modal-backdrop" data-modal-open="true">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={hintId}
        ref={dialogRef}
      >
        <h2 id={titleId}>Add comment</h2>
        <p className="modal-hint" id={hintId}>
          The comment is written into the document as a Markdown blockquote, so it
          travels with the file and any assistant reading it sees your note next to
          the text it refers to.
        </p>
        <p className="modal-target" title={target}>
          Attached after: {target}
        </p>

        <form onSubmit={submit}>
          <label className="field-label" htmlFor="comment-header">
            Author or date (optional)
          </label>
          <input
            id="comment-header"
            className="text-input"
            type="text"
            maxLength={MAX_COMMENT_HEADER_CHARS}
            placeholder="chand 2026-11-21"
            value={header}
            onChange={(event) => setHeader(event.target.value)}
          />

          <label className="field-label" htmlFor="comment-body">
            Comment
          </label>
          <textarea
            id="comment-body"
            ref={bodyRef}
            className="text-input text-area"
            rows={5}
            placeholder="What should change, or what are you unsure about?"
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
          <p className="field-counter">
            {(storedBytes / 1024).toFixed(1)} / {(MAX_COMMENT_BYTES / 1024).toFixed(0)} KB
          </p>

          {localError ? (
            <p className="field-error" role="alert">
              {localError}
            </p>
          ) : null}

          <div className="modal-actions">
            <button type="button" className="button ghost" onClick={() => cancelRef.current()}>
              Cancel
            </button>
            <button type="submit" className="button primary">
              Add comment
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
