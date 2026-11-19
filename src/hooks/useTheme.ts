import { useEffect, useState } from 'react';

import type { ThemeMode } from '../state/session';

export type ResolvedTheme = 'light' | 'dark';

function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Applies the theme to `<html data-theme>` and follows OS changes in System
 * mode. Tokens are defined per theme in `styles/tokens.css`.
 */
export function useTheme(mode: ThemeMode): ResolvedTheme {
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;

    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystem(query.matches ? 'dark' : 'light');

    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    }

    return undefined;
  }, []);

  const resolved: ResolvedTheme = mode === 'system' ? system : mode;

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
  }, [resolved]);

  return resolved;
}
