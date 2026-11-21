import { useEffect, useRef, useState } from 'react';

interface ContextMenuProps {
  /** Parent that receives right-clicks; the menu only opens inside it. */
  scope: HTMLElement | null;
  onAddComment: () => void;
}

interface Position {
  x: number;
  y: number;
}

/**
 * Right-click menu for the rendered document.
 *
 * Only offered over a non-empty selection: "Add Comment" annotates the text the
 * user selected, so offering it over arbitrary whitespace would be a button that
 * always answers with "select text first".
 */
export function SelectionContextMenu({ scope, onAddComment }: ContextMenuProps) {
  const [at, setAt] = useState<Position | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!scope) return undefined;

    const onContextMenu = (event: MouseEvent) => {
      const selection = window.getSelection();
      const hasText =
        selection !== null && !selection.isCollapsed && selection.toString().trim().length > 0;
      if (!hasText) return;

      // Let the platform menu appear when the click is not on a text selection.
      event.preventDefault();
      setAt({ x: event.clientX, y: event.clientY });
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
  const top = Math.min(at.y, window.innerHeight - 60);

  return (
    <div
      ref={menuRef}
      className="context-menu"
      role="menu"
      aria-label="Selection actions"
      tabIndex={-1}
      style={{ left, top }}
      // A click anywhere else dismisses; the menu item runs its action first.
      onMouseLeave={() => setAt(null)}
    >
      <button
        type="button"
        role="menuitem"
        className="context-menu-item"
        onClick={() => {
          setAt(null);
          onAddComment();
        }}
      >
        Add Comment…
      </button>
    </div>
  );
}
