/**
 * Mount-once host that drives PdfToImages in text-only mode for requestPdfText().
 * Renders nothing visible; unmounts the WebView as soon as text docs arrive.
 * No JPEG rasterize — tool results cannot attach images to the model.
 */

import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { PdfExtractError, PdfToImages } from "../components/PdfToImages";
import {
  PdfTextServiceError,
  registerPdfTextHost,
  rejectPdfTextRequest,
  resolvePdfTextRequest,
  type PdfTextHostRequest,
} from "./pdfTextService";

/** Age gate for best-effort orphaned cache cleanup (process kill mid-extract). */
const STALE_CACHE_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

const STALE_CACHE_PREFIXES = ["web-fetch-pdf-", "pdf-page-"] as const;

/**
 * Best-effort sweep of orphaned PDF/JPEG cache files left by process kills.
 * Age-gated so in-flight extracts are not deleted. Never throws to the UI.
 */
async function sweepStalePdfCacheFiles(): Promise<void> {
  const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
  if (!dir) return;
  try {
    const names = await FileSystem.readDirectoryAsync(dir);
    const now = Date.now();
    await Promise.all(
      names.map(async (name) => {
        if (!STALE_CACHE_PREFIXES.some((p) => name.startsWith(p))) return;
        const uri = `${dir}${name}`;
        try {
          const info = await FileSystem.getInfoAsync(uri);
          if (!info.exists || info.isDirectory) return;
          const mod =
            typeof (info as { modificationTime?: number }).modificationTime ===
            "number"
              ? (info as { modificationTime: number }).modificationTime * 1000
              : 0;
          // If mtime is missing/0, still delete only files that look like ours
          // and are older than the age gate when mtime is available; without
          // mtime, skip to avoid racing an in-flight write.
          if (!mod) return;
          if (now - mod < STALE_CACHE_MAX_AGE_MS) return;
          await FileSystem.deleteAsync(uri, { idempotent: true });
        } catch {
          /* best-effort */
        }
      }),
    );
  } catch {
    /* best-effort */
  }
}

export function PdfTextExtractorHost() {
  const [request, setRequest] = useState<PdfTextHostRequest | null>(null);

  useEffect(() => {
    void sweepStalePdfCacheFiles();
    return registerPdfTextHost({ setRequest });
  }, []);

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
        mode="text"
        sourceId={request.sourceId}
        title={request.title}
        onPage={() => {
          /* Text-only mode never delivers pages; keep required prop. */
        }}
        onDone={() => {
          /* resolve/reject already handled via onTextDocs / onError. */
        }}
        onError={(error) => {
          // Map typed component codes without matching localized strings.
          if (error instanceof PdfExtractError) {
            if (error.code === "timeout" || error.code === "page_timeout") {
              rejectPdfTextRequest(
                request.id,
                new PdfTextServiceError("timeout", error.message),
              );
              return;
            }
            if (error.code === "renderer_gone") {
              rejectPdfTextRequest(
                request.id,
                new PdfTextServiceError("renderer_gone", error.message),
              );
              return;
            }
          }
          rejectPdfTextRequest(request.id, error);
        }}
        onTextDocs={(result) => {
          resolvePdfTextRequest(request.id, result);
        }}
      />
    </View>
  );
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
