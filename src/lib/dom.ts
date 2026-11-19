/** Small DOM helpers that behave identically in WebView2 and jsdom. */

export function escapeSelector(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
}

export function scrollContainerTo(container: HTMLElement | null, top: number): void {
  if (!container) return;
  container.scrollTop = Math.max(0, top);
}
