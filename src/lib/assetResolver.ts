/** Resolves document-relative resources without touching the filesystem. */

import type { ResourceBase } from './types';

const ABSOLUTE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

export function isAbsoluteLike(url: string): boolean {
  return ABSOLUTE.test(url) || url.startsWith('//') || url.startsWith('#');
}

/**
 * Builds the URL Tauri's asset protocol serves for an absolute local path.
 * Matches `convertFileSrc` from `@tauri-apps/api/core`:
 * `http://asset.localhost/<encodeURIComponent(path)>`.
 */
export function assetUrlFor(path: string, assetOrigin: string): string {
  const normalised = path.replace(/\\/g, '/');
  return `${assetOrigin.replace(/\/+$/, '')}/${encodeURIComponent(normalised)}`;
}

function isInside(baseDir: string, candidate: string): boolean {
  const base = baseDir.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const target = candidate.replace(/\\/g, '/').toLowerCase();
  return target === base || target.startsWith(`${base}/`);
}

/** Joins a relative path onto a directory, collapsing `..` segments. */
export function joinPath(dir: string, relative: string): string {
  const separator = dir.includes('\\') ? '\\' : '/';
  const parts = dir.replace(/\\/g, '/').split('/');
  const stack = parts.filter((part) => part.length > 0);

  for (const segment of relative.replace(/\\/g, '/').split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      stack.pop();
      continue;
    }
    stack.push(segment);
  }

  const joined = stack.join('/');
  return dir.startsWith('/') ? `/${joined}` : joined.replace(/\//g, separator);
}

export interface ResolvedResource {
  url: string;
  /** True when the URL points at a local file served through the asset protocol. */
  local: boolean;
  /** True when the resource could not be resolved (pasted content, traversal). */
  unresolved: boolean;
}

export function resolveResource(
  raw: string,
  base: ResourceBase,
  assetOrigin: string | null,
): ResolvedResource {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { url: trimmed, local: false, unresolved: true };
  }

  if (trimmed.startsWith('#')) {
    return { url: trimmed, local: false, unresolved: false };
  }

  if (ABSOLUTE.test(trimmed) || trimmed.startsWith('//')) {
    // Absolute URL or scheme. Local file: URLs stay unresolved by design.
    const scheme = trimmed.split(':')[0]?.toLowerCase() ?? '';
    return { url: trimmed, local: false, unresolved: scheme === 'file' };
  }

  if (base.kind === 'remote') {
    try {
      return { url: new URL(trimmed, base.url).toString(), local: false, unresolved: false };
    } catch {
      return { url: trimmed, local: false, unresolved: true };
    }
  }

  if (base.kind === 'file' && assetOrigin) {
    const absolute = joinPath(base.dir, trimmed);
    if (!isInside(base.dir, absolute)) {
      return { url: trimmed, local: false, unresolved: true };
    }
    return { url: assetUrlFor(absolute, assetOrigin), local: true, unresolved: false };
  }

  return { url: trimmed, local: false, unresolved: true };
}
