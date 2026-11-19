import { Suspense, forwardRef, lazy } from 'react';

import type { EditorHandle, EditorProps } from './Editor';

/**
 * CodeMirror is the largest dependency in the main bundle and Read Mode never
 * needs it, so the editor is loaded on demand. The ref is forwarded to the real
 * component, which keeps the imperative handle API unchanged.
 */
const EditorImpl = lazy(async () => {
  const module = await import('./Editor');
  return { default: module.Editor };
});

export type { EditorHandle };

export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(props, ref) {
  return (
    <Suspense
      fallback={
        <div className="editor-loading" role="status">
          Loading editor…
        </div>
      }
    >
      <EditorImpl {...props} ref={ref} />
    </Suspense>
  );
});
