/**
 * The document library: state, the save FIFO and the CRUD that the documents
 * overlay, the tool executor and the send path share — lifted from
 * `AppShell.tsx:1011-1016` (state), `:1201-1212` (mutation counter + FIFO)
 * and `:1213-1437` (enqueue, load, change, delete, add, reorder, preview,
 * delete-latch).
 *
 * Adaptations (reported): `bumpEmbedJobGeneration` is gone with the
 * background embed pipeline (nothing to cancel), so an import lands
 * BM25-first; the `onPersistenceFailure` prop is replaced by the old code's
 * own fallback (warn + Alert); `rebuildSemanticIndex` is HELD — it needs the
 * embed job, so the host serves an honest notice instead (§2.7).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  deleteOwnedFile,
  deleteVectorIndexFile,
} from "../documents/documentStorage";
import {
  isDeleteActive,
  tryAcquireDelete,
  releaseDelete,
} from "../documents/docOpGate";
import {
  emptyLibraryState,
  loadLibraryState,
  saveLibraryState,
  reorderDocs,
  getDefaultLibraryStorage,
  type LibraryDoc,
  type LibraryState,
} from "../documents/DocumentLibrary";
import { type TranslateFn } from "../i18n";
import {
  docDenseReasonByIdRef,
  docEmbedHashesByIdRef,
  docIndexByIdRef,
  docSemanticByIdRef,
} from "./docIndexes";

/** Everything the overlays and the executor take from this host. */
export interface LibraryHost {
  library: LibraryState;
  documentLibraryRef: { current: LibraryState };
  addDocument: (entry: LibraryDoc) => boolean;
  deleteDocument: (id: string) => Promise<boolean>;
  reorderDocuments: (orderedIds: string[]) => void;
  updateDocumentPreview: (id: string, previewUri: string) => void;
  isDocumentDeleteInFlight: () => boolean;
}

