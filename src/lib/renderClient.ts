/**
 * Main-thread facade over the Markdown worker.
 *
 * The worker owns parsing and sanitization. Results are identified by a
 * monotonically increasing id so that a slow render can never overwrite a newer
 * one — this is what keeps typing responsive in Split Mode.
 */

import { renderMarkdown, type RenderOutput } from './markdownPipeline';
import type { RenderRequest, RenderResponse } from './markdownWorker';
import type { RenderOptions } from './types';

export interface Renderer {
  render(options: RenderOptions, source: string): Promise<RenderOutput>;
  dispose(): void;
}

export function createRenderer(): Renderer {
  if (typeof Worker === 'undefined') {
    return createInlineRenderer();
  }

  let worker: Worker;
  try {
    worker = new Worker(new URL('./markdownWorker.ts', import.meta.url), { type: 'module' });
  } catch {
    return createInlineRenderer();
  }

  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (value: RenderOutput) => void; reject: (error: Error) => void }
  >();

  const onMessage = (event: MessageEvent<RenderResponse>) => {
    const message = event.data;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);

    if (message.ok) entry.resolve(message.result);
    else entry.reject(new Error(message.error));
  };

  worker.addEventListener('message', onMessage);

  return {
    render(options, source) {
      const id = nextId++;
      const request: RenderRequest = { id, source, options };

      return new Promise<RenderOutput>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try {
          worker.postMessage(request);
        } catch (error) {
          pending.delete(id);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
    dispose() {
      worker.removeEventListener('message', onMessage);
      worker.terminate();
      pending.clear();
    },
  };
}

/** Synchronous fallback used by tests and environments without module workers. */
export function createInlineRenderer(): Renderer {
  return {
    render(options, source) {
      try {
        return Promise.resolve(renderMarkdown(source, options));
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },
    dispose() {
      // nothing to release
    },
  };
}
