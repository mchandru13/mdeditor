import type { ThemeMode } from '../../state/session';

interface ToolbarProps {
  hasDocument: boolean;
  saving: boolean;
  tocVisible: boolean;
  syncScroll: boolean;
  theme: ThemeMode;
  onNew: () => void;
  onOpen: () => void;
  onOpenUrl: () => void;
  onPasteNew: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onExportHtml: () => void;
  onCopyHtml: () => void;
  onPrint: () => void;
  onToggleToc: () => void;
  onToggleSyncScroll: () => void;
  onThemeChange: (theme: ThemeMode) => void;
}

export function Toolbar({
  hasDocument,
  saving,
  tocVisible,
  syncScroll,
  theme,
  onNew,
  onOpen,
  onOpenUrl,
  onPasteNew,
  onSave,
  onSaveAs,
  onExportHtml,
  onCopyHtml,
  onPrint,
  onToggleToc,
  onToggleSyncScroll,
  onThemeChange,
}: ToolbarProps) {
  return (
    <div className="toolbar" role="toolbar" aria-label="Document actions">
      <div className="toolbar-group">
        <button type="button" className="button" onClick={onNew} title="Ctrl+N">
          New
        </button>
        <button type="button" className="button" onClick={onOpen} title="Ctrl+O">
          Open
        </button>
        <button type="button" className="button" onClick={onOpenUrl}>
          Open URL
        </button>
        <button type="button" className="button" onClick={onPasteNew}>
          From clipboard
        </button>
      </div>

      <div className="toolbar-group">
        <button type="button" className="button" onClick={onSave} disabled={!hasDocument || saving} title="Ctrl+S">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          className="button"
          onClick={onSaveAs}
          disabled={!hasDocument || saving}
          title="Ctrl+Shift+S"
        >
          Save as
        </button>
      </div>

      <div className="toolbar-group">
        <button
          type="button"
          className="button"
          onClick={onPrint}
          disabled={!hasDocument}
          // The menu calls this "Print / Export PDF…"; a toolbar button needs a
          // short label, so the full name goes in the tooltip, like Ctrl+S above.
          title="Print / Export PDF (Ctrl+P)"
        >
          Print
        </button>
        <button type="button" className="button" onClick={onExportHtml} disabled={!hasDocument}>
          Export HTML
        </button>
        <button type="button" className="button" onClick={onCopyHtml} disabled={!hasDocument}>
          Copy HTML
        </button>
      </div>

      <div className="toolbar-spacer" />

      <div className="toolbar-group">
        <button
          type="button"
          className="button ghost"
          aria-pressed={tocVisible}
          onClick={onToggleToc}
        >
          Contents
        </button>
        <button
          type="button"
          className="button ghost"
          aria-pressed={syncScroll}
          onClick={onToggleSyncScroll}
        >
          Sync scroll
        </button>
        <label className="theme-select">
          <span className="visually-hidden">Theme</span>
          <select
            value={theme}
            onChange={(event) => onThemeChange(event.target.value as ThemeMode)}
            aria-label="Theme"
          >
            <option value="system">System theme</option>
            <option value="light">Light theme</option>
            <option value="dark">Dark theme</option>
          </select>
        </label>
      </div>
    </div>
  );
}
