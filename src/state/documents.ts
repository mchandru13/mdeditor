/** Per-tab document state. The reducer is the only place documents change, and
 * `dirty` is derived so it can never drift from `source`. */

import type { DocId, DocOrigin, DocState, DocStatus, EncodingInfo } from '../lib/types';

export interface DocumentsState {
  docs: DocState[];
  activeId: DocId | null;
}

export interface CreateDocumentInput {
  id?: DocId;
  title: string;
  origin?: DocOrigin | null;
  source?: string;
  savedSource?: string | null;
  encoding?: EncodingInfo;
  diskModifiedAt?: number | null;
}

let counter = 0;

export function newDocId(): DocId {
  counter += 1;
  const random = Math.random().toString(36).slice(2, 8);
  return `doc-${counter}-${random}`;
}

export function createDocument(input: CreateDocumentInput): DocState {
  return {
    id: input.id ?? newDocId(),
    title: input.title,
    origin: input.origin ?? null,
    source: input.source ?? '',
    savedSource: input.savedSource === undefined ? input.source ?? '' : input.savedSource,
    status: 'clean',
    encoding: input.encoding ?? { bom: false, eol: '\n' },
    scroll: { editor: 0, preview: 0 },
    diskModifiedAt: input.diskModifiedAt ?? null,
  };
}

export function isDirty(doc: DocState): boolean {
  if (doc.savedSource === null) return doc.source.length > 0;
  return doc.source !== doc.savedSource;
}

export type DocumentsAction =
  | { type: 'open'; doc: DocState; activate?: boolean }
  | { type: 'close'; id: DocId }
  | { type: 'activate'; id: DocId }
  | { type: 'edit'; id: DocId; source: string }
  | {
      type: 'saved';
      id: DocId;
      savedSource: string;
      origin?: DocOrigin;
      title?: string;
      encoding?: EncodingInfo;
      diskModifiedAt?: number | null;
    }
  | { type: 'status'; id: DocId; status: DocStatus; error?: string }
  | {
      type: 'reload';
      id: DocId;
      source: string;
      savedSource: string;
      encoding?: EncodingInfo;
      diskModifiedAt?: number | null;
    }
  | { type: 'touch'; id: DocId; diskModifiedAt: number }
  | { type: 'scroll'; id: DocId; editor?: number; preview?: number };

export function emptyDocumentsState(): DocumentsState {
  return { docs: [], activeId: null };
}

function replaceDoc(state: DocumentsState, id: DocId, update: (doc: DocState) => DocState): DocumentsState {
  let changed = false;
  const docs = state.docs.map((doc) => {
    if (doc.id !== id) return doc;
    changed = true;
    return update(doc);
  });
  return changed ? { ...state, docs } : state;
}

export function documentsReducer(state: DocumentsState, action: DocumentsAction): DocumentsState {
  switch (action.type) {
    case 'open': {
      const existing = state.docs.findIndex(
        (doc) =>
          doc.origin !== null &&
          action.doc.origin !== null &&
          doc.origin.kind === 'file' &&
          action.doc.origin.kind === 'file' &&
          doc.origin.path.toLowerCase() === action.doc.origin.path.toLowerCase(),
      );

      if (existing >= 0) {
        const target = state.docs[existing];
        return target ? { ...state, activeId: target.id } : state;
      }

      const docs = [...state.docs, action.doc];
      const shouldActivate = action.activate ?? true;
      return { docs, activeId: shouldActivate ? action.doc.id : state.activeId };
    }

    case 'close': {
      const index = state.docs.findIndex((doc) => doc.id === action.id);
      if (index < 0) return state;

      const docs = state.docs.filter((doc) => doc.id !== action.id);
      if (state.activeId !== action.id) return { ...state, docs };

      const nextActive = docs[index] ?? docs[index - 1] ?? null;
      return { docs, activeId: nextActive?.id ?? null };
    }

    case 'activate': {
      if (state.activeId === action.id) return state;
      if (!state.docs.some((doc) => doc.id === action.id)) return state;
      return { ...state, activeId: action.id };
    }

    case 'edit':
      return replaceDoc(state, action.id, (doc) =>
        doc.source === action.source ? doc : { ...doc, source: action.source },
      );

    case 'saved':
      return replaceDoc(state, action.id, (doc) => ({
        ...doc,
        savedSource: action.savedSource,
        source: doc.source,
        origin: action.origin ?? doc.origin,
        title: action.title ?? doc.title,
        encoding: action.encoding ?? doc.encoding,
        diskModifiedAt: action.diskModifiedAt ?? doc.diskModifiedAt,
        status: 'clean',
        error: undefined,
      }));

    case 'status':
      return replaceDoc(state, action.id, (doc) => ({
        ...doc,
        status: action.status,
        error: action.error,
      }));

    case 'reload':
      return replaceDoc(state, action.id, (doc) => ({
        ...doc,
        source: action.source,
        savedSource: action.savedSource,
        encoding: action.encoding ?? doc.encoding,
        diskModifiedAt: action.diskModifiedAt ?? doc.diskModifiedAt,
        status: 'clean',
        error: undefined,
      }));

    case 'touch':
      return replaceDoc(state, action.id, (doc) => ({
        ...doc,
        diskModifiedAt: action.diskModifiedAt,
      }));

    case 'scroll':
      return replaceDoc(state, action.id, (doc) => ({
        ...doc,
        scroll: {
          editor: action.editor ?? doc.scroll.editor,
          preview: action.preview ?? doc.scroll.preview,
        },
      }));

    default:
      return state;
  }
}

export function activeDocument(state: DocumentsState): DocState | null {
  return state.docs.find((doc) => doc.id === state.activeId) ?? null;
}
