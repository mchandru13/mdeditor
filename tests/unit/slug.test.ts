import { describe, expect, it } from 'vitest';

import { createSlugger, slugify } from '../../src/lib/slug';

describe('slugify', () => {
  it('produces GitHub-style slugs', () => {
    expect(slugify('Hello, World!')).toBe('hello-world');
    expect(slugify('  Multiple   spaces  ')).toBe('multiple-spaces');
    expect(slugify('Café déjà vu')).toBe('cafe-deja-vu');
    expect(slugify('Already-slugged')).toBe('already-slugged');
  });

  it('never returns an empty slug', () => {
    expect(slugify('!!!')).toBe('section');
    expect(slugify('')).toBe('section');
  });

  it('creates unique suffixes for duplicate headings', () => {
    const next = createSlugger();
    expect([next('Intro'), next('Intro'), next('Intro')]).toEqual([
      'intro',
      'intro-1',
      'intro-2',
    ]);
  });

  it('is deterministic for the same input order', () => {
    const a = createSlugger();
    const b = createSlugger();
    expect([a('A'), a('B'), a('A')]).toEqual([b('A'), b('B'), b('A')]);
  });
});