export function useLibraryHost(t: TranslateFn): LibraryHost {
  const [documentLibrary, setDocumentLibrary] = useState<LibraryState>(() =>
    emptyLibraryState(),
  );
  const documentLibraryRef = useRef<LibraryState>(documentLibrary);
  documentLibraryRef.current = documentLibrary;

  const libraryMutationRef = useRef(0);
  /**
   * FIFO serialized persistence queue (HIGH-5). add → reorder → preview-update
   * → delete writes land at AsyncStorage in order so a slow save cannot
   * overwrite a newer state. Failures retry up to 3 times, then surface via
   * onPersistenceFailure (or console.warn + Alert) — queue keeps draining
   * subsequent saves so one failure never deadlocks the chain (HIGH-3).
   */
  const pendingSavePromiseRef = useRef<Promise<void>>(Promise.resolve());

  const enqueueLibrarySave = useCallback(
    (state: LibraryState) => {
      const run = async () => {
        let attempt = 0;
        let lastErr: unknown;
        while (attempt < 3) {
          try {
            await saveLibraryState(getDefaultLibraryStorage(), state);
            return;
          } catch (err) {
            lastErr = err;
            attempt += 1;
          }
        }
        // 3 retries exhausted — notify without throwing (queue must continue).
        console.warn(
          "[library] persistence failed after 3 retries",
          lastErr,
        );
        try {
          Alert.alert(t("documents.title"), t("documents.errorSave"));
        } catch {
          /* Alert unavailable (tests / headless) — warn already logged */
        }
      };
      pendingSavePromiseRef.current = pendingSavePromiseRef.current
        .then(run, run)
        .catch(() => undefined);
    },
    [t],
  );
  useEffect(() => {
    let mounted = true;
    const loadGen = libraryMutationRef.current;
    void loadLibraryState(getDefaultLibraryStorage())
      .then(async (state) => {
        if (!mounted) return;
        // Drop stale load if the user already added/deleted a doc.
        if (libraryMutationRef.current !== loadGen) {
          return;
        }
        setDocumentLibrary(state);
        // FIX D: NO startup vector restore. Parsing every .vec.json on the JS
        // thread stalls the UI and spikes memory for large libraries. Vectors
        // are restored lazily per doc on the first hybrid query (see
        // ensureSemanticIndexLoaded). Memory policy: cap total loaded floats
        // (VECTOR_MEMORY_FLOAT_CAP); beyond → leave that doc BM25-only.
      })
      .catch(() => {
        /* keep empty library on load failure */
      });
    return () => {
      mounted = false;
    };
  }, []);
  const handleLibraryChange = useCallback((next: LibraryState) => {
    // Refuse library mutations (import/add) while a delete is in flight so a
    // fresh import cannot race the old deleteAsync / functional drop.
    if (isDeleteActive()) {
      return;
    }
    libraryMutationRef.current += 1;
    // Drop indexes for removed docs so delete frees retrieval memory.
    const nextIds = new Set((next.docs ?? []).map((d) => d.id));
    for (const id of docIndexByIdRef.current.keys()) {
      if (!nextIds.has(id)) docIndexByIdRef.current.delete(id);
    }
    for (const id of docSemanticByIdRef.current.keys()) {
      if (!nextIds.has(id)) {
        docSemanticByIdRef.current.delete(id);
        docEmbedHashesByIdRef.current.delete(id);
        docDenseReasonByIdRef.current.delete(id);
      }
    }
    for (const id of docDenseReasonByIdRef.current.keys()) {
      if (!nextIds.has(id)) docDenseReasonByIdRef.current.delete(id);
    }
    setDocumentLibrary(next);
    enqueueLibrarySave(next);
  }, [enqueueLibrarySave]);
  /**
   * AppShell-owned document delete. Shared docOpGate DELETE + FS delete + index
   * drop + functional state update all live here so DocumentsScreen unmount
   * cannot clear the guard or capture a stale `library` snapshot.
   * @returns false when refused (any document op already in flight).
   */
  const deleteDocument = useCallback(async (id: string): Promise<boolean> => {
    if (!id || typeof id !== "string") return false;
    // Shared gate: refuse while a read (document_chat) OR another delete is active.
    if (!tryAcquireDelete()) return false;
    try {
      // Resolve CURRENT library snapshot — never a captured prop.
      const current = documentLibraryRef.current;
      const doc = (current.docs ?? []).find((d) => d.id === id);
      if (doc?.fileUri) {
        await deleteOwnedFile(doc.fileUri);
      }
      // Drop durable page-1 cover JPEG (owned under kalsa-covers/).
      if (doc?.previewUri) {
        await deleteOwnedFile(doc.previewUri);
      }
      // Drop durable dense-vector sidecar alongside the owned file.
      await deleteVectorIndexFile(id);
      // Drop retrieval + semantic indexes for this id (best-effort; functional
      // filter below is the source of truth for the list).
      docIndexByIdRef.current.delete(id);
      docSemanticByIdRef.current.delete(id);
      docEmbedHashesByIdRef.current.delete(id);
      docDenseReasonByIdRef.current.delete(id);
      libraryMutationRef.current += 1;
      // Gate blocks handleLibraryChange, so ref is current. Functional updater
      // still guards against any non-import concurrent React state write.
      const next: LibraryState = {
        docs: (documentLibraryRef.current.docs ?? []).filter((d) => d.id !== id),
      };
      documentLibraryRef.current = next;
      setDocumentLibrary((prev) => ({
        docs: (prev.docs ?? []).filter((d) => d.id !== id),
      }));
      enqueueLibrarySave(next);
      return true;
    } finally {
      releaseDelete();
    }
  }, [enqueueLibrarySave]);
  /**
   * AppShell-owned document add (import commit). Prepends (new-on-top).
   * Invariant: every library mutation (add + delete) is owned by AppShell,
   * applied against current ref state with a functional updater; screens never
   * merge snapshots. A screen-captured `library` prop must not re-add a doc
   * that was deleted while import was in flight.
   * @returns false when refused (delete gate held — screen surfaces busy).
   */
  const addDocument = useCallback((entry: LibraryDoc): boolean => {
    if (!entry || typeof entry.id !== "string" || entry.id.length === 0) {
      return false;
    }
    if (isDeleteActive()) return false;
    libraryMutationRef.current += 1;
    // Atomic commit against CURRENT state — never a screen-captured snapshot.
    // Prepend: newest import sits at the top of the list (CRIT-3).
    const next: LibraryState = {
      docs: [entry, ...(documentLibraryRef.current.docs ?? [])],
    };
    documentLibraryRef.current = next;
    // Functional updater is the authoritative React commit.
    setDocumentLibrary((prev) => ({
      docs: [entry, ...(prev.docs ?? [])],
    }));
    enqueueLibrarySave(next);
    return true;
  }, [enqueueLibrarySave]);
  /**
   * Reorder library docs by id permutation. Malformed orderedIds are a no-op
   * (reorderDocs pure contract). Persistence goes through the FIFO queue.
   */
  const reorderDocuments = useCallback(
    (orderedIds: string[]): void => {
      if (!Array.isArray(orderedIds) || orderedIds.length === 0) return;
      if (isDeleteActive()) return;
      const prev = documentLibraryRef.current;
      const next = reorderDocs(prev, orderedIds);
      // No-op when pure helper refused OR order already matches (same ids).
      const prevIds = (prev.docs ?? []).map((d) => d.id).join("\0");
      const nextIds = (next.docs ?? []).map((d) => d.id).join("\0");
      if (prevIds === nextIds) return;
      libraryMutationRef.current += 1;
      documentLibraryRef.current = next;
      setDocumentLibrary(next);
      enqueueLibrarySave(next);
    },
    [enqueueLibrarySave],
  );

  /**
   * Commit a durable cover URI onto an existing library entry. Refuses when
   * the doc is gone (generation / delete race). Functional updater + queue.
   */
  const updateDocumentPreview = useCallback(
    (id: string, previewUri: string): void => {
      if (!id || typeof id !== "string" || id.length === 0) return;
      if (!previewUri || typeof previewUri !== "string") return;
      if (isDeleteActive()) return;
      const current = documentLibraryRef.current;
      if (!(current.docs ?? []).some((d) => d.id === id)) return;
      libraryMutationRef.current += 1;
      const next: LibraryState = {
        docs: (current.docs ?? []).map((d) =>
          d.id === id ? { ...d, previewUri } : d,
        ),
      };
      documentLibraryRef.current = next;
      setDocumentLibrary((prev) => ({
        docs: (prev.docs ?? []).map((d) =>
          d.id === id ? { ...d, previewUri } : d,
        ),
      }));
      enqueueLibrarySave(next);
    },
    [enqueueLibrarySave],
  );

  const isDocumentDeleteInFlightCb = useCallback(() => isDeleteActive(), []);

  return {
    library: documentLibrary,
    documentLibraryRef,
    addDocument,
    deleteDocument,
    reorderDocuments,
    updateDocumentPreview,
    isDocumentDeleteInFlight: isDocumentDeleteInFlightCb,
  };
}
