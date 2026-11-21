import { useEffect, useState } from 'react';

interface ContextMenuProps {
  /** Parent that receives right-clicks; the menu only opens inside it. */
  scope: HTMLElement | null;
  onAddComment: () => void;
  /** Called with the rendered comment's index when one is right-clicked. */
  onEditComment: (index: number) => void;
  onRemoveComment: (index: number) => void;
}

interface Target {
  x: number;
  y: number;
  /** Index of the right-clicked comment among rendered comments, or null. */
  comment: number | null;
}

const COMMENT_SELECTOR = '.mdeditor-comment';

/**
 * Right-click menu for the rendered document.
 *
 * Two shapes, because they act on different things:
 * - over a rendered comment, Edit and Remove act on *that* comment;
 * - over a text selection elsewhere, Add Comment annotates it.
 *
 * A comment is identified by its position among `.mdeditor-comment` elements,
 * which is the same order `scanComments` reports from the source. Clicking
 * anywhere else offers nothing rather than a command that would only answer
 * "select text first".
 */
export function SelectionContextMenu({
  scope,
  onAddComment,
  onEditComment,
  onRemoveComment,
}: ContextMenuProps) {
  const [at, setAt] = useState<Target | null>(null);

  useEffect(() => {
    if (!scope) return undefined;

    const onContextMenu = (event: MouseEvent) => {
      const position = { x: event.clientX, y: event.clientY };

      // A right-click inside a rendered comment acts on that comment.
      const node = event.target instanceof Element ? event.target : null;
      const block = node?.closest(COMMENT_SELECTOR);
      if (block) {
        const all = [...document.querySelectorAll(COMMENT_SELECTOR)];
        const index = all.indexOf(block);
        if (index !== -1) {
          event.preventDefault();
          setAt({ ...position, comment: index });
          return;
        }
      }

      const selection = window.getSelection();
      const hasText =
        selection !== null && !selection.isCollapsed && selection.toString().trim().length > 0;
      if (!hasText) return;

      // Let the platform menu appear otherwise.
      event.preventDefault();
      setAt({ ...position, comment: null });
    };

    const dismiss = () => setAt(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };

    scope.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', dismiss);
    return () => {
      scope.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', dismiss);
    };
  }, [scope]);

  if (!at) return null;

  // Keep the menu on screen when the click is near an edge.
  const left = Math.min(at.x, window.innerWidth - 200);
  const top = Math.min(at.y, window.innerHeight - 90);
  const run = (action: () => void) => {
    setAt(null);
    action();
  };

  return (
    <div
      className="context-menu"
      role="menu"
      aria-label="Selection actions"
      tabIndex={-1}
      style={{ left, top }}
      onMouseLeave={() => setAt(null)}
    >
      {at.comment === null ? (
        <button
          type="button"
          role="menuitem"
          className="context-menu-item"
          onClick={() => run(onAddComment)}
        >
          Add Comment…
        </button>
      ) : (
        <>
          <button
            type="button"
            role="menuitem"
            className="context-menu-item"
            onClick={() => run(() => onEditComment(at.comment!))}
          >
            Edit Comment…
          </button>
          <button
            type="button"
            role="menuitem"
            className="context-menu-item"
            onClick={() => run(() => onRemoveComment(at.comment!))}
          >
            Remove Comment
          </button>
        </>
      )}
    </div>
  );
}
