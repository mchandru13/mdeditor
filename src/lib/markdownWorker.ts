import { renderMarkdown, type RenderOutput } from './markdownPipeline';
import type { RenderOptions } from './types';

export interface RenderRequest {
  id: number;
  source: string;
  options: RenderOptions;
}

export type RenderResponse =
  | { id: number; ok: true; result: RenderOutput }
  | { id: number; ok: false; error: string };

interface WorkerScope {
  onmessage: ((event: MessageEvent<RenderRequest>) => void) | null;
  postMessage(message: RenderResponse): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const { id, source, options } = event.data;

  try {
    const result = renderMarkdown(source, options);
    scope.postMessage({ id, ok: true, result });
  } catch (error) {
    scope.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
