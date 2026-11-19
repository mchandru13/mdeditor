import { useEffect, useState } from 'react';

/** Debounces a rapidly changing value. Used for the Split Mode preview. */
export function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    if (delayMs <= 0) {
      setDebounced(value);
      return undefined;
    }

    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
