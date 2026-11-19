import type { WorkspaceMode } from '../../lib/types';

const MODES: { id: WorkspaceMode; label: string; hint: string }[] = [
  { id: 'read', label: 'Read', hint: 'Ctrl+1' },
  { id: 'edit', label: 'Edit', hint: 'Ctrl+2' },
  { id: 'split', label: 'Split', hint: 'Ctrl+3' },
];

interface WorkspaceModeSelectorProps {
  mode: WorkspaceMode;
  onChange: (mode: WorkspaceMode) => void;
  disabled?: boolean;
}

/** Segmented control exposed as a radiogroup so screen readers announce the
 * active workspace mode. */
export function WorkspaceModeSelector({ mode, onChange, disabled }: WorkspaceModeSelectorProps) {
  return (
    <div className="mode-selector" role="radiogroup" aria-label="Workspace mode">
      {MODES.map((option) => {
        const selected = option.id === mode;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            className={selected ? 'mode-option selected' : 'mode-option'}
            title={option.hint}
            disabled={disabled}
            onClick={() => onChange(option.id)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
