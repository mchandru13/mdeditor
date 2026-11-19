import { useEffect, useState } from 'react';
import type { RefObject } from 'react';

import type { HeadingEntry } from '../lib/types';
import { escapeSelector } from '../lib/dom';

export interface HeadingOffset {
  id: string;
  top: number;
}

/** Pure selection rule, exported so it can be tested without layout. */
export function pickActiveHeading(
  offsets: HeadingOffset[],
  scrollTop: number,
  activationOffset = 24,
): string | null {
  let active: string | null = null;

  for (const entry of offsets) {
    if (entry.top - activationOffset <= scrollTop) active = entry.id;
    else break;
  }

  return active ?? offsets[0]?.id ?? null;
}

/**
 * Tracks which heading is currently in view inside a scroll container.
 * Uses a rAF-throttled scroll listener rather than observers so that it works
 * in both WebView2 and jsdom, and stays cheap for large documents.
 */
export function useScrollSpy(
  containerRef: RefObject<HTMLElement | null>,
  headings: HeadingEntry[],
  enabled: boolean,
): string | null {
  const [activeId, setActiveId] = useState<string | null>(headings[0]?.id ?? null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) {
      setActiveId(headings[0]?.id ?? null);
      return undefined;
    }

    let frame = 0;

    const measure = () => {
      frame = 0;
      const containerTop = container.getBoundingClientRect().top;
      const offsets: HeadingOffset[] = [];

      for (const heading of headings) {
        const element = container.querySelector<HTMLElement>(`[id="${escapeSelector(heading.id)}"]`);
        if (!element) continue;
        offsets.push({ id: heading.id, top: element.getBoundingClientRect().top - containerTop });
      }

      setActiveId(pickActiveHeading(offsets, container.scrollTop));
    };

    const onScroll = () => {
      if (frame === 0) frame = window.requestAnimationFrame(measure);
    };

    measure();
    container.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);

    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      container.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [containerRef, headings, enabled]);

  return activeId;
}
