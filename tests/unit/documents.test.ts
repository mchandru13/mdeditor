import { describe, expect, it } from 'vitest';

import { isDirty, createDocument, documentsReducer, emptyDocumentsState } from '../../src/state/documents';

const fileDoc = (path: string, source: string) =>
  createDocument({
    title: path,
    origin: { kind: 'file', path, dir: 'C:\\docs' },
    source,
    savedSource: source,
  });

describe('documents reducer', () => {
  it('opens documents and activates the newest by default', () => {
    const first = fileDoc('a.md', '# A');
    const second = fileDoc('b.md', '# B');

    let state = documentsReducer(emptyDocumentsState(), { type: 'open', doc: first });
    state = documentsReducer(state, { type: 'open', doc: second });

    expect(state.docs).toHaveLength(2);
    expect(state.activeId).toBe(second.id);
  });

  it('focuses an existing tab instead of duplicating the same path', () => {
    const first = fileDoc('C:\\docs\\a.md', '# A');
    let state = documentsReducer(emptyDocumentsState(), { type: 'open', doc: first });

    const reopened = fileDoc('c:\\docs\\A.MD', '# different');
    state = documentsReducer(state, { type: 'open', doc: reopened });

    expect(state.docs).toHaveLength(1);
    expect(state.activeId).toBe(first.id);
  });

  it('keeps source state independent between tabs', () => {
    const first = fileDoc('a.md', 'one');
    const second = fileDoc('b.md', 'two');
    let state = documentsReducer(emptyDocumentsState(), { type: 'open', doc: first });
    state = documentsReducer(state, { type: 'open', doc: second });

    state = documentsReducer(state, { type: 'edit', id: first.id, source: 'edited' });

    expect(state.docs.find((doc) => doc.id === first.id)?.source).toBe('edited');
    expect(state.docs.find((doc) => doc.id === second.id)?.source).toBe('two');
  });

  it('derives dirty state from source versus saved content', () => {
    const doc = fileDoc('a.md', 'original');
    expect(isDirty(doc)).toBe(false);

    let state = documentsReducer(emptyDocumentsState(), { type: 'open', doc });
    state = documentsReducer(state, { type: 'edit', id: doc.id, source: 'changed' });
    expect(isDirty(state.docs[0]!)).toBe(true);

    state = documentsReducer(state, {
      type: 'saved',
      id: doc.id,
      savedSource: 'changed',
    });
    expect(isDirty(state.docs[0]!)).toBe(false);
  });

  it('treats an empty untitled document as clean and a filled one as dirty', () => {
    const blank = createDocument({ title: 'Untitled' });
    expect(isDirty(blank)).toBe(false);

    const filled = createDocument({ title: 'Untitled', source: 'x', savedSource: null });
    expect(isDirty(filled)).toBe(true);
  });

  it('selects a neighbouring tab when the active one closes', () => {
    const first = fileDoc('a.md', 'a');
    const second = fileDoc('b.md', 'b');
    const third = fileDoc('c.md', 'c');

    let state = emptyDocumentsState();
    for (const doc of [first, second, third]) {
      state = documentsReducer(state, { type: 'open', doc });
    }
    state = documentsReducer(state, { type: 'activate', id: second.id });
    state = documentsReducer(state, { type: 'close', id: second.id });

    expect(state.activeId).toBe(third.id);
    expect(state.docs).toHaveLength(2);
  });

  it('keeps the active tab when a different tab closes', () => {
    const first = fileDoc('a.md', 'a');
    const second = fileDoc('b.md', 'b');

    let state = documentsReducer(emptyDocumentsState(), { type: 'open', doc: first });
    state = documentsReducer(state, { type: 'open', doc: second });
    state = documentsReducer(state, { type: 'close', id: first.id });

    expect(state.activeId).toBe(second.id);
  });

  it('clears the active tab when the last document closes', () => {
    const doc = fileDoc('a.md', 'a');
    let state = documentsReducer(emptyDocumentsState(), { type: 'open', doc });
    state = documentsReducer(state, { type: 'close', id: doc.id });

    expect(state.docs).toHaveLength(0);
    expect(state.activeId).toBeNull();
  });

  it('does not resurrect a closed document when editing it', () => {
    const doc = fileDoc('a.md', 'a');
    let state = documentsReducer(emptyDocumentsState(), { type: 'open', doc });
    state = documentsReducer(state, { type: 'close', id: doc.id });
    const after = documentsReducer(state, { type: 'edit', id: doc.id, source: 'ghost' });

    expect(after.docs).toHaveLength(0);
  });

  it('tracks scroll positions per document', () => {
    const doc = fileDoc('a.md', 'a');
    let state = documentsReducer(emptyDocumentsState(), { type: 'open', doc });
    state = documentsReducer(state, { type: 'scroll', id: doc.id, preview: 120 });

    expect(state.docs[0]?.scroll.preview).toBe(120);
    expect(state.docs[0]?.scroll.editor).toBe(0);
  });
});
