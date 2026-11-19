import type { DocId, DocState } from '../../lib/types';
import { isDirty } from '../../state/documents';

interface DocumentTabsProps {
  docs: DocState[];
  activeId: DocId | null;
  onSelect: (id: DocId) => void;
  onClose: (id: DocId) => void;
}

/** ARIA tablist with roving tabindex and per-tab modified indicators. */
export function DocumentTabs({ docs, activeId, onSelect, onClose }: DocumentTabsProps) {
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (docs.length === 0) return;
    const index = docs.findIndex((doc) => doc.id === activeId);
    if (index < 0) return;

    let nextIndex = index;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % docs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + docs.length) % docs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = docs.length - 1;
    else return;

    event.preventDefault();
    const next = docs[nextIndex];
    if (next) onSelect(next.id);
    document.getElementById(`tab-${next?.id ?? ''}`)?.focus();
  };

  return (
    <div className="tabbar" role="tablist" aria-label="Open documents" tabIndex={-1} onKeyDown={onKeyDown}>
      {docs.map((doc) => {
        const active = doc.id === activeId;
        const dirty = isDirty(doc);

        return (
          <div
            key={doc.id}
            id={`tab-${doc.id}`}
            role="tab"
            aria-selected={active}
            aria-controls="workspace"
            tabIndex={active ? 0 : -1}
            className={active ? 'tab active' : 'tab'}
            onClick={() => onSelect(doc.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect(doc.id);
              }
            }}
          >
            <span className="tab-title">{doc.title}</span>
            {dirty ? (
              <span className="tab-dirty" aria-label="Unsaved changes" title="Unsaved changes">
                ●
              </span>
            ) : null}
            <button
              type="button"
              className="tab-close"
              aria-label={`Close ${doc.title}`}
              onClick={(event) => {
                event.stopPropagation();
                onClose(doc.id);
              }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
