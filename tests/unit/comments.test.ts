import { describe, expect, it } from 'vitest';

import {
  COMMENT_MARKER,
  MAX_COMMENT_BYTES,
  MAX_COMMENT_HEADER_CHARS,
  commentBlockStarts,
  commentHeaderText,
  findInsertPoint,
  formatCommentBlock,
  insertBlockComment,
  validateComment,
} from '../../src/lib/comments';

/** Insert a comment after the whole document and return the result. */
function insertAfterAll(source: string, header: string, body: string) {
  const point = findInsertPoint(source, source.length, source.length);
  if (!point) throw new Error('no insert point');
  return insertBlockComment(source, point, header, body);
}

describe('comment header grammar', () => {
  it('extracts the marker with and without trailing text', () => {
    expect(commentHeaderText(`${COMMENT_MARKER}`)).toBe('');
    expect(commentHeaderText(`${COMMENT_MARKER} chand 2026-11-21`)).toBe('chand 2026-11-21');
  });

  it('rejects near-misses', () => {
    expect(commentHeaderText('[!commentary] x')).toBeNull();
    expect(commentHeaderText(' [!comment] x')).toBeNull();
    expect(commentHeaderText('[!comment]x')).toBeNull();
    expect(commentHeaderText('see [!comment] in prose')).toBeNull();
    expect(commentHeaderText('')).toBeNull();
  });
});

