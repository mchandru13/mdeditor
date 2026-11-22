import { describe, expect, it } from 'vitest';

import {
  canZoomIn,
  canZoomOut,
  clampZoom,
  DEFAULT_ZOOM,
  formatZoom,
  MAX_ZOOM,
  MIN_ZOOM,
  stepZoom,
  ZOOM_LEVELS,
} from '../../src/lib/zoom';

describe('zoom ladder', () => {
  it('is exactly the documented ladder', () => {
    // Pinned, not just ordered: changing 0.67 to 0.68 would silently change the
    // documented steps while every other test still passed.
    expect(ZOOM_LEVELS).toEqual([0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]);
  });

  it('starts at actual size', () => {
    expect(DEFAULT_ZOOM).toBe(1);
    expect(ZOOM_LEVELS).toContain(DEFAULT_ZOOM);
  });
});

describe('stepping', () => {
  it('steps to the adjacent level', () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1, -1)).toBe(0.9);
  });

  it('stops at the limits instead of going past them', () => {
    expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(stepZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
  });

  it('steps from a level that is not on the ladder', () => {
    // A hand-edited settings file or one written by an older build. Rounding to
    // the nearest entry would undo a zoom-out; the next entry in the direction
    // of travel is what the user asked for.
    expect(stepZoom(0.67, 1)).toBe(0.75);
    expect(stepZoom(0.67, -1)).toBe(0.5);
    expect(stepZoom(1.05, 1)).toBe(1.1);
    expect(stepZoom(1.05, -1)).toBe(1);
    expect(stepZoom(1.9, 1)).toBe(2);
    expect(stepZoom(1.9, -1)).toBe(1.75);
    expect(stepZoom(0.6, -1)).toBe(0.5);
  });

  it('walks the whole ladder in both directions', () => {
    let level = MIN_ZOOM;
    const up = [level];
    while (level < MAX_ZOOM) {
      const next = stepZoom(level, 1);
      expect(next).toBeGreaterThan(level);
      level = next;
      up.push(level);
    }
    expect(up).toEqual([...ZOOM_LEVELS]);

    const down: number[] = [];
    while (level > MIN_ZOOM) {
      level = stepZoom(level, -1);
      down.push(level);
    }
    expect(down).toEqual([...ZOOM_LEVELS].reverse().slice(1));
  });

  it('treats a non-finite level as actual size', () => {
    expect(stepZoom(Number.NaN, 1)).toBe(1.1);
  });
});

describe('clamping', () => {
  it('keeps supported values as they are', () => {
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(1.25)).toBe(1.25);
  });

  it('clamps to the supported range', () => {
    expect(clampZoom(99)).toBe(MAX_ZOOM);
    expect(clampZoom(0.01)).toBe(MIN_ZOOM);
    expect(clampZoom(-3)).toBe(MIN_ZOOM);
  });

  it('falls back to actual size for a non-finite value', () => {
    expect(clampZoom(Number.NaN)).toBe(DEFAULT_ZOOM);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(DEFAULT_ZOOM);
  });
});

describe('display', () => {
  it('rounds to whole percentages', () => {
    expect(formatZoom(1)).toBe('100%');
    expect(formatZoom(0.67)).toBe('67%');
    expect(formatZoom(1.25)).toBe('125%');
    expect(formatZoom(2)).toBe('200%');
  });

  it('formats a stored value outside the range as the clamped one', () => {
    expect(formatZoom(12)).toBe('200%');
  });

  it('disables the step buttons at the limits', () => {
    expect(canZoomIn(MAX_ZOOM)).toBe(false);
    expect(canZoomOut(MIN_ZOOM)).toBe(false);
    expect(canZoomIn(1)).toBe(true);
    expect(canZoomOut(1)).toBe(true);
  });
});
