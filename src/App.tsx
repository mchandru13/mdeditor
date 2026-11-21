import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import { DocumentTabs } from './components/DocumentTabs/DocumentTabs';
import { UrlDialog } from './components/Dialogs/UrlDialog';
import { CommentDialog } from './components/Dialogs/CommentDialog';
import { InfoDialog, type InfoDialogKind } from './components/Dialogs/InfoDialog';
import { SplitDivider } from './components/Divider/SplitDivider';
import { Editor, type EditorHandle } from './components/Editor/EditorLazy';
import { SearchBar } from './components/SearchBar/SearchBar';
import { Toc } from './components/Toc/Toc';
import { StatusBar } from './components/Toolbar/StatusBar';
import { Toolbar } from './components/Toolbar/Toolbar';
import { MarkdownView } from './components/Viewer/MarkdownView';
import { SelectionContextMenu } from './components/Viewer/SelectionContextMenu';
import { Viewer, type ViewerHandle } from './components/Viewer/Viewer';
import { WorkspaceModeSelector } from './components/WorkspaceModeSelector/WorkspaceModeSelector';
import { useDocumentRender, resourceBaseFor } from './hooks/useDocumentRender';
import { useScrollSpy } from './hooks/useScrollSpy';
import { useShortcuts } from './hooks/useShortcuts';
import { useTheme } from './hooks/useTheme';
import { detectEncoding, toEditorText, toFileText } from './lib/encoding';
import {
  findInsertPoint,
  formatCommentBlock,
  insertBlockComment,
  removeAllCommentBlocks,
  removeCommentBlock,
  scanComments,
  type CommentBlock,
} from './lib/comments';
import { escapeSelector } from './lib/dom';
import { buildStandaloneHtml, ExportTooLargeError, formatReport } from './lib/exportHtml';
import { EXPORT_CSS } from './lib/exportStyles';
import type { Renderer } from './lib/renderClient';
import {
  createHighlighter,
  findSourceMatches,
  findTextMatches,
  type Highlighter,
  type SourceMatch,
  type TextMatch,
} from './lib/search';
import type { DocId, DocState, WorkspaceMode } from './lib/types';
import type { RenderOutput } from './lib/markdownPipeline';
import { RICH_CONTENT_LIMIT } from './hooks/useDocumentRender';
import { PlatformProvider } from './platform/context';
import { createPlatform } from './platform/choose';
import { fileTitle, isMarkdownPath, parentDir, type Platform } from './platform';
import {
  activeDocument,
  createDocument,
  documentsReducer,
  emptyDocumentsState,
  isDirty,
} from './state/documents';
import {
  parseSettings,
  serializeSettings,
  type ThemeMode,
} from './state/session';

export interface AppProps {
  platform?: Platform;
  initialMode?: WorkspaceMode;
}

/** Larger files are refused rather than silently degrading (§14.3). */
const MAX_DOCUMENT_CHARS = 20 * 1024 * 1024;
/** Soft tab limit; opening beyond it asks for confirmation. */
const MAX_TABS = 50;

function remoteTitle(url: string): string {
  const clean = url.split('#')[0]?.split('?')[0] ?? url;
  const name = clean.slice(clean.lastIndexOf('/') + 1);
  return name.length > 0 ? name : url;
}

