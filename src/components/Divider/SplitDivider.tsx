/* A resizable splitter is the WAI-ARIA `separator` pattern: focusable, with
 * keyboard support and pointer dragging. The element is a plain div because
 * it is a window splitter, not a control that activates anything. */
/* eslint-disable jsx-a11y/no-noninteractive-element-interactions */

interface SplitDividerProps {
  ratio: number;
  onChange: (ratio: number) => void;
}

const MIN = 0.2;
const MAX = 0.8;

export function SplitDivider({ ratio, onChange }: SplitDividerProps) {
  return (
    <div
      className="divider"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize preview pane"
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={MIN * 100}
      aria-valuemax={MAX * 100}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          onChange(Math.max(MIN, ratio - 0.02));
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          onChange(Math.min(MAX, ratio + 0.02));
        } else if (event.key === 'Home') {
          event.preventDefault();
          onChange(MIN);
        } else if (event.key === 'End') {
          event.preventDefault();
          onChange(MAX);
        }
      }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const container = event.currentTarget.parentElement;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const next = (event.clientX - rect.left) / rect.width;
        onChange(Math.min(MAX, Math.max(MIN, next)));
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
    />
  );
}
