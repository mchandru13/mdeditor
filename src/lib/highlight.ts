/**
 * Syntax highlighting with an explicit language set.
 *
 * `rehype-highlight` pulls in lowlight's "common" bundle (~37 grammars, a large
 * share of the initial JS). This module registers only the languages a desktop
 * Markdown app realistically needs, keeps the same `hljs-*` class names, and
 * leaves unknown languages as plain code instead of failing the whole document.
 */

import { visit } from 'unist-util-visit';
import type { Element, ElementContent, Root } from 'hast';
import { createLowlight } from 'lowlight';

import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import shell from 'highlight.js/lib/languages/shell';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

const lowlight = createLowlight();

lowlight.register({
  bash,
  c,
  cpp,
  csharp,
  css,
  diff,
  dockerfile,
  go,
  ini,
  java,
  javascript,
  json,
  markdown,
  php,
  powershell,
  python,
  rust,
  shell,
  sql,
  typescript,
  xml,
  yaml,
});

lowlight.registerAlias({
  bash: ['sh', 'zsh', 'console'],
  csharp: ['cs', 'dotnet'],
  dockerfile: ['docker'],
  ini: ['toml'],
  javascript: ['js', 'jsx', 'mjs', 'cjs', 'node'],
  json: ['jsonc'],
  markdown: ['md'],
  powershell: ['ps1', 'pwsh'],
  python: ['py'],
  rust: ['rs'],
  shell: ['shellsession'],
  sql: ['postgres', 'postgresql'],
  typescript: ['ts', 'tsx'],
  xml: ['html', 'xhtml', 'svg', 'plist'],
  yaml: ['yml'],
});

export function isKnownLanguage(language: string): boolean {
  return lowlight.registered(language.toLowerCase());
}

function codeText(node: Element): string {
  return node.children.map((child) => (child.type === 'text' ? child.value : '')).join('');
}

/**
 * Highlights `pre > code.language-*` blocks in place. Only text is rewritten;
 * no HTML string is parsed or injected.
 */
export function rehypeTrimmedHighlight(languages?: readonly string[]) {
  const allowed = languages ? new Set(languages.map((language) => language.toLowerCase())) : null;

  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'pre') return;

      const code = node.children.find(
        (child): child is Element => child.type === 'element' && child.tagName === 'code',
      );
      if (!code) return;

      const classes = Array.isArray(code.properties?.className)
        ? code.properties.className.map(String)
        : [];
      const languageClass = classes.find((name) => name.startsWith('language-'));
      if (!languageClass) return;

      const language = languageClass.slice('language-'.length).toLowerCase();
      if (allowed && !allowed.has(language)) return;
      if (!lowlight.registered(language)) return;

      try {
        const result = lowlight.highlight(language, codeText(code));
        code.children = result.children as ElementContent[];
      } catch {
        // A grammar failure leaves the block as plain code, never breaks the page.
      }
    });
  };
}
