import { describe, expect, it } from 'vitest';

import { countWords, detectEncoding, toEditorText, toFileText } from '../../src/lib/encoding';

describe('encoding', () => {
  it('detects a BOM and leaves it out of the editor text', () => {
    const raw = '\uFEFF# Title\r\n\r\nBody\r\n';
    const encoding = detectEncoding(raw);

    expect(encoding).toEqual({ bom: true, eol: '\r\n' });
    expect(toEditorText(raw)).toBe('# Title\n\nBody\n');
  });

  it('preserves LF files', () => {
    const raw = '# a\n# b\n# c\n';
    expect(detectEncoding(raw).eol).toBe('\n');
    expect(toEditorText(raw)).toBe(raw);
  });

  it('chooses CRLF when it dominates', () => {
    expect(detectEncoding('a\r\nb\r\nc\n').eol).toBe('\r\n');
    expect(detectEncoding('a\nb\nc\n').eol).toBe('\n');
  });

  it('round-trips CRLF with a BOM', () => {
    const raw = '\uFEFFone\r\ntwo\r\n';
    const encoding = detectEncoding(raw);
    const editor = toEditorText(raw);

    expect(toFileText(editor, encoding)).toBe(raw);
  });

  it('round-trips LF without a BOM', () => {
    const raw = 'one\ntwo\n';
    const encoding = detectEncoding(raw);
    expect(toFileText(toEditorText(raw), encoding)).toBe(raw);
  });

  it('counts words including unicode letters', () => {
    expect(countWords('Hello world')).toBe(2);
    expect(countWords("don't stop")).toBe(2);
    expect(countWords('Café déjà vu')).toBe(3);
    expect(countWords('   ')).toBe(0);
  });
});