describe('commentBlockStarts', () => {
  it('finds the canonical form', () => {
    const doc = [
      'The cache is invalidated on write.',
      '',
      '> [!comment] chand 2026-11-21',
      '>',
      '> Is this safe when the write fails halfway through?',
      '',
      'After.',
      '',
    ].join('\n');
    const [start] = commentBlockStarts(doc);
    expect(start).toBe(doc.indexOf('>'));
  });

  it('finds every adjacent comment', () => {
    const two = ['> [!comment] a', '>', '> one', '', '> [!comment] b', '>', '> two', ''].join('\n');
    expect(commentBlockStarts(two)).toHaveLength(2);
  });

  it('finds a marker with no body', () => {
    expect(commentBlockStarts('> [!comment]\n')).toHaveLength(1);
  });

  it('does not treat a soft-wrapped marker as a comment', () => {
    // No `>` separator: the marker shares a paragraph with the note.
    expect(commentBlockStarts('> [!comment] chand\n> internal note\n')).toHaveLength(0);
  });

  it('does not treat a formatted header with a soft-wrapped body as a comment', () => {
    expect(commentBlockStarts('> [!comment] **chand**\n> internal note\n')).toHaveLength(0);
  });

  it('does not treat a marker followed by a list as a comment', () => {
    // The separator is what makes it canonical; a list directly below the marker
    // belongs to the quote, so nothing may be hidden or stripped.
    expect(commentBlockStarts('> [!comment] x\n> - keep this item\n')).toHaveLength(0);
  });

  it('does not merge two marker lines in one paragraph', () => {
    const merged = ['> [!comment] a', '> one', '> [!comment] b', '> two', ''].join('\n');
    expect(commentBlockStarts(merged)).toHaveLength(0);
  });

  it('tolerates extra spaces after the quote marker', () => {
    expect(commentBlockStarts('>  [!comment] x\n>  \n>  body\n')).toHaveLength(1);
  });

  it('ignores markers inside a fenced code block', () => {
    expect(commentBlockStarts(['```', '> [!comment] x', '>', '> body', '```', ''].join('\n'))).toHaveLength(0);
  });

  it('ignores markers inside four-space-indented code', () => {
    expect(commentBlockStarts(['    > [!comment] x', '    > body', ''].join('\n'))).toHaveLength(0);
  });

  it('ignores a tilde fence closed by a longer fence', () => {
    expect(commentBlockStarts(['~~~', '> [!comment] x', '~~~~', ''].join('\n'))).toHaveLength(0);
  });

  it('finds comments after a fenced block', () => {
    const mixed = ['```', 'code', '```', '', '> [!comment] a', '>', '> b', ''].join('\n');
    expect(commentBlockStarts(mixed)).toHaveLength(1);
  });

  it('parses CRLF source', () => {
    expect(commentBlockStarts('text\r\n\r\n> [!comment] me\r\n>\r\n> note\r\n')).toHaveLength(1);
  });

  it('scans in linear time on hostile input', () => {
    const hostile = `${'> [!comment]\n>\n> n\n\n'.repeat(20_000)}`;
    const started = performance.now();
    const starts = commentBlockStarts(hostile);
    const elapsed = performance.now() - started;
    expect(starts.length).toBe(20_000);
    expect(elapsed).toBeLessThan(2000);
  });

  it('scans a long unterminated run without going quadratic', () => {
    const hostile = `${'> [!comment] '.repeat(20_000)}\n`;
    const started = performance.now();
    commentBlockStarts(hostile);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe('insertBlockComment', () => {
  const bodies = [
    'Is this safe?',
    'Body with **bold**, [link](https://e.test), $5 and a | pipe.',
    'Line one.\n\nLine two.',
    '---',
    'Trailing spaces   ',
  ];

  for (const body of bodies) {
    it(`stores the body verbatim: ${JSON.stringify(body.slice(0, 32))}`, () => {
      const original = 'The cache is invalidated on write.\n\nAfter.\n';
      const inserted = insertAfterAll(original, 'chand', body);
      // The source has to contain the characters, so an LLM reading the file
      // sees exactly what was typed.
      for (const line of body.replace(/\s+$/, '').split('\n')) {
        expect(inserted.source).toContain(line === '' ? '>' : `> ${line}`);
      }
      // And the renderer's own scanner recognises exactly one comment.
      expect(commentBlockStarts(inserted.source)).toHaveLength(1);
    });
  }

  it('applying the returned range reproduces the new source', () => {
    const original = 'First.\n\nSecond.\n';
    const point = findInsertPoint(original, 0, 0)!;
    const inserted = insertBlockComment(original, point, 'me', 'note');
    const { from, to, text } = inserted.insertion;
    const applied = `${original.slice(0, from)}${text}${original.slice(to)}`;
    expect(applied).toBe(inserted.source);
  });

  it('inserts into an empty file as a normalised block', () => {
    const inserted = insertAfterAll('', 'me', 'hello');
    expect(inserted.source).toBe('> [!comment] me\n>\n> hello\n');
    expect(commentBlockStarts(inserted.source)).toHaveLength(1);
  });

  it('does not duplicate a blank line that is already there', () => {
    const original = 'First.\n\n';
    const point = findInsertPoint(original, original.length, original.length)!;
    const inserted = insertBlockComment(original, point, '', 'note');
    expect(inserted.source.startsWith('First.\n\n> [!comment]\n>\n> note\n')).toBe(true);
    expect(inserted.source).not.toContain('\n\n\n> [!comment]');
  });

  it('produces a stable canonical block from formatCommentBlock', () => {
    expect(formatCommentBlock('chand', 'body')).toBe('> [!comment] chand\n>\n> body');
    expect(formatCommentBlock('', 'body')).toBe('> [!comment]\n>\n> body');
  });

  it('keeps a header on one line', () => {
    expect(formatCommentBlock('chand\n2026', 'body')).toBe('> [!comment] chand 2026\n>\n> body');
  });
});

describe('findInsertPoint', () => {
  it('anchors after a top-level paragraph', () => {
    const source = 'First para.\n\nSecond para.\n\nThird.\n';
    const point = findInsertPoint(source, 0, 0);
    expect(point).not.toBeNull();
    const inserted = insertBlockComment(source, point!, 'chand', 'note');
    expect(inserted.source).toBe(
      'First para.\n\n> [!comment] chand\n>\n> note\n\nSecond para.\n\nThird.\n',
    );
  });

  it('anchors after the last block of a multi-block selection', () => {
    const source = 'One.\n\nTwo.\n\nThree.\n';
    const point = findInsertPoint(source, 0, source.indexOf('Two.') + 4);
    const inserted = insertBlockComment(source, point!, 'chand', 'note');
    expect(inserted.source).toBe('One.\n\nTwo.\n\n> [!comment] chand\n>\n> note\n\nThree.\n');
  });

  it('refuses a selection inside a list', () => {
    const source = '- one\n- two\n\nAfter.\n';
    expect(findInsertPoint(source, 2, 4)).toBeNull();
  });

  it('refuses a selection inside a table', () => {
    const source = '| a | b |\n|---|---|\n| x | y |\n';
    expect(findInsertPoint(source, 2, 2)).toBeNull();
  });

  it('refuses a selection inside a blockquote', () => {
    const source = '> quoted\n\nAfter.\n';
    expect(findInsertPoint(source, 2, 2)).toBeNull();
  });

  it('refuses a selection inside a fenced code block', () => {
    const source = '```\ncode\n```\n';
    expect(findInsertPoint(source, 5, 5)).toBeNull();
  });

  it('handles a document that is only one paragraph', () => {
    const point = findInsertPoint('only paragraph', 0, 0);
    expect(point).not.toBeNull();
  });
});

describe('validateComment', () => {
  it('rejects an empty body', () => {
    expect(validateComment('', '   ')).not.toBeNull();
  });

  it('accepts a normal comment', () => {
    expect(validateComment('chand', 'a note')).toBeNull();
  });

  it('rejects a body over the cap', () => {
    expect(validateComment('', 'x'.repeat(MAX_COMMENT_BYTES + 1))).not.toBeNull();
  });

  it('counts the quoting overhead, not just the raw body', () => {
    // Each line gains two bytes of `> ` quoting, so a body just under the raw cap
    // can still overflow once stored.
    const body = `${'x\n'.repeat(MAX_COMMENT_BYTES / 2 - 2)}`;
    expect(validateComment('', body)).not.toBeNull();
  });

  it('rejects a header longer than the dialog allows', () => {
    expect(validateComment('h'.repeat(MAX_COMMENT_HEADER_CHARS + 1), 'note')).not.toBeNull();
  });
});
