import { describe, expect, it } from 'vitest';

import { createDocument, isDirty } from '../../src/state/documents';
import {
  RECOVERY_DOC_BYTES,
  parseSettings,
  serializeSettings,
} from '../../src/state/session';

const UI = {
  theme: 'dark' as const,
  mode: 'split' as const,
  tocVisible: true,
  spellCheck: true,
  syncScroll: false,
  zoom: 1.25,
  splitRatio: 0.4,
};

describe('session serialization', () => {
  it('stores only the path for a clean file document', () => {
    const doc = createDocument({
      title: 'a.md',
      origin: { kind: 'file', path: 'C:\\docs\\a.md', dir: 'C:\\docs' },
      source: 'content',
      savedSource: 'content',
    });

    const parsed = parseSettings(serializeSettings([doc], doc.id, UI, isDirty));
    expect(parsed?.docs[0]?.origin).toEqual({ kind: 'file', path: 'C:\\docs\\a.md', dir: 'C:\\docs' });
    expect(parsed?.docs[0]?.recoverySource).toBeNull();
  });

  it('keeps recovery data for modified file documents', () => {
    const doc = createDocument({
      title: 'a.md',
      origin: { kind: 'file', path: 'C:\\docs\\a.md', dir: 'C:\\docs' },
      source: 'edited',
      savedSource: 'original',
    });

    const parsed = parseSettings(serializeSettings([doc], doc.id, UI, isDirty));
    expect(parsed?.docs[0]?.recoverySource).toBe('edited');
  });

  it('keeps recovery data for pasted documents', () => {
    const doc = createDocument({
      title: 'Pasted',
      origin: { kind: 'pasted', baseDir: null },
      source: 'pasted text',
      savedSource: null,
    });

    const parsed = parseSettings(serializeSettings([doc], doc.id, UI, isDirty));
    expect(parsed?.docs[0]?.recoverySource).toBe('pasted text');
  });

  it('truncates oversized recovery data', () => {
    const doc = createDocument({
      title: 'Pasted',
      origin: { kind: 'pasted', baseDir: null },
      source: 'x'.repeat(RECOVERY_DOC_BYTES + 100),
      savedSource: null,
    });

    const parsed = parseSettings(serializeSettings([doc], doc.id, UI, isDirty));
    expect(parsed?.docs[0]?.recoverySource?.length).toBe(RECOVERY_DOC_BYTES);
  });

  it('does not store recovery data for more than twenty documents', () => {
    const docs = Array.from({ length: 25 }, (_, index) =>
      createDocument({
        title: `p${index}`,
        origin: { kind: 'pasted', baseDir: null },
        source: `body ${index}`,
        savedSource: null,
      }),
    );

    const parsed = parseSettings(serializeSettings(docs, docs[0]?.id ?? null, UI, isDirty));
    const withRecovery = parsed?.docs.filter((doc) => doc.recoverySource !== null) ?? [];
    expect(withRecovery).toHaveLength(20);
  });

  it('round-trips UI preferences', () => {
    const parsed = parseSettings(serializeSettings([], null, UI, isDirty));
    expect(parsed).toMatchObject(UI);
  });

  it('clamps implausible split ratios', () => {
    const json = JSON.stringify({
      version: 1,
      theme: 'light',
      mode: 'split',
      tocVisible: true,
      splitRatio: 0.99,
      docs: [],
      activeIndex: 0,
    });
    expect(parseSettings(json)?.splitRatio).toBe(0.5);
  });
});

describe('zoom preference', () => {
  const legacy = JSON.stringify({
    version: 1,
    theme: 'dark',
    mode: 'split',
    tocVisible: true,
    spellCheck: true,
    syncScroll: true,
    splitRatio: 0.4,
    docs: [],
    activeIndex: 0,
  });

  it('survives a save/load round trip', () => {
    const parsed = parseSettings(serializeSettings([], null, { ...UI, zoom: 1.5 }, isDirty));
    expect(parsed?.zoom).toBe(1.5);
  });

  it('defaults to 100% for a settings file written before it was persisted', () => {
    expect(parseSettings(legacy)?.zoom).toBe(1);
  });

  it('clamps a level outside the supported range instead of rejecting the file', () => {
    const tooBig = JSON.parse(legacy) as Record<string, unknown>;
    tooBig.zoom = 99;
    expect(parseSettings(JSON.stringify(tooBig))?.zoom).toBe(2);

    const tooSmall = JSON.parse(legacy) as Record<string, unknown>;
    tooSmall.zoom = 0.01;
    expect(parseSettings(JSON.stringify(tooSmall))?.zoom).toBe(0.5);
  });

  it('falls back to 100% when the stored level is not a number', () => {
    const wrongType = JSON.parse(legacy) as Record<string, unknown>;
    wrongType.zoom = '2';
    expect(parseSettings(JSON.stringify(wrongType))?.zoom).toBe(1);
  });
});

