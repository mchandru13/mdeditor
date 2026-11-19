import { describe, expect, it, vi, afterEach } from 'vitest';

import { createInlineRenderer, createRenderer } from '../../src/lib/renderClient';
import type { RenderOptions } from '../../src/lib/types';

const OPTIONS: RenderOptions = {
  base: { kind: 'none' },
  assetOrigin: null,
  disableRichContent: false,
};

const originalWorker = (globalThis as { Worker?: unknown }).Worker;

afterEach(() => {
  (globalThis as { Worker?: unknown }).Worker = originalWorker;
});

/** Minimal stand-in for a module worker that fails at load time, which is what
 * happens when a transitive dependency touches `document` in worker scope. */
class CrashingWorker extends EventTarget {
  postMessage(): void {
    queueMicrotask(() => this.dispatchEvent(new Event('error')));
  }
  terminate(): void {
    return undefined;
  }
}

class SilentWorker extends EventTarget {
  static instances: SilentWorker[] = [];
  messages: unknown[] = [];

  constructor() {
    super();
    SilentWorker.instances.push(this);
  }

  postMessage(message: unknown): void {
    this.messages.push(message);
  }

  terminate(): void {
    return undefined;
  }
}

describe('renderer', () => {
  it('renders inline when workers are unavailable', async () => {
    (globalThis as { Worker?: unknown }).Worker = undefined;

    const renderer = createRenderer();
    const output = await renderer.render(OPTIONS, '# Title\n\ntext\n');

    expect(output.headings[0]?.id).toBe('title');
    renderer.dispose();
  });

  it('falls back to inline rendering when the worker cannot be constructed', async () => {
    (globalThis as { Worker?: unknown }).Worker = class {
      constructor() {
        throw new Error('worker blocked by CSP');
      }
    };

    const renderer = createRenderer();
    const output = await renderer.render(OPTIONS, '## Heading\n');

    expect(output.headings[0]?.text).toBe('Heading');
    renderer.dispose();
  });

  it('still renders when the worker crashes after being asked to render', async () => {
    (globalThis as { Worker?: unknown }).Worker = CrashingWorker;

    const renderer = createRenderer();
    const output = await renderer.render(OPTIONS, '# Recovered\n');

    expect(output.headings[0]?.text).toBe('Recovered');
    renderer.dispose();
  });

  it('resolves results posted by the worker', async () => {
    (globalThis as { Worker?: unknown }).Worker = SilentWorker;

    const renderer = createRenderer();
    const pending = renderer.render(OPTIONS, '# Worker\n');

    const worker = SilentWorker.instances.at(-1);
    expect(worker?.messages).toHaveLength(1);

    const request = worker?.messages[0] as { id: number; source: string; options: RenderOptions };
    const inline = await createInlineRenderer().render(request.options, request.source);
    worker?.dispatchEvent(
      new MessageEvent('message', { data: { id: request.id, ok: true, result: inline } }),
    );

    await expect(pending).resolves.toMatchObject({ headings: [{ text: 'Worker' }] });
    renderer.dispose();
  });

  it('drops results from a superseded request', async () => {
    (globalThis as { Worker?: unknown }).Worker = SilentWorker;
    const renderer = createRenderer();

    const first = renderer.render(OPTIONS, '# One\n');
    const worker = SilentWorker.instances.at(-1);
    const request = worker?.messages[0] as { id: number } | undefined;

    worker?.dispatchEvent(
      new MessageEvent('message', {
        data: { id: request?.id ?? -1, ok: false, error: 'render failed' },
      }),
    );

    await expect(first).rejects.toThrow('render failed');
    expect(worker?.messages).toHaveLength(1);
    renderer.dispose();
  });
});

describe('inline renderer', () => {
  it('surfaces pipeline failures as rejections', async () => {
    const renderer = createInlineRenderer();
    const spy = vi.spyOn(await import('../../src/lib/markdownPipeline'), 'renderMarkdown');
    spy.mockImplementation(() => {
      throw new Error('boom');
    });

    await expect(renderer.render(OPTIONS, 'x')).rejects.toThrow('boom');
    spy.mockRestore();
  });
});