export function App({ platform: providedPlatform, initialMode }: AppProps) {
  const platform = useMemo(() => providedPlatform ?? createPlatform(), [providedPlatform]);

  const [documents, dispatch] = useReducer(documentsReducer, undefined, emptyDocumentsState);
  const [mode, setMode] = useState<WorkspaceMode>(initialMode ?? 'split');
  const [theme, setTheme] = useState<ThemeMode>('system');
  const [tocVisible, setTocVisible] = useState(true);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [syncScroll, setSyncScroll] = useState(true);
  const [spellCheck, setSpellCheck] = useState(true);

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [replaceVisible, setReplaceVisible] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [textMatches, setTextMatches] = useState<TextMatch[]>([]);
  const [sourceMatches, setSourceMatches] = useState<SourceMatch[]>([]);
  const [activeMatch, setActiveMatch] = useState(0);

  const [urlDialogOpen, setUrlDialogOpen] = useState(false);
  const [commentDialog, setCommentDialog] = useState<{
    source: string;
    from: number;
    to: number;
    target: string;
    /** Present when editing an existing comment. */
    existing?: { header: string; body: string };
    block?: CommentBlock;
  } | null>(null);
  const [infoDialog, setInfoDialog] = useState<InfoDialogKind | null>(null);
  const [urlBusy, setUrlBusy] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  /** Documents where the user explicitly chose to load remote images. */
  const [remoteImagesAllowed, setRemoteImagesAllowed] = useState<Set<DocId>>(() => new Set());

  const viewerRef = useRef<ViewerHandle | null>(null);
  const viewerElementRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<EditorHandle | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const highlighterRef = useRef<Highlighter | null>(null);
  const searchKeyRef = useRef('');
  const stateRef = useRef(documents);
  const lastDirRef = useRef<string | null>(null);
  const hydratingRef = useRef(new Set<DocId>());
  const syncLockRef = useRef(0);
  const startupHandledRef = useRef(false);
  const scrollSaveRef = useRef(0);
  const mermaidSeq = useRef(0);

  stateRef.current = documents;

  const resolvedTheme = useTheme(theme);
  const doc = activeDocument(documents);

  const previewMode = mode !== 'edit';
  const allowRemoteImages = doc ? remoteImagesAllowed.has(doc.id) : false;
  const render = useDocumentRender(doc, mode, platform, rendererRef, allowRemoteImages);

  const loadRemoteImages = useCallback(() => {
    if (!doc) return;
    setRemoteImagesAllowed((current) => new Set(current).add(doc.id));
  }, [doc]);

  const onAnchor = useCallback((id: string) => {
    viewerRef.current?.scrollToHeading(id);
  }, []);

  const headings = useMemo(() => render.output?.headings ?? [], [render.output]);
  const activeHeading = useScrollSpy(viewerElementRef, headings, previewMode);

  const searchCount = mode === 'edit' ? sourceMatches.length : textMatches.length;

  /* ---------------------------------------------------------------- documents */

  const openPath = useCallback(
    async (path: string) => {
      if (!isMarkdownPath(path)) {
        setMessage(`Only .md and .markdown files are supported: ${fileTitle(path)}`);
        return;
      }

      const existing = stateRef.current.docs.find(
        (candidate) =>
          candidate.origin?.kind === 'file' &&
          candidate.origin.path.toLowerCase() === path.toLowerCase(),
      );
      if (existing) {
        dispatch({ type: 'activate', id: existing.id });
        return;
      }

      if (stateRef.current.docs.length >= MAX_TABS) {
        const proceed = await platform.confirmAction(
          `${MAX_TABS} documents are already open. Open another one?`,
        );
        if (!proceed) return;
      }

      try {
        const { text, bom } = await platform.readFile(path);
        if (text.length > MAX_DOCUMENT_CHARS) {
          setMessage(
            `${fileTitle(path)} is larger than 20 MB. Split it into smaller documents to open it.`,
          );
          return;
        }
        const info = detectEncoding(text);
        const dir = parentDir(path);
        lastDirRef.current = dir;
        await platform.allowAssetDir(dir);

        const source = toEditorText(text);
        const diskModifiedAt = await platform.modifiedTime(path);
        dispatch({
          type: 'open',
          doc: createDocument({
            title: fileTitle(path),
            origin: { kind: 'file', path, dir },
            source,
            savedSource: source,
            encoding: { bom, eol: info.eol },
            diskModifiedAt,
          }),
        });
      } catch (error) {
        setMessage(`Could not open ${fileTitle(path)}: ${describe(error)}`);
      }
    },
    [platform],
  );

  const openRemote = useCallback(
    async (url: string) => {
      setUrlBusy(true);
      setUrlError(null);

      try {
        const { text, finalUrl } = await platform.fetchRemote(url);
        const info = detectEncoding(text);
        dispatch({
          type: 'open',
          doc: createDocument({
            title: remoteTitle(finalUrl),
            origin: { kind: 'remote', url, finalUrl, baseUrl: finalUrl },
            source: toEditorText(text),
            savedSource: toEditorText(text),
            encoding: { bom: false, eol: info.eol },
          }),
        });
        setUrlDialogOpen(false);
      } catch (error) {
        setUrlError(describe(error));
      } finally {
        setUrlBusy(false);
      }
    },
    [platform],
  );

  const saveDocument = useCallback(
    async (target: DocState, saveAs = false) => {
      let path = target.origin?.kind === 'file' ? target.origin.path : null;
      if (!path || saveAs) {
        path = await platform.saveFileDialog(
          path ?? `${target.title.replace(/\.(md|markdown)$/i, '')}.md`,
          'markdown',
        );
      }
      if (!path) return;

      setSaving(true);
      try {
        await platform.writeFile(path, toFileText(target.source, target.encoding), target.encoding.bom);
        const diskModifiedAt = await platform.modifiedTime(path);
        dispatch({
          type: 'saved',
          id: target.id,
          savedSource: target.source,
          origin: { kind: 'file', path, dir: parentDir(path) },
          title: fileTitle(path),
          encoding: target.encoding,
          diskModifiedAt,
        });
        setMessage('Saved');
      } catch (error) {
        setMessage(`Save failed: ${describe(error)}`);
      } finally {
        setSaving(false);
      }
    },
    [platform],
  );

  const closeDocument = useCallback(
    async (id: DocId) => {
      const target = stateRef.current.docs.find((candidate) => candidate.id === id);
      if (!target) return;

      if (isDirty(target)) {
        const proceed = await platform.confirmDiscard([target.title]);
        if (!proceed) return;
      }
      dispatch({ type: 'close', id });
    },
    [platform],
  );

  /** Shared by the window close button, the Exit menu item and OS shutdown. */
  const attemptClose = useCallback(async () => {
    const dirty = stateRef.current.docs.filter(isDirty);
    if (dirty.length > 0) {
      const proceed = await platform.confirmDiscard(dirty.map((entry) => entry.title));
      if (!proceed) return;
    }
    await platform.closeWindow();
  }, [platform]);

  /* ------------------------------------------------------------- persistence */
  useEffect(() => {
    let cancelled = false;
    // Only arm the persistence effect when the stored settings were actually
    // accepted, or when there were none to accept. A file this build refuses
    // (future version, unknown shape, or a load error such as oversized) must be
    // left untouched: parseSettings and the Rust loader both document starting
    // from defaults *without touching it*, and marking hydration complete there
    // would let the debounced save overwrite it and destroy its recovery data.
    let accepted = false;

    void (async () => {
      try {
        const raw = await platform.loadSettings();
        if (cancelled) return;

        // No stored settings (first run, or a corrupt file the loader already
        // backed up and removed): start from defaults and persist normally.
        if (raw === null) {
          accepted = true;
          return;
        }

        const parsed = parseSettings(raw);
        if (!parsed) {
          setMessage('Stored settings could not be read; starting from defaults.');
          return;
        }

        setTheme(parsed.theme);
        setMode(initialMode ?? parsed.mode);
        setTocVisible(parsed.tocVisible);
        setSpellCheck(parsed.spellCheck);
        setSplitRatio(parsed.splitRatio);

        const restoredIds: DocId[] = [];
        for (const entry of parsed.docs) {
          const restored = createDocument({
            title: entry.title,
            origin: entry.origin,
            source: entry.recoverySource ?? '',
            // Recovery data is a bounded copy of an unsaved buffer, never the
            // file's content, so it must not stand in for savedSource: that would
            // mark a truncated tab as saved and let the next save overwrite the
            // real file with the recovered prefix. Leaving savedSource null keeps
            // the tab dirty, so the loader below re-reads the file from disk.
            savedSource: null,
            encoding: entry.encoding,
          });
          restored.scroll = entry.scroll;
          restoredIds.push(restored.id);
          dispatch({ type: 'open', doc: restored, activate: false });
        }

        const activeId = restoredIds[parsed.activeIndex] ?? restoredIds[0];
        if (activeId) dispatch({ type: 'activate', id: activeId });
        accepted = true;
      } catch {
        setMessage('Stored settings could not be read; starting from defaults.');
      } finally {
        if (!cancelled && accepted) setHydrated(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [platform, initialMode]);

  useEffect(() => {
    if (!hydrated) return undefined;
    const timer = setTimeout(() => {
      const json = serializeSettings(documents.docs, documents.activeId, {
        theme,
        mode,
        tocVisible,
        spellCheck,
        splitRatio,
      }, isDirty);

      void platform.saveSettings(json).catch((error: unknown) => {
        setMessage(`Settings could not be saved: ${describe(error)}`);
      });
    }, 800);

    return () => clearTimeout(timer);
  }, [documents, theme, mode, tocVisible, spellCheck, splitRatio, hydrated, platform]);

  // Load file contents for restored tabs that only had a path.
  useEffect(() => {
    if (!doc || doc.origin?.kind !== 'file' || doc.source.length > 0) return;
    if (doc.savedSource !== null) return;
    if (hydratingRef.current.has(doc.id)) return;

    hydratingRef.current.add(doc.id);
    const origin = doc.origin;
    if (origin.kind !== 'file') return;
    const path = origin.path;
    const dir = origin.dir;

    void (async () => {
      try {
        const { text, bom } = await platform.readFile(path);
        if (text.length > MAX_DOCUMENT_CHARS) {
          dispatch({
            type: 'status',
            id: doc.id,
            status: 'error',
            error: 'File is larger than 20 MB and was not restored.',
          });
          return;
        }
        const info = detectEncoding(text);
        const source = toEditorText(text);
        dispatch({
          type: 'reload',
          id: doc.id,
          source,
          savedSource: source,
          encoding: { bom, eol: info.eol },
          diskModifiedAt: await platform.modifiedTime(path),
        });
        await platform.allowAssetDir(dir);
      } catch (error) {
        dispatch({ type: 'status', id: doc.id, status: 'missing', error: describe(error) });
      }
    })();
  }, [doc, platform]);

  /* ------------------------------------------------------------------- input */

  useEffect(() => {
    const dispose = platform.onDragDrop((paths) => {
      for (const path of paths) void openPath(path);
    });
    return dispose;
  }, [platform, openPath]);

  useEffect(() => {
    const dispose = platform.onOpenFile((path) => {
      void openPath(path);
    });
    return dispose;
  }, [platform, openPath]);

  useEffect(() => {
    const dispose = platform.onCloseRequested(() => {
      void attemptClose();
    });
    return dispose;
  }, [platform, attemptClose]);


  useEffect(() => {
    if (startupHandledRef.current) return;
    startupHandledRef.current = true;

    void (async () => {
      const file = await platform.startupFile();
      if (file) await openPath(file);

      const url = await platform.startupUrl();
      if (url) await openRemote(url);
    })();
  }, [platform, openPath, openRemote]);

  const openFromDialog = useCallback(async () => {
    const path = await platform.openFileDialog();
    if (path) await openPath(path);
  }, [platform, openPath]);

  /** Creates an empty untitled document, numbered to keep tabs distinguishable. */
  const newDocument = useCallback(() => {
    const titles = new Set(stateRef.current.docs.map((entry) => entry.title));
    let index = 1;
    while (titles.has(`Untitled ${index}`)) index += 1;

    dispatch({
      type: 'open',
      doc: createDocument({
        title: `Untitled ${index}`,
        origin: null,
        source: '',
        savedSource: '',
      }),
    });
  }, []);

  const newFromClipboard = useCallback(async () => {
    try {
      const text = await platform.readClipboard();
      if (!text.trim()) {
        setMessage('The clipboard is empty.');
        return;
      }
      dispatch({
        type: 'open',
        doc: createDocument({
          title: 'Pasted document',
          origin: { kind: 'pasted', baseDir: lastDirRef.current },
          source: toEditorText(text),
          savedSource: null,
        }),
      });
    } catch (error) {
      setMessage(`Could not read the clipboard: ${describe(error)}`);
    }
  }, [platform]);

  /* ------------------------------------------------------------------ search */

  useEffect(() => {
    if (!searchOpen || query.length === 0 || !doc) {
      setTextMatches([]);
      setSourceMatches([]);
      highlighterRef.current?.clear();
      return;
    }

    // Keep the current index when the document changes (editing or replacing);
    // reset it only when the query itself changes.
    const key = `${query}\u0000${caseSensitive}\u0000${mode}`;
    const reset = searchKeyRef.current !== key;
    searchKeyRef.current = key;

    const keep = (count: number) => {
      setActiveMatch((current) => (reset ? 0 : Math.min(current, Math.max(0, count - 1))));
    };

    if (mode === 'edit') {
      const found = findSourceMatches(doc.source, query, caseSensitive);
      setSourceMatches(found);
      setTextMatches([]);
      keep(found.length);
      return;
    }

    const root = viewerElementRef.current?.querySelector('.markdown-body');
    const found = root ? findTextMatches(root, query, caseSensitive) : [];
    setTextMatches(found);
    setSourceMatches([]);
    keep(found.length);
  }, [searchOpen, query, caseSensitive, mode, doc, render.output]);

  useEffect(() => {
    if (mode === 'edit' || !searchOpen) {
      highlighterRef.current?.clear();
      return;
    }
    if (!highlighterRef.current) highlighterRef.current = createHighlighter();
    highlighterRef.current.apply(textMatches, activeMatch);
  }, [textMatches, activeMatch, mode, searchOpen]);

  const navigateMatch = useCallback(
    (delta: number) => {
      const count = mode === 'edit' ? sourceMatches.length : textMatches.length;
      if (count === 0) return;

      const next = (activeMatch + delta + count) % count;
      setActiveMatch(next);

      if (mode === 'edit') {
        const match = sourceMatches[next];
        if (match) editorRef.current?.selectRange(match.start, match.end);
        return;
      }

      const match = textMatches[next];
      if (match) viewerRef.current?.scrollToElement(match.node.parentElement);
    },
    [activeMatch, mode, sourceMatches, textMatches],
  );

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setReplaceVisible(false);
    setQuery('');
    setTextMatches([]);
    setSourceMatches([]);
    highlighterRef.current?.clear();
  }, []);

  const canReplace = Boolean(doc) && mode !== 'read';

  const replaceCurrent = useCallback(() => {
    if (!doc || mode === 'read') return;
    const match = sourceMatches[activeMatch];
    if (!match) return;

    dispatch({
      type: 'edit',
      id: doc.id,
      source: `${doc.source.slice(0, match.start)}${replacement}${doc.source.slice(match.end)}`,
    });
  }, [activeMatch, doc, mode, replacement, sourceMatches]);

  const replaceAll = useCallback(() => {
    if (!doc || mode === 'read' || query.length === 0) return;

    const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'g' : 'gi');
    let count = 0;
    const next = doc.source.replace(pattern, () => {
      count += 1;
      return replacement;
    });

    if (count === 0) {
      setMessage('No matches to replace.');
      return;
    }

    dispatch({ type: 'edit', id: doc.id, source: next });
    setMessage(`Replaced ${count} occurrence${count === 1 ? '' : 's'}.`);
  }, [caseSensitive, doc, mode, query, replacement]);

  /* ---------------------------------------------------------------- comments */

  /**
   * Maps a DOM selection in the preview back to source offsets.
   *
   * Read and Split users select text in the rendered document, not in the
   * source. The offsets still have to be source offsets, so the selected text is
   * located in the document source: first as an exact substring, otherwise by
   * its first and last words (the rendered text differs from the source in
   * whitespace and inline markup). Returns null when the selection is not text
   * that occurs in the document, so nothing is ever anchored by guesswork.
   */
  const sourceRangeForDomSelection = useCallback((): { from: number; to: number } | null => {
    const current = activeDocument(stateRef.current);
    const body = viewerElementRef.current?.querySelector('.markdown-body');
    if (!current || !body) return null;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    if (!body.contains(range.commonAncestorContainer)) return null;

    const text = selection.toString().replace(/\s+/g, ' ').trim();
    if (!text) return null;

    const exact = current.source.indexOf(text);
    if (exact !== -1) return { from: exact, to: exact + text.length };

    // Rendered text and source differ where inline markup or wrapping is
    // involved, so fall back to the first and last word of the selection.
    const words = text.split(' ').filter(Boolean);
    const first = words[0] ?? '';
    const last = words[words.length - 1] ?? '';
    if (!first || !last) return null;
    const start = current.source.indexOf(first);
    if (start === -1) return null;
    const end = current.source.indexOf(last, start);
    if (end === -1) return null;
    return { from: start, to: end + last.length };
  }, []);

  /**
   * Opens the comment dialog for the current selection.
   *
   * Comments are anchored to top-level blocks only: a blockquote placed after a
   * list item leaves the list, which would silently attach the note to the whole
   * list instead of the item the user selected, so those selections are refused
   * with a message rather than mis-anchored.
   */
  const startComment = useCallback(() => {
    // Read the document from the ref so this callback is stable across edits:
    // it is a dependency of the native-menu effect, and rebuilding that effect
    // on every keystroke leaks a menu subscription per edit.
    const current = activeDocument(stateRef.current);
    if (!current) {
      setMessage('Open a document before adding a comment.');
      return;
    }

    // Edit Mode selection first, then the preview. In Read Mode the editor does
    // not exist at all, so requiring one made the command dead there; and in
    // Edit Mode the lazy editor chunk can be in flight, which is not a reason to
    // refuse a selection the user can see.
    const editorSelection = editorRef.current?.getSelection() ?? null;
    const fromEditor =
      editorSelection && editorSelection.from !== editorSelection.to ? editorSelection : null;
    const selection = fromEditor ?? sourceRangeForDomSelection();

    if (!selection) {
      setMessage(
        mode === 'read'
          ? 'Select text in the document first, then press Ctrl+Shift+M.'
          : 'Select the text to comment on first, then press Ctrl+Shift+M.',
      );
      return;
    }

    const point = findInsertPoint(current.source, selection.from, selection.to);
    if (!point) {
      setMessage('Comments attach to ordinary paragraphs. Select text outside a list, table, quote or code block.');
      return;
    }

    setCommentDialog({
      source: current.source,
      from: selection.from,
      to: selection.to,
      target: anchorLabel(current.source, point.anchorEnd),
    });
  }, [mode, sourceRangeForDomSelection]);

  const submitComment = useCallback(
    (comment: { header: string; body: string }) => {
      if (!doc || !commentDialog) return;
      // The native menu can open another document, or undo, while the dialog is
      // up. Offsets from the old source would anchor the comment to a different
      // block, so refuse instead of guessing.
      if (commentDialog.source !== doc.source) {
        setMessage('The document changed while the dialog was open. Try again.');
        setCommentDialog(null);
        return;
      }

      // Editing rewrites the existing block in place: same position, same
      // neighbours, new text.
      if (commentDialog.block) {
        const block = commentDialog.block;
        const blockSource = doc.source.slice(block.start, block.end);
        const replacement = formatCommentBlock(comment.header, comment.body);
        const offset = blockSource.indexOf('>');
        const editorForEdit = editorRef.current;
        if (editorForEdit && offset !== -1) {
          editorForEdit.replaceRange(block.start, block.end, replacement);
        } else {
          dispatch({
            type: 'edit',
            id: doc.id,
            source: `${doc.source.slice(0, block.start)}${replacement}${doc.source.slice(block.end)}`,
          });
        }
        setCommentDialog(null);
        setMessage('Comment updated.');
        return;
      }

      const point = findInsertPoint(doc.source, commentDialog.from, commentDialog.to);
      if (!point) {
        setMessage('That selection can no longer be commented.');
        setCommentDialog(null);
        return;
      }

      const inserted = insertBlockComment(doc.source, point, comment.header, comment.body);
      // Apply as one CodeMirror transaction: routing the text through the value
      // prop looks like an external load of an empty buffer, which is kept out of
      // history, so Ctrl+Z would not undo the comment.
      const editor = editorRef.current;
      if (editor) editor.replaceRange(inserted.insertion.from, inserted.insertion.to, inserted.insertion.text);
      else dispatch({ type: 'edit', id: doc.id, source: inserted.source });

      setCommentDialog(null);
      setMessage('Comment added to the document.');
    },
    [commentDialog, doc],
  );

  /**
   * Opens the dialog for the comment the caret is in, or the comment nearest the
   * selection, so "Edit Comment" does not require selecting the whole block.
   */
  /**
   * Opens the dialog for one comment.
   *
   * With `index`, that exact block is used — this is how a right-click on a
   * rendered comment edits that comment rather than whatever the caret was last
   * in. Without it, the block is chosen from the editor caret: the one
   * containing it, else the nearest.
   */
  const openCommentAt = useCallback((index?: number) => {
    const current = activeDocument(stateRef.current);
    if (!current) {
      setMessage('Open a document before editing a comment.');
      return;
    }

    const blocks = scanComments(current.source);
    if (blocks.length === 0) {
      setMessage('This document has no comments.');
      return;
    }

    let block = index === undefined ? undefined : blocks[index];
    if (index !== undefined && !block) {
      // The render and the source disagreed (edited between the click and the
      // menu item). Say so instead of editing a different comment.
      setMessage('That comment is no longer in the document.');
      return;
    }

    if (!block) {
      const selection = editorRef.current?.getSelection() ?? null;
      const at = selection?.from ?? 0;
      block =
        blocks.find((candidate) => at >= candidate.start && at <= candidate.end) ??
        blocks.reduce((best, candidate) =>
          Math.abs(candidate.start - at) < Math.abs(best.start - at) ? candidate : best,
        );
    }

    setCommentDialog({
      source: current.source,
      from: block.start,
      to: block.end,
      target: anchorLabel(current.source, block.start),
      existing: { header: block.header, body: block.body },
      block,
    });
  }, []);

  const editComment = useCallback(() => openCommentAt(), [openCommentAt]);

  /** Removes one comment by its position in the document, without a dialog. */
  const removeCommentAt = useCallback(
    (index: number) => {
      const current = activeDocument(stateRef.current);
      if (!current) return;

      const block = scanComments(current.source)[index];
      if (!block) {
        setMessage('That comment is no longer in the document.');
        return;
      }

      const next = removeCommentBlock(current.source, block);
      const editor = editorRef.current;
      if (editor) applySourceDiff(editor, current.source, next);
      else dispatch({ type: 'edit', id: current.id, source: next });
      setMessage('Comment removed.');
    },
    [],
  );

  const removeComment = useCallback(() => {
    const current = activeDocument(stateRef.current);
    if (!current || !commentDialog?.block) return;

    const blocks = scanComments(current.source);
    const target = blocks.find((candidate) => candidate.start === commentDialog.block!.start);
    if (!target) {
      setMessage('That comment is no longer in the document.');
      setCommentDialog(null);
      return;
    }

    const next = removeCommentBlock(current.source, target);
    const editor = editorRef.current;
    if (editor) {
      applySourceDiff(editor, current.source, next);
    } else {
      dispatch({ type: 'edit', id: current.id, source: next });
    }

    setCommentDialog(null);
    setMessage('Comment removed.');
  }, [commentDialog]);

  const removeAllComments = useCallback(() => {
    const current = activeDocument(stateRef.current);
    if (!current) return;

    const { source: next, removed } = removeAllCommentBlocks(current.source);
    if (removed === 0) {
      setMessage('This document has no comments.');
      return;
    }

    const editor = editorRef.current;
    if (editor) applySourceDiff(editor, current.source, next);
    else dispatch({ type: 'edit', id: current.id, source: next });

    setMessage(`Removed ${removed} comment${removed === 1 ? '' : 's'}.`);
  }, []);

  /* ---------------------------------------------------------------- shortcuts */

  const shortcuts = useMemo(
    () => ({
      'mod+n': () => newDocument(),
      'mod+1': () => setMode('read'),
      'mod+2': () => setMode('edit'),
      'mod+3': () => setMode('split'),
      'mod+f': () => {
        setReplaceVisible(false);
        setSearchOpen(true);
      },
      'mod+h': () => {
        setReplaceVisible(true);
        setSearchOpen(true);
      },
      'mod+s': () => {
        const current = activeDocument(stateRef.current);
        if (current) void saveDocument(current);
      },
      'mod+shift+s': () => {
        const current = activeDocument(stateRef.current);
        if (current) void saveDocument(current, true);
      },
      'mod+o': () => void openFromDialog(),
      'mod+shift+m': () => startComment(),
      'mod+w': () => {
        const current = activeDocument(stateRef.current);
        if (current) void closeDocument(current.id);
      },
      escape: () => {
        if (searchOpen) closeSearch();
        else if (commentDialog) setCommentDialog(null);
        else if (urlDialogOpen) setUrlDialogOpen(false);
      },
    }),
    [closeDocument, closeSearch, newDocument, openFromDialog, saveDocument, searchOpen, urlDialogOpen, startComment, commentDialog],
  );

  useShortcuts(shortcuts);

  /* ------------------------------------------------------------------- scroll */

  // Restore the stored preview position whenever the viewer remounts (tab or
  // mode change). The editor restores through its own `initialScroll` prop.
  const restoredScrollRef = useRef<string | null>(null);
  useEffect(() => {
    if (!doc || mode === 'edit' || !render.output) return;
    const key = `${doc.id}:${mode}`;
    if (restoredScrollRef.current === key) return;
    restoredScrollRef.current = key;
    viewerRef.current?.restoreScroll(doc.scroll.preview);
  }, [doc, mode, render.output]);

  const onEditorScroll = useCallback(
    (top: number) => {
      if (!syncScroll || mode !== 'split' || !previewMode) return;
      const now = Date.now();
      if (now - syncLockRef.current < 150) return;
      syncLockRef.current = now;

      const line = editorRef.current?.lineAtScrollTop(top) ?? 1;
      const anchor = [...headings].reverse().find((heading) => heading.line <= line);
      if (anchor) viewerRef.current?.scrollToHeading(anchor.id);
    },
    [headings, mode, previewMode, syncScroll],
  );

  const onViewerScroll = useCallback(
    (top: number) => {
      if (!doc) return;

      const now = Date.now();
      if (now - scrollSaveRef.current > 500) {
        scrollSaveRef.current = now;
        dispatch({ type: 'scroll', id: doc.id, preview: top });
      }

      if (!syncScroll || mode !== 'split' || !previewMode) return;
      if (now - syncLockRef.current < 150) return;
      syncLockRef.current = now;

      const container = viewerElementRef.current;
      if (!container) return;
      const containerTop = container.getBoundingClientRect().top;

      let anchorId: string | null = null;
      for (const heading of headings) {
        const element = container.querySelector<HTMLElement>(`[id="${escapeSelector(heading.id)}"]`);
        if (!element) continue;
        if (element.getBoundingClientRect().top - containerTop <= 24) anchorId = heading.id;
        else break;
      }

      const anchor = headings.find((heading) => heading.id === anchorId);
      if (anchor) editorRef.current?.scrollToLine(anchor.line);
    },
    [doc, headings, mode, previewMode, syncScroll],
  );

  /* ------------------------------------------------------------------- export */

  const ensureOutput = useCallback(async (): Promise<{ current: DocState; output: RenderOutput } | null> => {
    const current = activeDocument(stateRef.current);
    if (!current) return null;
    // Export keeps remote images as remote references, so a tree built with them
    // blocked would silently degrade to placeholder text in the exported file.
    const blockedRemote = (render.output?.placeholders.blockedRemoteImages ?? 0) > 0;
    if (render.output && !blockedRemote) return { current, output: render.output };

    const renderer = rendererRef.current;
    if (!renderer) return null;

    try {
      const output = await renderer.render(
        {
          base: resourceBaseFor(current),
          assetOrigin: platform.assetOrigin(),
          disableRichContent: current.source.length > RICH_CONTENT_LIMIT,
          remoteImages: 'allow',
        },
        current.source,
      );
      return { current, output };
    } catch (error) {
      setMessage(`Render failed: ${describe(error)}`);
      return null;
    }
  }, [platform, render.output]);

  const copyRenderedHtml = useCallback(async () => {
    const body = viewerElementRef.current?.querySelector('.markdown-body');
    if (!body) {
      setMessage('Open the document in Read or Split mode before copying HTML.');
      return;
    }
    try {
      await platform.copyText(body.innerHTML);
    } catch (error) {
      // The OS clipboard is a shared resource: another process can hold it, and
      // the platform layer then rejects the write. Say so instead of leaving the
      // user with a button that appears to do nothing.
      setMessage(`Could not copy: ${describe(error)}`);
      return;
    }
    setMessage('Rendered HTML fragment copied to the clipboard.');
  }, [platform]);

  const exportHtml = useCallback(async () => {
    const ready = await ensureOutput();
    if (!ready) return;

    const path = await platform.saveFileDialog(
      `${ready.current.title.replace(/\.(md|markdown)$/i, '')}.html`,
      'html',
    );
    if (!path) return;

    try {
      const [assets, mermaidModule, inlining] = await Promise.all([
        import('./lib/katexAssets'),
        import('mermaid'),
        import('./lib/assetInlining'),
      ]);

      const mermaid = mermaidModule.default;
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });

      const assetOrigin = platform.assetOrigin();
      const built = await buildStandaloneHtml({
        tree: ready.output.hast,
        title: ready.current.title,
        theme: resolvedTheme,
        css: EXPORT_CSS,
        katexCss: assets.KATEX_CSS,
        fonts: assets.KATEX_FONTS,
        assetOrigins: assetOrigin ? [assetOrigin, 'asset://localhost'] : ['asset://localhost'],
        fetchAsDataUrl: inlining.fetchAsDataUrl,
        renderMermaid: async (source) => {
          mermaidSeq.current += 1;
          const result = await mermaid.render(`export-${mermaidSeq.current}`, source);
          return result.svg;
        },
      });

      await platform.writeFile(path, built.html, false);
      setMessage(`Exported: ${formatReport(built.report)}`);
    } catch (error) {
      setMessage(
        error instanceof ExportTooLargeError
          ? error.message
          : `Export failed: ${describe(error)}`,
      );
    }
  }, [ensureOutput, platform, resolvedTheme]);

  /* -------------------------------------------------------------------- menu */

  useEffect(() => {
    const dispose = platform.onMenuCommand((commandId) => {
      const current = activeDocument(stateRef.current);

      switch (commandId) {
        case 'file.new':
          newDocument();
          break;
        case 'file.open':
          void openFromDialog();
          break;
        case 'file.openUrl':
          setUrlDialogOpen(true);
          break;
        case 'file.clipboard':
          void newFromClipboard();
          break;
        case 'file.save':
          if (current) void saveDocument(current);
          break;
        case 'file.saveAs':
          if (current) void saveDocument(current, true);
          break;
        case 'file.exportHtml':
          void exportHtml();
          break;
        case 'file.print':
          platform.print();
          break;
        case 'file.exit':
          void attemptClose();
          break;
        case 'edit.undo':
          editorRef.current?.undo();
          break;
        case 'edit.redo':
          editorRef.current?.redo();
          break;
        case 'edit.find':
          setReplaceVisible(false);
          setSearchOpen(true);
          break;
        case 'edit.replace':
          setReplaceVisible(true);
          setSearchOpen(true);
          break;
        case 'edit.comment':
          startComment();
          break;
        case 'edit.comment.edit':
          editComment();
          break;
        case 'edit.comment.remove':
          removeComment();
          break;
        case 'edit.comment.removeAll':
          removeAllComments();
          break;
        case 'view.read':
          setMode('read');
          break;
        case 'view.edit':
          setMode('edit');
          break;
        case 'view.split':
          setMode('split');
          break;
        case 'view.toc':
          setTocVisible((value) => !value);
          break;
        case 'view.spellCheck':
          setSpellCheck((value) => !value);
          break;
        case 'view.syncScroll':
          setSyncScroll((value) => !value);
          break;
        case 'view.theme.light':
          setTheme('light');
          break;
        case 'view.theme.dark':
          setTheme('dark');
          break;
        case 'view.theme.system':
          setTheme('system');
          break;
        case 'help.shortcuts':
          setInfoDialog('shortcuts');
          break;
        case 'help.about':
          setInfoDialog('about');
          break;
        default:
          break;
      }
    });

    return dispose;
  }, [
    attemptClose,
    exportHtml,
    newDocument,
    newFromClipboard,
    openFromDialog,
    platform,
    saveDocument,
    startComment,
    editComment,
    removeComment,
    removeAllComments,
  ]);
  /* ------------------------------------------------------- external changes */

  /**
   * Detects files edited by another program. A clean buffer reloads silently; a
   * modified buffer asks first, and keeping the local copy stops the prompt from
   * repeating until the file changes again.
   */
  const checkExternalChanges = useCallback(async () => {
    for (const entry of stateRef.current.docs) {
      if (entry.origin?.kind !== 'file' || entry.diskModifiedAt === null) continue;
      const path = entry.origin.path;

      const modifiedAt = await platform.modifiedTime(path);
      if (modifiedAt === null || modifiedAt <= entry.diskModifiedAt) continue;

      if (isDirty(entry)) {
        const reload = await platform.confirmAction(
          `"${entry.title}" changed on disk. Reload it and discard the changes in this tab?`,
        );
        if (!reload) {
          dispatch({ type: 'touch', id: entry.id, diskModifiedAt: modifiedAt });
          continue;
        }
      }

      try {
        const { text, bom } = await platform.readFile(path);
        const info = detectEncoding(text);
        const source = toEditorText(text);
        dispatch({
          type: 'reload',
          id: entry.id,
          source,
          savedSource: source,
          encoding: { bom, eol: info.eol },
          diskModifiedAt: modifiedAt,
        });
        setMessage(`"${entry.title}" was reloaded from disk.`);
      } catch (error) {
        dispatch({ type: 'status', id: entry.id, status: 'missing', error: describe(error) });
      }
    }
  }, [platform]);

  useEffect(() => {
    const onFocus = () => {
      void checkExternalChanges();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [checkExternalChanges]);

  /* ------------------------------------------------------------------- view */

  const emptyState = (
    <div className="empty-state">
      <h2>No document open</h2>
      <p>Open a Markdown file, drop one onto the window, or start from the clipboard.</p>
      <div className="empty-actions">
        <button type="button" className="button primary" onClick={newDocument}>
          New document
        </button>
        <button type="button" className="button" onClick={() => void openFromDialog()}>
          Browse for file
        </button>
        <button type="button" className="button" onClick={() => setUrlDialogOpen(true)}>
          Open a URL
        </button>
        <button type="button" className="button" onClick={() => void newFromClipboard()}>
          Paste from clipboard
        </button>
      </div>
    </div>
  );

  const gridStyle =
    mode === 'split'
      ? { gridTemplateColumns: `${splitRatio}fr 6px ${1 - splitRatio}fr` }
      : undefined;

  return (
    <PlatformProvider platform={platform}>
      <div className="app" data-mode={mode}>
        <header className="app-header">
          <span className="brand" aria-hidden="true">
            MD
          </span>
          <WorkspaceModeSelector mode={mode} onChange={setMode} disabled={!doc} />
          <Toolbar
            hasDocument={Boolean(doc)}
            saving={saving}
            tocVisible={tocVisible}
            syncScroll={syncScroll}
            theme={theme}
            onNew={() => newDocument()}
            onOpen={() => void openFromDialog()}
            onOpenUrl={() => setUrlDialogOpen(true)}
            onPasteNew={() => void newFromClipboard()}
            onSave={() => doc && void saveDocument(doc)}
            onSaveAs={() => doc && void saveDocument(doc, true)}
            onExportHtml={() => void exportHtml()}
            onCopyHtml={() => void copyRenderedHtml()}
            onPrint={() => platform.print()}
            onToggleToc={() => setTocVisible((value) => !value)}
            onToggleSyncScroll={() => setSyncScroll((value) => !value)}
            onThemeChange={setTheme}
          />
        </header>

        {documents.docs.length > 0 ? (
          <DocumentTabs
            docs={documents.docs}
            activeId={documents.activeId}
            onSelect={(id) => dispatch({ type: 'activate', id })}
            onClose={(id) => void closeDocument(id)}
          />
        ) : null}

        {message ? (
          <div className="notice" role="status">
            <span>{message}</span>
            <button type="button" className="button ghost small" onClick={() => setMessage(null)}>
              Dismiss
            </button>
          </div>
        ) : null}

        <main id="workspace" className="workspace" role="main">
          {tocVisible && previewMode && doc ? (
            <aside className="sidebar">
              <Toc
                headings={headings}
                activeId={activeHeading}
                onNavigate={(id) => viewerRef.current?.scrollToHeading(id)}
              />
            </aside>
          ) : null}

          {doc ? (
          <section className="panes" style={gridStyle}>
            <SelectionContextMenu
              scope={viewerElementRef.current}
              onAddComment={startComment}
              onEditComment={openCommentAt}
              onRemoveComment={removeCommentAt}
            />
            {mode !== 'read' ? (
              <div className="pane pane-editor">
                <Editor
                  ref={editorRef}
                  docId={doc.id}
                  value={doc.source}
                  initialScroll={doc.scroll.editor}
                  onChange={(source) => dispatch({ type: 'edit', id: doc.id, source })}
                  onScroll={onEditorScroll}
                  spellCheck={spellCheck}
                />
              </div>
            ) : null}

            {mode === 'split' ? (
              <SplitDivider ratio={splitRatio} onChange={setSplitRatio} />
            ) : null}

            {previewMode ? (
              <div className="pane pane-viewer">
                <>
                  {render.requiresManualRender ? (
                    <div className="large-doc" role="note">
                      <p>This document is large, so the preview is paused.</p>
                      <button type="button" className="button primary" onClick={render.renderNow}>
                        Render preview
                      </button>
                    </div>
                  ) : null}
                  {(render.output?.placeholders.blockedRemoteImages ?? 0) > 0 && !allowRemoteImages ? (
                    <div className="remote-images" role="note">
                      <p>
                        {render.output?.placeholders.blockedRemoteImages} remote image
                        {(render.output?.placeholders.blockedRemoteImages ?? 0) === 1 ? '' : 's'} not
                        loaded, so this document cannot contact an external server.
                      </p>
                      <button type="button" className="button" onClick={loadRemoteImages}>
                        Load images
                      </button>
                    </div>
                  ) : null}
                  <Viewer
                    ref={viewerRef}
                    containerRef={viewerElementRef}
                    headings={headings}
                    error={render.error}
                    onScroll={onViewerScroll}
                    empty={!render.output && !render.error ? <p className="viewer-loading">Rendering…</p> : undefined}
                  >
                    {render.output ? (
                      <MarkdownView
                        tree={render.output.hast}
                        theme={resolvedTheme}
                        onAnchor={onAnchor}
                      />
                    ) : null}
                  </Viewer>
                </>
              </div>
            ) : null}
          </section>
          ) : (
            <section className="panes">
              <div className="pane pane-empty">{emptyState}</div>
            </section>
          )}

          {searchOpen ? (
            <SearchBar
              query={query}
              caseSensitive={caseSensitive}
              matchCount={searchCount}
              activeIndex={activeMatch}
              onQueryChange={setQuery}
              onToggleCase={() => setCaseSensitive((value) => !value)}
              onNext={() => navigateMatch(1)}
              onPrevious={() => navigateMatch(-1)}
              onClose={closeSearch}
              replaceVisible={replaceVisible}
              replacement={replacement}
              onReplacementChange={setReplacement}
              onReplace={replaceCurrent}
              onReplaceAll={replaceAll}
              replaceDisabled={!canReplace}
            />
          ) : null}
        </main>

        <StatusBar
          doc={doc}
          stats={render.output?.stats ?? null}
          mode={mode}
          rendering={render.rendering}
          message={null}
        />

        {commentDialog ? (
          <CommentDialog
            onCancel={() => setCommentDialog(null)}
            onSubmit={submitComment}
            target={commentDialog.target}
            existing={commentDialog.existing}
            onRemove={commentDialog.block ? removeComment : undefined}
          />
        ) : null}

        {urlDialogOpen ? (
          <UrlDialog
            onCancel={() => {
              setUrlDialogOpen(false);
              setUrlError(null);
            }}
            onOpen={(url) => void openRemote(url)}
            error={urlError}
            busy={urlBusy}
          />
        ) : null}

        {infoDialog ? (
          <InfoDialog kind={infoDialog} onClose={() => setInfoDialog(null)} />
        ) : null}
      </div>
    </PlatformProvider>
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Last non-blank source line before an anchor offset, for the dialog's
 * "Attached after" label. `anchorEnd` may sit on a blank line, so this steps
 * back to the block's first line: naming the last wrapped line of a paragraph
 * would show a mid-sentence fragment instead of the paragraph.
 */
function anchorLabel(source: string, anchorEnd: number): string {
  const lines = source.slice(0, anchorEnd).split('\n');
  let end = lines.length - 1;
  while (end >= 0 && (lines[end] ?? '').trim() === '') end -= 1;
  if (end < 0) return '(start of document)';
  let start = end;
  while (start > 0 && (lines[start - 1] ?? '').trim() !== '') start -= 1;
  const text = (lines[start] ?? '').trim();
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

/**
 * Applies the difference between two whole-document strings as one transaction.
 *
 * Comment removal changes a block and the blank lines around it, which is not a
 * single contiguous slice that is simply deleted (the separator collapses rather
 * than vanishing). Computing the smallest changed range avoids hard-coding which
 * bytes `removeCommentBlock` happened to touch, and keeps the edit undoable as
 * one step instead of replacing the whole buffer.
 */
function applySourceDiff(editor: EditorHandle, previous: string, next: string): void {
  let start = 0;
  const shortest = Math.min(previous.length, next.length);
  while (start < shortest && previous[start] === next[start]) start += 1;

  let endPrevious = previous.length;
  let endNext = next.length;
  while (endPrevious > start && endNext > start && previous[endPrevious - 1] === next[endNext - 1]) {
    endPrevious -= 1;
    endNext -= 1;
  }

  editor.replaceRange(start, endPrevious, next.slice(start, endNext));
}
