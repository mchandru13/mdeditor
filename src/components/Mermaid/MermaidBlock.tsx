import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { usePlatform } from '../../platform/context';
import { isSafeSvg } from '../../lib/svgSafety';

interface MermaidBlockProps {
  source: string;
  theme: 'light' | 'dark';
  /** Disabled by the large-document policy. */
  disabled?: boolean;
}

/**
 * Renders a diagram with Mermaid's own API into a container this component owns.
 * `securityLevel: 'strict'` keeps labels inert; failures show the source plus an
 * error so the document stays readable.
 */
export function MermaidBlock({ source, theme, disabled = false }: MermaidBlockProps) {
  const reactId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<HTMLDivElement | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const platform = usePlatform();

  useEffect(() => {
    const element = containerRef.current;
    if (!element || disabled) return undefined;

    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '400px 0px' },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [disabled]);

  useEffect(() => {
    if (!visible || disabled) return undefined;

    let cancelled = false;
    setError(null);

    void import('mermaid')
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: theme === 'dark' ? 'dark' : 'default',
          fontFamily: 'inherit',
        });

        try {
          const result = await mermaid.render(`mmd-${reactId}`, source);
          if (cancelled) return;
          // The same check the exporter applies: Mermaid's sandbox is the first
          // line of defence, this is the second.
          if (!isSafeSvg(result.svg)) {
            setError('Diagram contained unsafe markup and was not displayed.');
            return;
          }
          setSvg(result.svg);
        } catch (renderError) {
          if (!cancelled) {
            setError(renderError instanceof Error ? renderError.message : String(renderError));
          }
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [visible, source, theme, disabled, reactId]);

  // Mermaid `click` directives produce real anchors inside the SVG, which bypass
  // the link handling used for Markdown links. Delegate on the container so those
  // links open in the system browser; the Rust navigation guard is what prevents
  // the webview itself from leaving the app if anything slips past this.
  //
  // Attached through a ref callback rather than an effect: the SVG is inserted
  // during commit, so an effect leaves a window where the diagram is visible but
  // its links are inert. The callback runs in the same commit that inserts the
  // node, so the two can never be observed apart.
  const onSvgClick = useCallback(
    (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest?.('a');
      if (!anchor) return;
      event.preventDefault();
      const href =
        anchor.getAttribute('href') ??
        anchor.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
      if (href && /^(https?:|mailto:)/i.test(href)) {
        void platform.openExternal(href);
      }
    },
    [platform],
  );

  const attachSvg = useCallback(
    (node: HTMLDivElement | null) => {
      if (svgRef.current && svgRef.current !== node) {
        svgRef.current.removeEventListener('click', onSvgClick);
      }
      svgRef.current = node;
      if (node) node.addEventListener('click', onSvgClick);
    },
    [onSvgClick],
  );

  useEffect(
    () => () => {
      svgRef.current?.removeEventListener('click', onSvgClick);
    },
    [onSvgClick],
  );

  if (disabled) {
    return (
      <div className="mermaid-disabled" role="note">
        <p>Diagrams are disabled for large documents.</p>
        <pre>{source}</pre>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mermaid-error" role="note">
        <p>Could not render this diagram.</p>
        <pre>{source}</pre>
        <p className="mermaid-error-detail">{error}</p>
      </div>
    );
  }

  return (
    <div className="mermaid-block" ref={containerRef}>
      {svg ? (
        <div className="mermaid-svg" ref={attachSvg} dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <p className="mermaid-pending">Rendering diagram…</p>
      )}
    </div>
  );
}
