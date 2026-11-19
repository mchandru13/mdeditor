import { useEffect, useState } from 'react';

interface MathNodeProps {
  tex: string;
  display: boolean;
}

/**
 * KaTeX is loaded on demand and rendered from TeX with `trust: false`, so the
 * output is library-generated markup rather than document-supplied HTML.
 */
export function MathNode({ tex, display }: MathNodeProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setError(null);

    void import('katex')
      .then(({ default: katex }) => {
        if (cancelled) return;
        try {
          const rendered = katex.renderToString(tex, {
            displayMode: display,
            throwOnError: true,
            trust: false,
            strict: 'ignore',
          });
          setHtml(rendered);
        } catch (renderError) {
          setError(renderError instanceof Error ? renderError.message : String(renderError));
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
  }, [tex, display]);

  if (error) {
    return (
      <span className="math-error" role="note" title={error}>
        <code>{tex}</code>
      </span>
    );
  }

  if (html === null) {
    return <span className="math-pending">{tex}</span>;
  }

  return (
    <span
      className={display ? 'math-display' : 'math-inline'}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
