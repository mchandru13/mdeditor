/** KaTeX stylesheet and font data used to make exported HTML self-contained.
 *
 * Importing the CSS and the woff2 files as inline assets keeps the export free
 * of external dependencies. If a font cannot be resolved the CSS keeps its
 * original reference and the export report says fonts were not embedded. */

import katexCssText from 'katex/dist/katex.min.css?inline';

const fontModules: Record<string, unknown> = import.meta.glob(
  '../../node_modules/katex/dist/fonts/*.woff2',
  { eager: true, query: '?inline', import: 'default' },
);

export const KATEX_CSS: string = katexCssText;

export const KATEX_FONTS: Record<string, string> = Object.fromEntries(
  Object.entries(fontModules)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([path, dataUrl]) => [path.slice(path.lastIndexOf('/') + 1), dataUrl]),
);