describe('session parsing guards', () => {
  it('round-trips the spell check preference', () => {
    const on = parseSettings(serializeSettings([], null, { ...UI, spellCheck: false }, isDirty));
    expect(on?.spellCheck).toBe(false);

    const off = parseSettings(serializeSettings([], null, { ...UI, spellCheck: true }, isDirty));
    expect(off?.spellCheck).toBe(true);
  });

  it('defaults spell check to on when an older file omits it', () => {
    const json = JSON.stringify({
      version: 1,
      theme: 'light',
      mode: 'split',
      tocVisible: true,
      splitRatio: 0.5,
      docs: [],
      activeIndex: 0,
    });
    expect(parseSettings(json)?.spellCheck).toBe(true);
  });

  it('returns null for missing settings', () => {
    expect(parseSettings(null)).toBeNull();
    expect(parseSettings('')).toBeNull();
  });

  it('returns null for corrupted JSON', () => {
    expect(parseSettings('{not json')).toBeNull();
  });

  it('returns null for a different version', () => {
    expect(parseSettings(JSON.stringify({ version: 2, docs: [] }))).toBeNull();
    expect(parseSettings(JSON.stringify({ version: 0, docs: [] }))).toBeNull();
  });

  it('returns null for non-object payloads', () => {
    expect(parseSettings('"string"')).toBeNull();
    expect(parseSettings('[]')).toBeNull();
  });

  it('drops malformed documents but keeps valid ones', () => {
    const json = JSON.stringify({
      version: 1,
      theme: 'light',
      mode: 'read',
      tocVisible: false,
      splitRatio: 0.5,
      docs: [null, 42, { title: 'ok', origin: { kind: 'pasted', baseDir: null } }],
      activeIndex: 99,
    });

    const parsed = parseSettings(json);
    expect(parsed?.docs).toHaveLength(1);
    expect(parsed?.docs[0]?.title).toBe('ok');
    expect(parsed?.activeIndex).toBe(0);
    expect(parsed?.theme).toBe('light');
    expect(parsed?.mode).toBe('read');
    expect(parsed?.tocVisible).toBe(false);
  });

  it('falls back to defaults for unknown theme and mode values', () => {
    const json = JSON.stringify({
      version: 1,
      theme: 'neon',
      mode: 'gallery',
      docs: [],
    });
    const parsed = parseSettings(json);
    expect(parsed?.theme).toBe('system');
    expect(parsed?.mode).toBe('split');
  });
});

describe('sync scroll preference', () => {
  it('survives a save/load round trip', () => {
    const doc = createDocument({ title: 'a.md', origin: null, source: 'x', savedSource: 'x' });
    const parsed = parseSettings(serializeSettings([doc], doc.id, UI, isDirty));
    expect(parsed?.syncScroll).toBe(false);
  });

  it('defaults on for a settings file written before it was persisted', () => {
    // A real 1.1.0 payload: no `syncScroll` key at all. It must keep working.
    const legacy = JSON.stringify({
      version: 1,
      theme: 'dark',
      mode: 'split',
      tocVisible: true,
      spellCheck: true,
      splitRatio: 0.4,
      docs: [],
      activeIndex: 0,
    });
    expect(parseSettings(legacy)?.syncScroll).toBe(true);
  });

  it('honours an explicit false', () => {
    const payload = JSON.stringify({
      version: 1,
      theme: 'dark',
      mode: 'split',
      tocVisible: true,
      spellCheck: true,
      syncScroll: false,
      splitRatio: 0.4,
      docs: [],
      activeIndex: 0,
    });
    expect(parseSettings(payload)?.syncScroll).toBe(false);
  });
});
