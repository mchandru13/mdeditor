import { useState } from 'react';
import type { ReactNode } from 'react';

import { usePlatform } from '../../platform/context';

interface CodeBlockProps {
  code: string;
  language: string;
  children: ReactNode;
}

/** Fenced code block with a copy control. The copy text comes from the source
 * node, never from the highlighted DOM. */
export function CodeBlock({ code, language, children }: CodeBlockProps) {
  const platform = usePlatform();
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const onCopy = () => {
    void platform
      .copyText(code)
      .then(() => {
        setState('copied');
        window.setTimeout(() => setState('idle'), 1500);
      })
      .catch(() => setState('failed'));
  };

  return (
    <div className="code-block">
      <div className="code-block-bar">
        <span className="code-block-language">{language || 'text'}</span>
        <button type="button" className="button ghost small" onClick={onCopy}>
          {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy'}
        </button>
      </div>
      <pre>{children}</pre>
      <span className="visually-hidden" role="status">
        {state === 'copied' ? 'Code copied to clipboard' : ''}
      </span>
    </div>
  );
}
