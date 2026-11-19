import { useEffect, useRef } from 'react';

interface SearchBarProps {
  query: string;
  caseSensitive: boolean;
  matchCount: number;
  activeIndex: number;
  onQueryChange: (query: string) => void;
  onToggleCase: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
}

/** Application-owned find bar. Escape closes it; Enter moves to the next match. */
export function SearchBar({
  query,
  caseSensitive,
  matchCount,
  activeIndex,
  onQueryChange,
  onToggleCase,
  onNext,
  onPrevious,
  onClose,
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const status =
    query.length === 0
      ? ''
      : matchCount === 0
        ? 'No matches'
        : `${activeIndex + 1} of ${matchCount}`;

  return (
    <div className="searchbar" role="search" aria-label="Search in document">
      <input
        ref={inputRef}
        type="text"
        className="searchbar-input"
        value={query}
        placeholder="Find in document"
        aria-label="Search text"
        aria-describedby="search-status"
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            if (event.shiftKey) onPrevious();
            else onNext();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          }
        }}
      />

      <button
        type="button"
        className={caseSensitive ? 'button ghost small active' : 'button ghost small'}
        aria-pressed={caseSensitive}
        onClick={onToggleCase}
        title="Match case"
      >
        Aa
      </button>

      <span id="search-status" className="searchbar-status" role="status" aria-live="polite">
        {status}
      </span>

      <button type="button" className="button ghost small" onClick={onPrevious} aria-label="Previous match">
        ↑
      </button>
      <button type="button" className="button ghost small" onClick={onNext} aria-label="Next match">
        ↓
      </button>
      <button type="button" className="button ghost small" onClick={onClose} aria-label="Close search">
        ×
      </button>
    </div>
  );
}
