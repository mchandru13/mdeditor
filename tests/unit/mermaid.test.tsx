import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import { isSafeSvg } from '../../src/lib/svgSafety';

const openExternal = vi.fn(async () => undefined);

vi.mock('../../src/platform/context', () => ({
  usePlatform: () => ({ openExternal }),
}));

const renderMock = vi.fn();

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: (...args: unknown[]): unknown => renderMock(...args),
  },
}));

import { MermaidBlock } from '../../src/components/Mermaid/MermaidBlock';

// jsdom's stub never reports intersection, so the diagram would stay pending.
class ImmediateIntersectionObserver {
  readonly root = null;
  readonly rootMargin = '';
  readonly scrollMargin = '';
  readonly thresholds: readonly number[] = [];

  constructor(private readonly callback: IntersectionObserverCallback) {}

  observe(target: Element): void {
    this.callback(
      [{ isIntersecting: true, target } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

vi.stubGlobal('IntersectionObserver', ImmediateIntersectionObserver);

const DIAGRAM_WITH_LINK = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <g><a xlink:href="https://example.com/docs" target="_blank"><text>docs</text></a></g>
</svg>`;

describe('MermaidBlock links', () => {
  beforeEach(() => {
    openExternal.mockClear();
    renderMock.mockReset();
    renderMock.mockResolvedValue({ svg: DIAGRAM_WITH_LINK });
  });

  it('opens an SVG link through the platform instead of navigating', async () => {
    const { container } = render(<MermaidBlock source="graph TD; A-->B" theme="light" />);

    await waitFor(() => {
      expect(container.querySelector('.mermaid-svg a')).not.toBeNull();
    });

    const anchor = container.querySelector('.mermaid-svg a') as SVGElement;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    anchor.dispatchEvent(event);

    expect(openExternal).toHaveBeenCalledWith('https://example.com/docs');
    // The webview must not follow the anchor itself.
    expect(event.defaultPrevented).toBe(true);
  });

  it('ignores a javascript: link in the rendered SVG', async () => {
    renderMock.mockResolvedValue({
      svg: '<svg><a href="javascript:alert(1)"><text>x</text></a></svg>',
    });

    const { container } = render(<MermaidBlock source="graph TD; A-->B" theme="light" />);

    // Either the guard rejects the whole SVG, or nothing is clickable.
    await waitFor(() => {
      expect(container.querySelector('.mermaid-svg') ?? screen.queryByText(/unsafe markup/i)).not.toBeNull();
    });

    const anchor = container.querySelector('.mermaid-svg a');
    if (anchor) {
      anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('refuses to inject an SVG that fails the safety check', async () => {
    renderMock.mockResolvedValue({ svg: '<svg><script>alert(1)</script></svg>' });

    const { container } = render(<MermaidBlock source="graph TD; A-->B" theme="light" />);

    expect(await screen.findByText(/unsafe markup/i)).toBeInTheDocument();
    expect(container.querySelector('.mermaid-svg')).toBeNull();
  });
});

describe('isSafeSvg', () => {
  it('rejects script elements, embedded contexts and event handlers', () => {
    expect(isSafeSvg('<svg><script>x</script></svg>')).toBe(false);
    expect(isSafeSvg('<svg onload="x()"></svg>')).toBe(false);
    expect(isSafeSvg('<svg><rect onerror="x()"/></svg>')).toBe(false);
    expect(isSafeSvg('<svg><iframe src="https://example.com"></iframe></svg>')).toBe(false);
    expect(isSafeSvg('<svg><foreignObject><iframe srcdoc="x"></iframe></foreignObject></svg>')).toBe(
      false,
    );
  });

  it('rejects javascript: URLs in link and image attributes', () => {
    expect(isSafeSvg('<svg><a href="javascript:alert(1)">x</a></svg>')).toBe(false);
    expect(isSafeSvg('<svg><a xlink:href="javascript:alert(1)">x</a></svg>')).toBe(false);
    expect(isSafeSvg('<svg><image href=" javascript:alert(1)"/></svg>')).toBe(false);
  });

  it('keeps ordinary diagrams, including Mermaid HTML labels and prose', () => {
    expect(isSafeSvg('<svg><rect width="1"/></svg>')).toBe(true);
    // Mermaid flowcharts put labels inside foreignObject; rejecting it would
    // break every normal diagram.
    expect(
      isSafeSvg('<svg><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">label</div></foreignObject></svg>'),
    ).toBe(true);
    expect(isSafeSvg('<svg><text>javascript: the good parts</text></svg>')).toBe(true);
    expect(isSafeSvg('<svg><a xlink:href="https://example.com">x</a></svg>')).toBe(true);
  });
});
