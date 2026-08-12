/**
 * Page-1 cover generation for PDF library entries.
 *
 * PdfToImages writes temp JPEGs under cacheDirectory (evictable). This module
 * resizes page 0 to coverRenderWidth and commits a durable copy under
 * documentDirectory/kalsa-covers/<docId>.jpg. Failures degrade silently to
 * the tinted FileText placeholder (caller treats null as "no cover").
 *
 * Host pattern mirrors pdfTextService: a mount-once React host drives the
 * WebView; generateCoverForDoc is the promise API for DocumentsScreen.
 */

import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";

import { PdfToImages } from "../components/PdfToImages";
import { tryAcquireRead, releaseRead } from "./docOpGate";
import {
  coverPath,
  ensureCoversDir,
  deleteOwnedFile,
} from "./documentStorage";
import type { LibraryDoc } from "./DocumentLibrary";

/** 4× list display width (56 px) for HiDPI sharpness — plan §5 HIGH-6. */
export const COVER_RENDER_WIDTH = 224;

/** Soft cap so a hung WebView cannot pin the import overlay forever. */
const COVER_TIMEOUT_MS = 45_000;

export type GenerateCoverOpts = {
  signal?: AbortSignal;
  /**
   * Optional gate override (tests). Default uses module docOpGate READ latch.
   * acquireRead returns false when the latch is held → generateCoverForDoc
   * returns null without waiting.
   */
  gate?: {
    acquireRead(): boolean;
    releaseRead(): void;
  };
  /** Re-check that the doc still exists right before the durable write. */
  libraryHas?: (docId: string) => boolean;
};

type CoverHostRequest = {
  id: number;
  fileUri: string;
  docId: string;
  gen: number;
};

type HostBridge = {
  setRequest: (req: CoverHostRequest | null) => void;
};

type Inflight = {
  id: number;
  docId: string;
  gen: number;
  resolve: (uri: string | null) => void;
  settled: boolean;
  timer: ReturnType<typeof setTimeout>;
  onAbort?: () => void;
  signal?: AbortSignal;
  libraryHas?: (docId: string) => boolean;
  /**
   * Durable JPEG write started from onPage(0). Gate must stay held until this
   * settles — onDone / timeout / abort / error await it before settle().
   */
  commitPromise: Promise<string | null> | null;
};

let host: HostBridge | null = null;
let seq = 0;
/** Generation counter — late onPage with a stale gen aborts without writing. */
let inflightCoverGen = 0;
let inflight: Inflight | null = null;

export function registerCoverHost(bridge: HostBridge): () => void {
  host = bridge;
  return () => {
    if (host !== bridge) return;
    host = null;
    settle(null);
  };
}

function settle(uri: string | null): void {
  const cur = inflight;
  if (!cur || cur.settled) return;
  cur.settled = true;
  try {
    clearTimeout(cur.timer);
  } catch {
    /* ignore */
  }
  if (cur.signal && cur.onAbort) {
    try {
      cur.signal.removeEventListener("abort", cur.onAbort);
    } catch {
      /* ignore */
    }
  }
  inflight = null;
  try {
    host?.setRequest(null);
  } catch {
    /* ignore */
  }
  cur.resolve(uri);
}

/**
 * Generate a durable page-1 cover for a PDF library entry.
 * Returns the durable file URI, or null on any failure / non-PDF / busy gate.
 */
export async function generateCoverForDoc(
  doc: LibraryDoc,
  opts?: GenerateCoverOpts,
): Promise<string | null> {
  if (!doc || doc.kind !== "pdf" || !doc.fileUri || !doc.id) return null;
  if (!host) return null;
  if (inflight && !inflight.settled) return null;

  const gate = opts?.gate ?? {
    acquireRead: tryAcquireRead,
    releaseRead,
  };
  if (!gate.acquireRead()) return null;

  inflightCoverGen += 1;
  const gen = inflightCoverGen;
  const id = ++seq;
  const signal = opts?.signal;

  return new Promise<string | null>((resolve) => {
    const releaseAndResolve = (uri: string | null) => {
      try {
        gate.releaseRead();
      } catch {
        /* ignore */
      }
      resolve(uri);
    };

    if (signal?.aborted) {
      releaseAndResolve(null);
      return;
    }

    /**
     * Await any in-flight durable commit, then settle. Used by timeout / abort
     * so the gate is never released while ImageManipulator / copyAsync runs.
     * Bumping inflightCoverGen first makes a mid-flight commit abandon the write.
     */
    const awaitCommitThenSettle = (markStale: boolean) => {
      void (async () => {
        const cur = inflight;
        if (!cur || cur.settled || cur.id !== id) return;
        if (markStale) {
          // Generation-bound: commitCoverFromTemp re-checks and cleans temps.
          inflightCoverGen += 1;
        }
        let uri: string | null = null;
        if (cur.commitPromise) {
          uri = await Promise.resolve(cur.commitPromise).catch(() => null);
        }
        // Only settle this generation — a newer request must not be released.
        if (inflight === cur && !cur.settled) {
          settle(markStale ? null : uri);
        }
      })();
    };

    const timer = setTimeout(() => {
      awaitCommitThenSettle(true);
    }, COVER_TIMEOUT_MS);

    const entry: Inflight = {
      id,
      docId: doc.id,
      gen,
      resolve: releaseAndResolve,
      settled: false,
      timer,
      signal,
      libraryHas: opts?.libraryHas,
      commitPromise: null,
    };

    if (signal) {
      const onAbort = () => {
        awaitCommitThenSettle(true);
      };
      entry.onAbort = onAbort;
      try {
        signal.addEventListener("abort", onAbort, { once: true });
      } catch {
        /* ignore */
      }
    }

    inflight = entry;
    try {
      host?.setRequest({
        id,
        fileUri: doc.fileUri,
        docId: doc.id,
        gen,
      });
    } catch {
      settle(null);
    }
  });
}

