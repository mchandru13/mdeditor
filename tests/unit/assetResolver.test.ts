import { describe, expect, it, vi } from 'vitest';

import { assetUrlFor, joinPath, resolveResource } from '../../src/lib/assetResolver';

const ORIGIN = 'http://asset.localhost';

describe('assetResolver', () => {
  it('joins relative paths onto the document directory', () => {
    expect(joinPath('C:\\docs\\notes', 'img/a.png')).toBe('C:\\docs\\notes\\img\\a.png');
    expect(joinPath('C:\\docs', '../secret.md')).toBe('C:\\secret.md');
    expect(joinPath('/home/user/notes', 'a/b.png')).toBe('/home/user/notes/a/b.png');
  });

  it('serves local images through the asset protocol', () => {
    const resolved = resolveResource(
      'images/diagram.png',
      { kind: 'file', dir: 'C:\\docs' },
      ORIGIN,
    );

    expect(resolved.local).toBe(true);
    expect(resolved.unresolved).toBe(false);
    expect(resolved.url).toBe(assetUrlFor('C:\\docs\\images/diagram.png', ORIGIN));
    expect(resolved.url.startsWith('http://asset.localhost/')).toBe(true);
  });

  it('refuses to escape the document directory', () => {
    const resolved = resolveResource('../../etc/passwd', { kind: 'file', dir: 'C:\\docs' }, ORIGIN);
    expect(resolved.unresolved).toBe(true);
    expect(resolved.local).toBe(false);
  });

  it('resolves remote relatives against the remote base', () => {
    const resolved = resolveResource(
      'img/logo.png',
      { kind: 'remote', url: 'https://example.com/docs/readme.md' },
      ORIGIN,
    );

    expect(resolved.url).toBe('https://example.com/docs/img/logo.png');
    expect(resolved.local).toBe(false);
  });

  it('keeps unresolved relative paths for pasted content', () => {
    const resolved = resolveResource('img/logo.png', { kind: 'none' }, ORIGIN);
    expect(resolved.unresolved).toBe(true);
    expect(resolved.url).toBe('img/logo.png');
  });

  it('passes absolute URLs through untouched', () => {
    const resolved = resolveResource('https://cdn.example.com/x.png', { kind: 'none' }, null);
    expect(resolved.url).toBe('https://cdn.example.com/x.png');
    expect(resolved.unresolved).toBe(false);
  });

  it('flags file: URLs as unresolved', () => {
    const resolved = resolveResource('file:///C:/secret.png', { kind: 'none' }, ORIGIN);
    expect(resolved.unresolved).toBe(true);
  });

  it('keeps fragment links intact', () => {
    const resolved = resolveResource('#section', { kind: 'file', dir: 'C:\\docs' }, ORIGIN);
    expect(resolved).toEqual({ url: '#section', local: false, unresolved: false });
  });

  it('encodes the asset URL exactly like convertFileSrc', () => {
    const spy = vi.fn();
    spy();
    expect(assetUrlFor('C:\\a b\\c.png', 'http://asset.localhost')).toBe(
      `http://asset.localhost/${encodeURIComponent('C:/a b/c.png')}`,
    );
  });
});
