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
  /** Replace row (Ctrl+H). Hidden for plain find. */
  replaceVisible: boolean;
  replacement: string;
  onReplacementChange: (value: string) => void;
  onReplace: () => void;
  onReplaceAll: () => void;
  replaceDisabled: boolean;
}

/** Application-owned find and replace. Escape closes it; Enter moves to the
 * next match. Replacement only applies to the source, so it is disabled in
 * Read Mode. */
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
  replaceVisible,
  replacement,
  onReplacementChange,
  onReplace,
  onReplaceAll,
  replaceDisabled,
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
      <div className="searchbar-row">
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

      {replaceVisible ? (
        <div className="searchbar-row">
          <input
            type="text"
            className="searchbar-input"
            value={replacement}
            placeholder="Replace with"
            aria-label="Replace with"
            disabled={replaceDisabled}
            onChange={(event) => onReplacementChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onReplace();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
              }
            }}
          />
          <button
            type="button"
            className="button ghost small"
            onClick={onReplace}
            disabled={replaceDisabled || matchCount === 0}
          >
            Replace
          </button>
          <button
            type="button"
            className="button ghost small"
            onClick={onReplaceAll}
            disabled={replaceDisabled || matchCount === 0}
          >
            Replace all
          </button>
          {replaceDisabled ? (
            <span className="searchbar-hint">Switch to Edit or Split to replace</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
