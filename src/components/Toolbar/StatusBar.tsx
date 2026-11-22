import type { DocState, DocumentStats, WorkspaceMode } from '../../lib/types';
import { canZoomIn, canZoomOut, formatZoom } from '../../lib/zoom';
import { isDirty } from '../../state/documents';

interface StatusBarProps {
  doc: DocState | null;
  stats: DocumentStats | null;
  mode: WorkspaceMode;
  rendering: boolean;
  zoom: number;
  /** False with no document open, and in Edit mode where there is no preview. */
  zoomEnabled: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
}

export function StatusBar({
  doc,
  stats,
  mode,
  rendering,
  zoom,
  zoomEnabled,
  onZoomIn,
  onZoomOut,
  onZoomReset,
}: StatusBarProps) {
  // Deliberately not a live region: it now holds interactive controls, and the
  // statistics change on every keystroke, so announcing the whole bar would be
  // noise. Transient messages use the `.notice` banner, which is announced.
  return (
    <div className="statusbar">
      <span className="statusbar-item">
        {doc ? (isDirty(doc) ? 'Modified' : 'Saved') : 'No document'}
      </span>

      {doc?.origin?.kind === 'file' ? (
        <span className="statusbar-item statusbar-path" title={doc.origin.path}>
          {doc.origin.path}
        </span>
      ) : null}

      {doc?.origin?.kind === 'remote' ? (
        <span className="statusbar-item statusbar-path" title={doc.origin.finalUrl}>
          {doc.origin.finalUrl}
        </span>
      ) : null}

      <span className="statusbar-item">
        {doc ? `${doc.encoding.eol === '\r\n' ? 'CRLF' : 'LF'}${doc.encoding.bom ? ' · BOM' : ''}` : ''}
      </span>

      <span className="statusbar-spacer" />

      {rendering ? <span className="statusbar-item">Rendering…</span> : null}
      {stats ? (
        <>
          <span className="statusbar-item">{stats.words} words</span>
          <span className="statusbar-item">{stats.characters} characters</span>
          <span className="statusbar-item">{stats.readingMinutes} min read</span>
        </>
      ) : null}
      <span className="statusbar-item statusbar-mode">{mode} mode</span>

      {/* Zoom lives here, not in the toolbar: the toolbar row has no room left at
          the default window width, and this is where Word and PDF readers put it. */}
      <div className="zoom-group" role="group" aria-label="Zoom">
        <button
          type="button"
          className="button ghost small"
          onClick={onZoomOut}
          disabled={!zoomEnabled || !canZoomOut(zoom)}
          aria-label="Zoom out"
          title="Zoom out (Ctrl+-)"
        >
          −
        </button>
        <button
          type="button"
          className="button ghost small zoom-value"
          onClick={onZoomReset}
          disabled={!zoomEnabled}
          aria-label={`Zoom ${formatZoom(zoom)}; reset to 100%`}
          title="Reset zoom to 100% (Ctrl+0)"
        >
          {formatZoom(zoom)}
        </button>
        <button
          type="button"
          className="button ghost small"
          onClick={onZoomIn}
          disabled={!zoomEnabled || !canZoomIn(zoom)}
          aria-label="Zoom in"
          title="Zoom in (Ctrl++)"
        >
          +
        </button>
      </div>
    </div>
  );
}
