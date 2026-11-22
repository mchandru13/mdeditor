/** Document zoom levels for the rendered preview.
 *
 * The ladder is Chromium's, so Ctrl++ steps through the sizes a browser or a PDF
 * reader offers and stops where they do. `zoom` is a multiplier: 1 is actual
 * size. Values are percentages of 15px, which is `.markdown-body`'s base size.
 */

// Capped at 200%, not the browser's 300%: `zoom` scales the available width as
// well as the text, so in Split Mode at the 1024px minimum window a 300% page
// reflows to roughly five characters per line. 200% is the WCAG 1.4.4 target and
// the highest level actually measured to stay readable.
export const ZOOM_LEVELS: readonly number[] = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

export const MIN_ZOOM = ZOOM_LEVELS[0]!;
export const MAX_ZOOM = ZOOM_LEVELS[ZOOM_LEVELS.length - 1]!;
export const DEFAULT_ZOOM = 1;

/** Keeps a stored or computed level inside the supported range.
 *
 * Tolerant by design: settings written by another build, or edited by hand, must
 * not be able to ask for a 0.0001x or 400x document.
 */
export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

/** The next ladder entry in `direction`, or the current value at a limit.
 *
 * A stored value that is not on the ladder (an older build, a hand-edited
 * settings file) steps from where it is: zooming in from 1.05 gives 1.1 rather
 * than jumping back to 1.
 */
export function stepZoom(current: number, direction: -1 | 1): number {
  const from = clampZoom(current);

  if (direction > 0) {
    for (const level of ZOOM_LEVELS) {
      if (level > from) return level;
    }
    return MAX_ZOOM;
  }

  for (let index = ZOOM_LEVELS.length - 1; index >= 0; index -= 1) {
    const level = ZOOM_LEVELS[index]!;
    if (level < from) return level;
  }
  return MIN_ZOOM;
}

/** Rounded for the button label; 0.67 is "67%", not "66.99999%". */
export function formatZoom(zoom: number): string {
  return `${Math.round(clampZoom(zoom) * 100)}%`;
}

export function canZoomIn(zoom: number): boolean {
  return clampZoom(zoom) < MAX_ZOOM;
}

export function canZoomOut(zoom: number): boolean {
  return clampZoom(zoom) > MIN_ZOOM;
}
