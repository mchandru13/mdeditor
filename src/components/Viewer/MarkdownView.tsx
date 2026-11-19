import { memo, useMemo } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import type { Components } from 'hast-util-to-jsx-runtime';
import type { Element, Root } from 'hast';

import { MERMAID_CLASS, MATH_DISPLAY_CLASS, MATH_INLINE_CLASS } from '../../lib/markdownPipeline';
import { usePlatform } from '../../platform/context';
import { CodeBlock } from '../CodeBlock/CodeBlock';
import { MermaidBlock } from '../Mermaid/MermaidBlock';
import { MathNode } from './MathNode';

type AnyProps = { node?: Element; children?: ReactNode } & Record<string, unknown>;

function textOf(node: Element | undefined): string {
  if (!node) return '';
  return node.children
    .map((child) => {
      if (child.type === 'text') return child.value;
      if (child.type === 'element') return textOf(child);
      return '';
    })
    .join('');
}

function classList(node: Element | undefined): string[] {
  const value = node?.properties?.className;
  if (!Array.isArray(value)) return [];
  return value.map(String);
}

function domProps(props: AnyProps): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...props };
  delete rest.node;
  return rest;
}

interface MarkdownViewProps {
  tree: Root;
  theme: 'light' | 'dark';
  /** Called for in-document `#fragment` links. */
  onAnchor?: (id: string) => void;
}

/**
 * Converts sanitized HAST to React elements. Placeholders are the only custom
 * elements: math and diagrams are rendered by components, never as HTML strings.
 */
export const MarkdownView = memo(function MarkdownView({ tree, theme, onAnchor }: MarkdownViewProps) {
  const platform = usePlatform();

  const components = useMemo<Components>(() => {
    const map = {
      a: (props: AnyProps) => {
        const href = typeof props.href === 'string' ? props.href : undefined;
        const { children, ...rest } = props;
        const other = domProps(rest);

        return (
          <a
            {...(other)}
            href={href}
            onClick={(event) => {
              if (!href) return;
              if (href.startsWith('#')) {
                event.preventDefault();
                onAnchor?.(href.slice(1));
                return;
              }
              if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:')) {
                event.preventDefault();
                void platform.openExternal(href);
              }
            }}
          >
            {children}
          </a>
        );
      },

      pre: (props: AnyProps) => {
        const node = props.node;
        const codeElement = node?.children.find(
          (child): child is Element => child.type === 'element' && child.tagName === 'code',
        );
        const language =
          classList(codeElement)
            .find((name) => name.startsWith('language-'))
            ?.slice('language-'.length) ?? '';

        return (
          <CodeBlock code={textOf(codeElement ?? node)} language={language}>
            {props.children}
          </CodeBlock>
        );
      },

      div: (props: AnyProps) => {
        const classes = classList(props.node);
        if (classes.includes(MERMAID_CLASS)) {
          return <MermaidBlock source={textOf(props.node)} theme={theme} />;
        }
        if (classes.includes(MATH_DISPLAY_CLASS)) {
          return <MathNode tex={textOf(props.node)} display />;
        }
        return <div {...(domProps(props))} />;
      },

      span: (props: AnyProps) => {
        const classes = classList(props.node);
        if (classes.includes(MATH_INLINE_CLASS)) {
          return <MathNode tex={textOf(props.node)} display={false} />;
        }
        return <span {...(domProps(props))} />;
      },
    };

    return map;
  }, [onAnchor, platform, theme]);

  return toJsxRuntime(tree, {
    Fragment,
    jsx,
    jsxs,
    components,
    passNode: true,
  }) as ReactElement;
});
