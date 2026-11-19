import { useEffect, useRef, useState } from 'react';

import type { RenderOutput } from '../lib/markdownPipeline';
import { createRenderer, type Renderer } from '../lib/renderClient';
import type { DocState, ResourceBase, WorkspaceMode } from '../lib/types';
import type { Platform } from '../platform';

/** Preview is not rendered automatically above this size (§14.3). */
export const AUTO_PREVIEW_LIMIT = 2 * 1024 * 1024;
/** Rich content is disabled above this size. */
export const RICH_CONTENT_LIMIT = 1 * 1024 * 1024;

export function resourceBaseFor(doc: DocState): ResourceBase {
  const origin = doc.origin;
  if (!origin) return { kind: 'none' };

  switch (origin.kind) {
    case 'file':
      return { kind: 'file', dir: origin.dir };
    case 'remote':
      return { kind: 'remote', url: origin.baseUrl };
    case 'pasted':
      return origin.baseDir ? { kind: 'file', dir: origin.baseDir } : { kind: 'none' };
    default:
      return { kind: 'none' };
  }
}

interface RenderState {
  docId: string | null;
  source: string;
  output: RenderOutput | null;
  error: string | null;
}

export interface DocumentRender {
  output: RenderOutput | null;
  error: string | null;
  rendering: boolean;
  /** True when the document is too large to preview automatically. */
  requiresManualRender: boolean;
  renderNow: () => void;
}

/**
 * Renders the active document off the main thread.
 *
 * - Edit Mode does not render at all.
 * - Split Mode debounces typing by 150 ms (500 ms for large documents).
 * - Results are cached per document and dropped when superseded, so a slow
 *   render can never overwrite a newer one or leak into another tab.
 */
export function useDocumentRender(
  doc: DocState | null,
  mode: WorkspaceMode,
  platform: Platform,
  rendererRef: { current: Renderer | null },
): DocumentRender {
  const [state, setState] = useState<RenderState>({
    docId: null,
    source: '',
    output: null,
    error: null,
  });
  const [rendering, setRendering] = useState(false);
  const [manualDocId, setManualDocId] = useState<string | null>(null);
  const cache = useRef(new Map<string, { source: string; output: RenderOutput }>());
  const seq = useRef(0);

  if (rendererRef.current === null) {
    rendererRef.current = createRenderer();
  }

  useEffect(
    () => () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
    },
    [rendererRef],
  );

  const large = (doc?.source.length ?? 0) > AUTO_PREVIEW_LIMIT;
  const requiresManualRender = large && manualDocId !== doc?.id;
  const isPreviewVisible = mode !== 'edit';
  const shouldRender = isPreviewVisible && !requiresManualRender;

  const debounceMs = mode === 'split' ? ((doc?.source.length ?? 0) > 1_000_000 ? 500 : 150) : 0;
  const [debouncedSource, setDebouncedSource] = useState(doc?.source ?? '');

  useEffect(() => {
    if (debounceMs === 0) {
      setDebouncedSource(doc?.source ?? '');
      return undefined;
    }
    const timer = setTimeout(() => setDebouncedSource(doc?.source ?? ''), debounceMs);
    return () => clearTimeout(timer);
  }, [doc?.source, debounceMs]);

  useEffect(() => {
    if (!doc || mode === 'edit' || !shouldRender) return undefined;

    const cached = cache.current.get(doc.id);
    if (cached && cached.source === debouncedSource) {
      setState({ docId: doc.id, source: debouncedSource, output: cached.output, error: null });
      setRendering(false);
      return undefined;
    }

    const id = ++seq.current;
    let cancelled = false;
    setRendering(true);

    const options = {
      base: resourceBaseFor(doc),
      assetOrigin: platform.assetOrigin(),
      disableRichContent: doc.source.length > RICH_CONTENT_LIMIT,
    };

    void rendererRef.current
      ?.render(options, debouncedSource)
      .then((output) => {
        if (cancelled || id !== seq.current) return;
        cache.current.set(doc.id, { source: debouncedSource, output });
        setState({ docId: doc.id, source: debouncedSource, output, error: null });
        setRendering(false);
      })
      .catch((error: unknown) => {
        if (cancelled || id !== seq.current) return;
        setState({
          docId: doc.id,
          source: debouncedSource,
          output: null,
          error: error instanceof Error ? error.message : String(error),
        });
        setRendering(false);
      });

    return () => {
      cancelled = true;
    };
  }, [doc, mode, shouldRender, debouncedSource, platform, rendererRef]);

  // Leaving Edit Mode with a cached result must show it immediately.
  useEffect(() => {
    if (!doc || mode === 'edit') return;
    if (state.docId === doc.id) return;
    const cached = cache.current.get(doc.id);
    if (cached) {
      setState({ docId: doc.id, source: cached.source, output: cached.output, error: null });
    }
  }, [doc, mode, state.docId]);

  return {
    output: state.docId === doc?.id ? state.output : null,
    error: state.docId === doc?.id ? state.error : null,
    rendering,
    requiresManualRender,
    renderNow: () => {
      if (doc) setManualDocId(doc.id);
    },
  };
}
