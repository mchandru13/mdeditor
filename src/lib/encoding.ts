/** Newline detection and restoration, so a save never rewrites a file's
 * line endings or drops its byte-order mark. */

import type { EncodingInfo } from './types';

const BOM = '\uFEFF';

export function detectEncoding(raw: string): EncodingInfo {
  const bom = raw.startsWith(BOM);
  const crlf = (raw.match(/\r\n/g) ?? []).length;
  const lf = (raw.match(/(?<!\r)\n/g) ?? []).length;

  return { bom, eol: crlf > lf ? '\r\n' : '\n' };
}

/** Normalises to `\n` for editing; the original style is kept in `encoding`. */
export function toEditorText(raw: string): string {
  const withoutBom = raw.startsWith(BOM) ? raw.slice(1) : raw;
  return withoutBom.replace(/\r\n/g, '\n');
}

export function toFileText(text: string, encoding: EncodingInfo): string {
  const normalised = encoding.eol === '\r\n' ? text.replace(/\r?\n/g, '\r\n') : text;
  return encoding.bom ? `${BOM}${normalised}` : normalised;
}

export function countWords(text: string): number {
  const matches = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return matches ? matches.length : 0;
}