async function commitCoverFromTemp(
  tempUri: string,
  docId: string,
  gen: number,
  libraryHas?: (id: string) => boolean,
): Promise<string | null> {
  // Generation-bound: a late onPage after a newer start must not write.
  if (gen !== inflightCoverGen) {
    try {
      await FileSystem.deleteAsync(tempUri, { idempotent: true });
    } catch {
      /* ignore */
    }
    return null;
  }
  if (libraryHas && !libraryHas(docId)) {
    try {
      await FileSystem.deleteAsync(tempUri, { idempotent: true });
    } catch {
      /* ignore */
    }
    return null;
  }

  try {
    await ensureCoversDir();
    const dest = coverPath(docId);

    // Resize to coverRenderWidth before durable write (HIGH-6 memory bound).
    const manipulated = await ImageManipulator.manipulateAsync(
      tempUri,
      [{ resize: { width: COVER_RENDER_WIDTH } }],
      { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG },
    );

    // Re-check gen + library after the async resize.
    if (gen !== inflightCoverGen) {
      try {
        await FileSystem.deleteAsync(manipulated.uri, { idempotent: true });
      } catch {
        /* ignore */
      }
      return null;
    }
    if (libraryHas && !libraryHas(docId)) {
      try {
        await FileSystem.deleteAsync(manipulated.uri, { idempotent: true });
      } catch {
        /* ignore */
      }
      return null;
    }

    // Replace any previous cover for this id.
    await deleteOwnedFile(dest);
    await FileSystem.copyAsync({ from: manipulated.uri, to: dest });

    // Cleanup temp cache JPEG + manipulator output (best-effort).
    try {
      await FileSystem.deleteAsync(tempUri, { idempotent: true });
    } catch {
      /* ignore */
    }
    if (manipulated.uri !== dest && manipulated.uri !== tempUri) {
      try {
        await FileSystem.deleteAsync(manipulated.uri, { idempotent: true });
      } catch {
        /* ignore */
      }
    }
    return dest;
  } catch {
    try {
      await FileSystem.deleteAsync(tempUri, { idempotent: true });
    } catch {
      /* ignore */
    }
    return null;
  }
}

/**
 * Mount-once host that drives PdfToImages mode="images" maxPages={1}.
 * Renders nothing visible; unmounts the WebView as soon as page 0 lands.
 */
export function DocumentCoverHost(): React.ReactElement | null {
  const [request, setRequest] = useState<CoverHostRequest | null>(null);

  useEffect(() => registerCoverHost({ setRequest }), []);

  if (!request) return null;

  return (
    <View
      style={styles.hidden}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <PdfToImages
        key={request.id}
        pdfUri={request.fileUri}
        mode="images"
        maxPages={1}
        onPage={(pageIndex, imageUri) => {
          if (pageIndex !== 0) return;
          const cur = inflight;
          if (!cur || cur.settled || cur.id !== request.id) {
            void FileSystem.deleteAsync(imageUri, { idempotent: true }).catch(
              () => undefined,
            );
            return;
          }
          if (cur.gen !== request.gen || cur.gen !== inflightCoverGen) {
            void FileSystem.deleteAsync(imageUri, { idempotent: true }).catch(
              () => undefined,
            );
            settle(null);
            return;
          }
          // Start durable write but do NOT settle yet — gate stays held until
          // onDone / timeout / abort awaits commitPromise (CRIT-1).
          if (cur.commitPromise) {
            // Already committing page 0; drop duplicate.
            void FileSystem.deleteAsync(imageUri, { idempotent: true }).catch(
              () => undefined,
            );
            return;
          }
          cur.commitPromise = commitCoverFromTemp(
            imageUri,
            request.docId,
            request.gen,
            cur.libraryHas,
          );
        }}
        onDone={() => {
          // Await durable commit (if onPage started one) before releasing gate.
          void (async () => {
            const cur = inflight;
            if (!cur || cur.settled || cur.id !== request.id) return;
            let uri: string | null = null;
            if (cur.commitPromise) {
              uri = await Promise.resolve(cur.commitPromise).catch(() => null);
            }
            // If page 0 never arrived, uri stays null (placeholder).
            if (inflight === cur && !cur.settled) {
              settle(uri);
            }
          })();
        }}
        onError={() => {
          // Same ordering as onDone: drain commit before gate release.
          void (async () => {
            const cur = inflight;
            if (!cur || cur.settled || cur.id !== request.id) return;
            if (cur.commitPromise) {
              await Promise.resolve(cur.commitPromise).catch(() => null);
            }
            if (inflight === cur && !cur.settled) {
              settle(null);
            }
          })();
        }}
      />
    </View>
  );
}

/** Test-only: force-clear inflight cover state. */
export function __resetCoverHostForTests(): void {
  if (inflight && !inflight.settled) {
    try {
      clearTimeout(inflight.timer);
    } catch {
      /* ignore */
    }
    inflight.settled = true;
    inflight.resolve(null);
  }
  inflight = null;
  host = null;
}

const styles = StyleSheet.create({
  hidden: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
    overflow: "hidden",
  },
});
