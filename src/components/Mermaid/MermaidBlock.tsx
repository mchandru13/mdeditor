import { useEffect, useId, useRef, useState } from 'react';

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
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

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
          if (!cancelled) setSvg(result.svg);
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
        <div className="mermaid-svg" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <p className="mermaid-pending">Rendering diagram…</p>
      )}
    </div>
  );
}
