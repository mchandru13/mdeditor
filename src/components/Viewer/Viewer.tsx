import { forwardRef, useImperativeHandle, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';

import type { HeadingEntry } from '../../lib/types';
import { escapeSelector } from '../../lib/dom';

export interface ViewerHandle {
  scrollToHeading(id: string): void;
  scrollToElement(element: Element | null): void;
  scrollToTop(): void;
  getScrollTop(): number;
  restoreScroll(top: number): void;
}

interface ViewerProps {
  headings: HeadingEntry[];
  onScroll?: (scrollTop: number) => void;
  /** Shared with the owner so scroll-spy and search can read the container. */
  containerRef?: RefObject<HTMLDivElement | null>;
  /** Multiplier for the rendered page; `1` is actual size. Not applied to the
   *  scroll container, so its padding and the Back to top button stay fixed. */
  zoom?: number;
  children: ReactNode;
  empty?: ReactNode;
  error?: string | null;
}

/**
 * Scroll container for rendered Markdown. Owning the scroll element here keeps
 * section navigation, search and synchronized scrolling consistent.
 */
export const Viewer = forwardRef<ViewerHandle, ViewerProps>(function Viewer(
  { headings, onScroll, containerRef: providedRef, children, empty, error, zoom },
  ref,
) {
  const internalRef = useRef<HTMLDivElement | null>(null);
  const containerRef = providedRef ?? internalRef;

  useImperativeHandle(ref, () => ({
    scrollToHeading(id: string) {
      const container = containerRef.current;
      if (!container) return;
      const target = container.querySelector<HTMLElement>(`[id="${escapeSelector(id)}"]`);
      target?.scrollIntoView({ block: 'start', behavior: 'auto' });
    },
    scrollToElement(element: Element | null) {
      if (!element) return;
      (element as HTMLElement).scrollIntoView({ block: 'center', behavior: 'auto' });
    },
    scrollToTop() {
      containerRef.current?.scrollTo({ top: 0, behavior: 'auto' });
    },
    getScrollTop() {
      return containerRef.current?.scrollTop ?? 0;
    },
    restoreScroll(top: number) {
      if (containerRef.current && top > 0) containerRef.current.scrollTop = top;
    },
  }));

  return (
    <div
      className="viewer"
      ref={containerRef}
      onScroll={(event) => onScroll?.((event.target as HTMLDivElement).scrollTop)}
      tabIndex={0}
      role="region"
      aria-label="Rendered document"
    >
      {error ? (
        <div className="viewer-error" role="alert">
          <p>This document could not be rendered.</p>
          <p className="viewer-error-detail">{error}</p>
        </div>
      ) : null}

      {empty ? (
        empty
      ) : (
        <article
          className="markdown-body"
          aria-label="Document preview"
          style={zoom === undefined ? undefined : { zoom }}
        >
          {children}
        </article>
      )}

      {headings.length > 0 ? (
        <button
          type="button"
          className="button ghost back-to-top"
          onClick={() => containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          Back to top
        </button>
      ) : null}
    </div>
  );
});
