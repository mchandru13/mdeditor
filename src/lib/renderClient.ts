/**
 * Main-thread facade over the Markdown worker.
 *
 * The worker owns parsing and sanitization. Results are identified by a
 * monotonically increasing id so that a slow render can never overwrite a newer
 * one — this is what keeps typing responsive in Split Mode.
 *
 * If the worker cannot start or crashes (module-level failure, CSP block), the
 * renderer transparently degrades to rendering on the main thread. A dead
 * worker must never leave the preview stuck on "Rendering…".
 */

import { renderMarkdown, type RenderOutput } from './markdownPipeline';
import type { RenderRequest, RenderResponse } from './markdownWorker';
import type { RenderOptions } from './types';

export interface Renderer {
  render(options: RenderOptions, source: string): Promise<RenderOutput>;
  dispose(): void;
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

  const inline = createInlineRenderer();
  let degraded = false;
  let nextId = 1;
  const pending = new Map<
    number,
    {
      request: RenderRequest;
      resolve: (value: RenderOutput) => void;
      reject: (error: Error) => void;
    }
  >();

  const settleInline = (id: number, request: RenderRequest) => {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);

    void inline.render(request.options, request.source).then(entry.resolve, (error: unknown) =>
      entry.reject(error instanceof Error ? error : new Error(String(error))),
    );
  };

  /** Re-runs everything still in flight on the main thread. */
  const degrade = () => {
    if (degraded) return;
    degraded = true;
    worker.terminate();
    for (const [id, entry] of [...pending]) {
      settleInline(id, entry.request);
    }
  };

  const onMessage = (event: MessageEvent<RenderResponse>) => {
    const message = event.data;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);

    if (message.ok) entry.resolve(message.result);
    else entry.reject(new Error(message.error));
  };

  worker.addEventListener('message', onMessage);
  worker.addEventListener('error', degrade);
  worker.addEventListener('messageerror', degrade);

  return {
    render(options, source) {
      if (degraded) return inline.render(options, source);

      const id = nextId++;
      const request: RenderRequest = { id, source, options };

      return new Promise<RenderOutput>((resolve, reject) => {
        pending.set(id, { request, resolve, reject });
        try {
          worker.postMessage(request);
        } catch {
          degrade();
        }
      });
    },
    dispose() {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', degrade);
      worker.removeEventListener('messageerror', degrade);
      worker.terminate();
      pending.clear();
    },
  };
}
