import { describe, expect, it } from 'vitest';

import {
  createHighlighter,
  findSourceMatches,
  findTextMatches,
} from '../../src/lib/search';

function container(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.append(host);
  return host;
}

describe('source search', () => {
  const source = 'Alpha beta alpha ALPHA\nsecond alpha';

  it('counts matches case-insensitively by default', () => {
    expect(findSourceMatches(source, 'alpha')).toHaveLength(4);
  });

  it('respects case sensitivity', () => {
    expect(findSourceMatches(source, 'ALPHA', true)).toHaveLength(1);
    expect(findSourceMatches(source, 'alpha', true)).toHaveLength(2);
  });

  it('returns offsets that select the right text', () => {
    const [first] = findSourceMatches('hello world', 'world');
    expect(first).toBeDefined();
    expect('hello world'.slice(first?.start, first?.end)).toBe('world');
  });

  it('ignores an empty query', () => {
    expect(findSourceMatches(source, '')).toEqual([]);
  });

  it('caps the number of matches', () => {
    expect(findSourceMatches('a a a a a a', 'a', false, 3)).toHaveLength(3);
  });
});

describe('rendered text search', () => {
  it('finds matches across elements', () => {
    const host = container('<p>one two</p><p>two three</p>');
    const matches = findTextMatches(host, 'two');
    expect(matches).toHaveLength(2);
  });

  it('is case-sensitive when asked', () => {
    const host = container('<p>Alpha alpha</p>');
    expect(findTextMatches(host, 'alpha')).toHaveLength(2);
    expect(findTextMatches(host, 'alpha', true)).toHaveLength(1);
  });

  it('skips scripts, styles and diagram sources', () => {
    const host = container(
      '<p>needle</p><script>needle</script><style>/* needle */</style>' +
        '<div class="mdeditor-mermaid">needle</div>',
    );
    expect(findTextMatches(host, 'needle')).toHaveLength(1);
  });

  it('returns no matches for an empty query', () => {
    const host = container('<p>text</p>');
    expect(findTextMatches(host, '')).toEqual([]);
  });
});

describe('highlighter', () => {
  it('wraps matches in marks and restores the text on clear', () => {
    const host = container('<p>alpha beta alpha</p>');
    const paragraph = host.querySelector('p');
    expect(paragraph).not.toBeNull();

    const matches = findTextMatches(host, 'alpha');
    const highlighter = createHighlighter();
    highlighter.apply(matches, 0);

    expect(host.querySelectorAll('mark.search-hit')).toHaveLength(2);
    expect(host.querySelector('mark.search-hit-active')?.textContent).toBe('alpha');

    highlighter.clear();
    expect(host.querySelectorAll('mark')).toHaveLength(0);
    expect(host.textContent).toBe('alpha beta alpha');
  });

  it('never injects markup from the query', () => {
    const host = container('<p>safe text</p>');
    const highlighter = createHighlighter();
    highlighter.apply(findTextMatches(host, 'safe'), 0);

    expect(host.querySelectorAll('mark')[0]?.children).toHaveLength(0);
  });
});
