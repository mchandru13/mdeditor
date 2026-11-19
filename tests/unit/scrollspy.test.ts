import { describe, expect, it } from 'vitest';

import { pickActiveHeading } from '../../src/hooks/useScrollSpy';

const offsets = [
  { id: 'a', top: 0 },
  { id: 'b', top: 400 },
  { id: 'c', top: 900 },
];

describe('pickActiveHeading', () => {
  it('returns the first heading at the top of the document', () => {
    expect(pickActiveHeading(offsets, 0)).toBe('a');
  });

  it('activates a heading once it passes the activation offset', () => {
    expect(pickActiveHeading(offsets, 375)).toBe('a');
    expect(pickActiveHeading(offsets, 376)).toBe('b');
    expect(pickActiveHeading(offsets, 950)).toBe('c');
  });

  it('keeps the last heading active at the end of the document', () => {
    expect(pickActiveHeading(offsets, 100000)).toBe('c');
  });

  it('handles empty heading lists', () => {
    expect(pickActiveHeading([], 0)).toBeNull();
  });

  it('handles a document with no heading above the viewport', () => {
    expect(pickActiveHeading([{ id: 'x', top: 500 }], 0)).toBe('x');
  });
});
