import type { HeadingEntry } from '../../lib/types';

interface TocProps {
  headings: HeadingEntry[];
  activeId: string | null;
  onNavigate: (id: string) => void;
}

/** Collapsible table of contents with depth styling and current-section state. */
export function Toc({ headings, activeId, onNavigate }: TocProps) {
  return (
    <nav className="toc" aria-label="Table of contents">
      <h2 className="toc-title">Contents</h2>
      {headings.length === 0 ? (
        <p className="toc-empty">No headings in this document.</p>
      ) : (
        <ul className="toc-list">
          {headings.map((heading) => (
            <li
              key={heading.id}
              className="toc-item"
              data-depth={heading.depth}
              style={{ paddingInlineStart: `${(heading.depth - 1) * 12}px` }}
            >
              <a
                href={`#${heading.id}`}
                className={heading.id === activeId ? 'toc-link active' : 'toc-link'}
                aria-current={heading.id === activeId ? 'location' : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  onNavigate(heading.id);
                }}
              >
                {heading.text}
              </a>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
