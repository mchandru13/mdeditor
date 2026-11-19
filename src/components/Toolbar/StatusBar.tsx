import type { DocState, DocumentStats, WorkspaceMode } from '../../lib/types';
import { isDirty } from '../../state/documents';

interface StatusBarProps {
  doc: DocState | null;
  stats: DocumentStats | null;
  mode: WorkspaceMode;
  rendering: boolean;
  message?: string | null;
}

export function StatusBar({ doc, stats, mode, rendering, message }: StatusBarProps) {
  return (
    <div className="statusbar" role="status" aria-live="polite">
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
      {message ? <span className="statusbar-item statusbar-message">{message}</span> : null}
      {stats ? (
        <>
          <span className="statusbar-item">{stats.words} words</span>
          <span className="statusbar-item">{stats.characters} characters</span>
          <span className="statusbar-item">{stats.readingMinutes} min read</span>
        </>
      ) : null}
      <span className="statusbar-item statusbar-mode">{mode} mode</span>
    </div>
  );
}
