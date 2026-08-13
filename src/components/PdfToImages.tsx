import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system/legacy";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { useLocale } from "../i18n";
import { useTypography } from "../theme/typography";
import { useLabTheme } from "../ui/labTheme";
import {
  pageHasTextLayer,
  pdfPagesToRetrievalDocs,
  reconstructPageText,
  type PdfPageText,
  type PdfRetrievalDocsResult,
  type PdfTextItem,
} from "../util/pdfText";
import {
  CHUNK_SIZE,
  MAX_CHUNKS_PER_PAGE,
  MAX_ITEM_STR_CHARS,
  MAX_ITEMS_PER_PAGE,
  MAX_PAGE_PAYLOAD_BYTES,
  MAX_PDF_PAGES,
  PAGE_TIMEOUT_MS,
  TOTAL_EXTRACTION_TIMEOUT_MS,
  PdfBridgeAccumulator,
  clampMaxPages,
  parseBridgeMessage,
  reconcileTextPassPages,
  sanitizePdfSourceId,
  type TextPageMeta,
} from "../util/pdfBridgeProtocol";

/**
 * PdfToImages — renderizza un PDF locale in immagini JPEG (max 5 pagine)
 * usando pdf.js v3.11 (UMD) in una WebView dedicata.
 *
 * Design (piano V2, review ostile):
 * - pdf.min.js / pdf.worker.min.js vendored come asset `.txt` (Metro li tratta
 *   come asset, non moduli) e iniettati come stringa nell'html
 * - worker: Blob URL (`worker-src blob:` implicito — nessuna CSP esterna,
 *   la WebView è dedicata e non carica risorse di rete)
 * - PDF trasferito come base64 iniettato (URI locali `file://` letti da RN —
 *   risolve anche eventuali `content://` già copiati in cache dal picker)
 * - bridge chunked (200KB) con sequenza pagine → file JPEG in cacheDir
 * - timeout per pagina (30s), cap pagine, destroy del documento a fine lavoro
 * - JPEG cache files (`pdf-page-N-<ts>.jpg`) are deleted on failure and on
 *   unmount; on success they are left for the parent (attachment flow). This
 *   was pre-existing; success cleanup would race the parent reading the URI.
 *
 * Phase B (opt-in `mode="textWithImageFallback"`):
 * - same WebView / one pdf.js load / one parse
 * - text items streamed first; RN reconstructs via pdfText.ts
 * - pages without a usable text layer are rasterized in-place via injectJavaScript
 * - image-only default path must not regress (cap fail-closed, in-flight writes)
 *
 * `mode="text"`: text layer only — no JPEG rasterize (tool path; images cannot
 * reach the model from a tool result).
 */

export type PdfExtractMode = "images" | "textWithImageFallback" | "text";

function isTextExtractMode(mode: PdfExtractMode): boolean {
  return mode === "textWithImageFallback" || mode === "text";
}

/**
 * Typed extract failure so the tool host can map timeouts without matching
 * localized strings (substring matching was removed from mapPdfExtractError).
 */
export type PdfExtractErrorCode =
  | "timeout"
  | "page_timeout"
  | "cap"
  | "renderer_gone"
  | "failed";

export class PdfExtractError extends Error {
  readonly code: PdfExtractErrorCode;

  constructor(code: PdfExtractErrorCode, message: string) {
    super(message);
    this.name = "PdfExtractError";
    this.code = code;
  }
}

/** Per-page instrumentation (Hermes reconstructPageText ms + WebView getTextContent). */
export type PdfPageExtractMetrics = {
  pageNumber: number;
  getTextContentMs: number;
  itemCount: number;
  projectedBytes: number;
  /** Wall time of `reconstructPageText` only (not pageHasTextLayer / tidy batch). */
  reconstructMs: number;
  hasTextLayer: boolean;
};

export type PdfDocumentExtractMetrics = {
  pageCount: number;
  totalItems: number;
  totalProjectedBytes: number;
  totalReconstructMs: number;
  totalGetTextContentMs: number;
  skippedPages: number[];
  pages: PdfPageExtractMetrics[];
};

type Props = {
  pdfUri: string;
  maxPages?: number;
  maxBytes?: number;
  /**
   * `images` (default): JPEG only — production call site path.
   * `textWithImageFallback`: text layer first, JPEG only for skipped pages.
   */
  mode?: PdfExtractMode;
  onPage: (pageIndex: number, imageUri: string) => void;
  onDone: () => void;
  onError: (error: Error) => void;
  /** Text mode: one call per page after reconstruction. pageIndex is 0-based. */
  onPageText?: (pageIndex: number, text: string, hasTextLayer: boolean) => void;
  /**
   * Text mode: final retrieval docs from `pdfPagesToRetrievalDocs`.
   * Fired once after the text pass (before image fallback completes).
   */
  onTextDocs?: (result: PdfRetrievalDocsResult) => void;
  /**
   * Source id for retrieval docIds. Defaults to a sanitized basename of pdfUri
   * (never the full filesystem path — privacy).
   */
  sourceId?: string;
  /** Optional title for retrieval docs. */
  title?: string | null;
  /** Optional per-document metrics (also logged with `[pdf-extract]` prefix). */
  onExtractMetrics?: (metrics: PdfDocumentExtractMetrics) => void;
  /** Hide the status row (hosts already wrap an off-screen WebView). */
  headless?: boolean;
};

const DEFAULT_MAX_PAGES = MAX_PDF_PAGES;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

export function PdfToImages({
  pdfUri,
  maxPages = DEFAULT_MAX_PAGES,
  maxBytes = DEFAULT_MAX_BYTES,
  mode = "images",
  onPage,
  onDone,
  onError,
  onPageText,
  onTextDocs,
  sourceId,
  title,
  onExtractMetrics,
  headless = false,
}: Props) {
  const { t } = useLocale();
  const { colors } = useLabTheme<{
    colors: { panel: string; ink: string; muted: string; bad: string };
  }>();
  const typography = useTypography();
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const webViewRef = useRef<WebView>(null);
  const doneRef = useRef(false);
  const pageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const totalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const accRef = useRef(new PdfBridgeAccumulator({ maxPages: clampMaxPages(maxPages) }));
  const textPagesRef = useRef<
    Map<number, { items: PdfTextItem[]; meta: TextPageMeta; reconstructMs: number; text: string }>
  >(new Map());
  const textDocsEmittedRef = useRef(false);
  /** Uncapped pdf.numPages from textPassDone, when reported. */
  const documentPageCountRef = useRef<number | null>(null);
  const rasterizeInjectedRef = useRef(false);
  const metricsPagesRef = useRef<PdfPageExtractMetrics[]>([]);
  /** In-flight JPEG writes — global done must wait (image-mode last-page race). */
  const inFlightWritesRef = useRef(0);
  const pendingGlobalDoneRef = useRef(false);
  /** URIs created this run — deleted on fail / unmount-before-success only. */
  const createdImageUrisRef = useRef<string[]>([]);
  /** After successful onDone, parent owns the JPEGs — do not delete them. */
  const succeededRef = useRef(false);

  const clearTimers = () => {
    if (pageTimerRef.current) {
      clearTimeout(pageTimerRef.current);
      pageTimerRef.current = null;
    }
    if (totalTimerRef.current) {
      clearTimeout(totalTimerRef.current);
      totalTimerRef.current = null;
    }
  };

  const deleteCreatedImages = useCallback(() => {
    const uris = createdImageUrisRef.current.slice();
    createdImageUrisRef.current = [];
    for (const uri of uris) {
      void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {
        /* best-effort */
      });
    }
  }, []);

  const fail = useCallback(
    (message: string, code: PdfExtractErrorCode = "failed") => {
      if (doneRef.current) return;
      doneRef.current = true;
      pendingGlobalDoneRef.current = false;
      clearTimers();
      deleteCreatedImages();
      setError(message);
      onError(new PdfExtractError(code, message));
    },
    [deleteCreatedImages, onError],
  );

  const finishDone = useCallback(() => {
    if (doneRef.current) return;
    // Wait for in-flight JPEG writes so the last onPage is never dropped.
    if (inFlightWritesRef.current > 0) {
      pendingGlobalDoneRef.current = true;
      return;
    }
    doneRef.current = true;
    pendingGlobalDoneRef.current = false;
    succeededRef.current = true;
    // Parent owns successful page URIs — release tracking without deleting.
    createdImageUrisRef.current = [];
    clearTimers();
    onDone();
  }, [onDone]);

  // Carica gli asset pdf.js + il PDF (base64) e compone l'html della WebView.
  useEffect(() => {
    let mounted = true;
    // U2 defense in depth: even if this instance were ever reused across a
    // different pdfUri (normally prevented by `key={pdfUri}` at the call
    // site), reset all per-document state so a stale doneRef never swallows
    // the new document's completion/errors.
    doneRef.current = false;
    succeededRef.current = false;
    pendingGlobalDoneRef.current = false;
    inFlightWritesRef.current = 0;
    const pages = clampMaxPages(maxPages);
    accRef.current = new PdfBridgeAccumulator({ maxPages: pages });
    textPagesRef.current = new Map();
    textDocsEmittedRef.current = false;
    documentPageCountRef.current = null;
    rasterizeInjectedRef.current = false;
    metricsPagesRef.current = [];
    deleteCreatedImages();
    setError(null);
    setHtml(null);
    clearTimers();
    void (async () => {
      try {
        const [pdfSrc, workerSrc, pdfB64] = await Promise.all([
          readAsset(require("../../assets/pdfjs/pdf.min.js.txt")),
          readAsset(require("../../assets/pdfjs/pdf.worker.min.js.txt")),
          FileSystem.readAsStringAsync(pdfUri, { encoding: FileSystem.EncodingType.Base64 }),
        ]);
        if (!mounted) return;
        if (pdfB64.length > maxBytes * 1.34) {
          fail(t("errors.pdfTooLarge"), "cap");
          return;
        }
        if (isTextExtractMode(mode)) {
          setHtml(buildPdfHtmlTextMode(pdfSrc, workerSrc, pdfB64, pages));
        } else {
          setHtml(buildPdfHtml(pdfSrc, workerSrc, pdfB64, pages));
        }
      } catch (e) {
        if (mounted) fail(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      mounted = false;
      clearTimers();
      // Unmount before success: trip doneRef so late JPEG .then deletes
      // instead of calling onPage, and drop already-tracked orphans.
      if (!succeededRef.current) {
        doneRef.current = true;
        pendingGlobalDoneRef.current = false;
        deleteCreatedImages();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfUri, mode, maxPages]);

  const armPageTimer = useCallback(() => {
    if (pageTimerRef.current) clearTimeout(pageTimerRef.current);
    pageTimerRef.current = setTimeout(
      () => fail(t("errors.pdfTimeout"), "page_timeout"),
      PAGE_TIMEOUT_MS,
    );
  }, [fail, t]);

  const armTotalTimer = useCallback(() => {
    if (totalTimerRef.current) clearTimeout(totalTimerRef.current);
    totalTimerRef.current = setTimeout(
      () => fail(t("errors.pdfExtractTimeout"), "timeout"),
      TOTAL_EXTRACTION_TIMEOUT_MS,
    );
  }, [fail, t]);

  const emitTextDocsAndMaybeRasterize = useCallback(
    (pageTexts: PdfPageText[]) => {
      if (textDocsEmittedRef.current) return;
      textDocsEmittedRef.current = true;

      const sid = sanitizePdfSourceId(pdfUri, sourceId);
      const base = pdfPagesToRetrievalDocs(sid, title, pageTexts);
      const docPages = documentPageCountRef.current;
      const result: PdfRetrievalDocsResult = {
        ...base,
        ...(typeof docPages === "number" && docPages > 0
          ? { documentPageCount: docPages }
          : {}),
      };

      const pages = metricsPagesRef.current.slice().sort((a, b) => a.pageNumber - b.pageNumber);
      const metrics: PdfDocumentExtractMetrics = {
        pageCount: pages.length,
        totalItems: pages.reduce((s, p) => s + p.itemCount, 0),
        totalProjectedBytes: pages.reduce((s, p) => s + p.projectedBytes, 0),
        totalReconstructMs: pages.reduce((s, p) => s + p.reconstructMs, 0),
        totalGetTextContentMs: pages.reduce((s, p) => s + p.getTextContentMs, 0),
        skippedPages: result.skippedPages.slice(),
        pages,
      };
      console.log(
        `[pdf-extract] pages=${metrics.pageCount} items=${metrics.totalItems} ` +
          `projectedBytes=${metrics.totalProjectedBytes} reconstructMs=${metrics.totalReconstructMs} ` +
          `getTextContentMs=${metrics.totalGetTextContentMs} skipped=${metrics.skippedPages.length}` +
          (result.documentPageCount != null
            ? ` documentPageCount=${result.documentPageCount}`
            : ""),
      );
      onExtractMetrics?.(metrics);
      onTextDocs?.(result);

      // Text-only mode (tool path): never rasterize skipped pages — JPEGs cannot
      // reach the model from a tool result, and late writes can orphan files.
      if (mode === "text" || result.skippedPages.length === 0) {
        finishDone();
        return;
      }

      if (rasterizeInjectedRef.current) return;
      rasterizeInjectedRef.current = true;
      const pagesJson = JSON.stringify(result.skippedPages);
      webViewRef.current?.injectJavaScript(
        `try{if(typeof window.__pdfRasterizePages==="function"){window.__pdfRasterizePages(${pagesJson});}else{window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({error:"rasterize_unavailable"}));}}catch(e){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({error:String((e&&e.message)||e)}));}true;`,
      );
      armPageTimer();
    },
    [
      armPageTimer,
      finishDone,
      mode,
      onExtractMetrics,
      onTextDocs,
      pdfUri,
      sourceId,
      title,
    ],
  );

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      if (doneRef.current) return;

      const parsed = parseBridgeMessage(event.nativeEvent.data);
      if (!parsed.ok) {
        // Cap exceeded → fail-closed (never silent page drop). Malformed → ignore.
        if (parsed.category === "cap") {
          fail(t("errors.pdfExtractCap", { reason: parsed.reason }), "cap");
        }
        return;
      }

      if (pageTimerRef.current) clearTimeout(pageTimerRef.current);

      const eventOut = accRef.current.feed(parsed.message);

      if (eventOut.type === "error") {
        fail(eventOut.error);
        return;
      }
      if (eventOut.type === "cap_exceeded") {
        fail(t("errors.pdfExtractCap", { reason: eventOut.reason }), "cap");
        return;
      }

      if (eventOut.type === "text_page") {
        const t0 =
          typeof performance !== "undefined" && typeof performance.now === "function"
            ? performance.now()
            : Date.now();
        // Measure reconstructPageText only (Hermes string-building cost).
        const text = reconstructPageText(eventOut.items);
        const t1 =
          typeof performance !== "undefined" && typeof performance.now === "function"
            ? performance.now()
            : Date.now();
        const reconstructMs = Math.max(0, t1 - t0);
        const hasTextLayer = pageHasTextLayer(text);

        textPagesRef.current.set(eventOut.page, {
          items: eventOut.items,
          meta: eventOut.meta,
          reconstructMs,
          text,
        });
        metricsPagesRef.current.push({
          pageNumber: eventOut.page,
          getTextContentMs: eventOut.meta.getTextContentMs,
          itemCount: eventOut.meta.itemCount || eventOut.items.length,
          projectedBytes: eventOut.meta.projectedBytes,
          reconstructMs,
          hasTextLayer,
        });
        onPageText?.(eventOut.page - 1, text, hasTextLayer);
        armPageTimer();
        return;
      }

      if (eventOut.type === "text_pass_done") {
        if (
          typeof eventOut.documentPageCount === "number" &&
          Number.isFinite(eventOut.documentPageCount) &&
          eventOut.documentPageCount > 0
        ) {
          documentPageCountRef.current = Math.floor(eventOut.documentPageCount);
        }
        const completed = Array.from(textPagesRef.current.keys());
        const { missing, expected } = reconcileTextPassPages(
          completed,
          eventOut.pageCount,
        );
        // Pages the WebView said it processed but RN never completed → empty
        // text so they land in skippedPages and get image fallback (not a hole).
        for (const p of missing) {
          textPagesRef.current.set(p, {
            items: [],
            meta: {
              getTextContentMs: 0,
              itemCount: 0,
              projectedBytes: 0,
            },
            reconstructMs: 0,
            text: "",
          });
          metricsPagesRef.current.push({
            pageNumber: p,
            getTextContentMs: 0,
            itemCount: 0,
            projectedBytes: 0,
            reconstructMs: 0,
            hasTextLayer: false,
          });
        }
        // Never emit a smaller page set than the WebView reported.
        if (expected.length > 0 && textPagesRef.current.size < expected.length) {
          fail(t("errors.pdfExtractFailed"));
          return;
        }

        const pageTexts: PdfPageText[] = expected.map((pageNumber) => {
          const entry = textPagesRef.current.get(pageNumber);
          const text = entry?.text ?? "";
          return {
            pageNumber,
            text,
            hasTextLayer: pageHasTextLayer(text),
          };
        });
        // If pageCount was 0 (legacy/missing), fall back to whatever we have.
        const finalTexts =
          pageTexts.length > 0
            ? pageTexts
            : Array.from(textPagesRef.current.entries())
                .sort((a, b) => a[0] - b[0])
                .map(([pageNumber, v]) => ({
                  pageNumber,
                  text: v.text,
                  hasTextLayer: pageHasTextLayer(v.text),
                }));

        emitTextDocsAndMaybeRasterize(finalTexts);
        return;
      }

      if (eventOut.type === "image_page") {
        const target = `${FileSystem.cacheDirectory ?? ""}pdf-page-${eventOut.page}-${Date.now()}.jpg`;
        inFlightWritesRef.current += 1;
        void FileSystem.writeAsStringAsync(target, eventOut.base64, {
          encoding: FileSystem.EncodingType.Base64,
        })
          .then(() => {
            // Deliver onPage even when global done is pending — only suppress after fail.
            if (doneRef.current) {
              inFlightWritesRef.current = Math.max(0, inFlightWritesRef.current - 1);
              void FileSystem.deleteAsync(target, { idempotent: true }).catch(() => {});
              return;
            }
            createdImageUrisRef.current.push(target);
            onPage(eventOut.page - 1, target);
            inFlightWritesRef.current = Math.max(0, inFlightWritesRef.current - 1);
            if (pendingGlobalDoneRef.current && inFlightWritesRef.current === 0) {
              finishDone();
            }
          })
          .catch((e) => {
            inFlightWritesRef.current = Math.max(0, inFlightWritesRef.current - 1);
            fail(e instanceof Error ? e.message : String(e));
          });
        armPageTimer();
        return;
      }

      // X1: global_done only from messages without a page key (enforced in protocol).
      if (eventOut.type === "global_done") {
        if (isTextExtractMode(mode) && !textDocsEmittedRef.current) {
          fail(t("errors.pdfExtractFailed"));
          return;
        }
        finishDone();
        return;
      }

      const msg = parsed.message;
      if ("page" in msg || ("kind" in msg && msg.kind !== "textPassDone")) {
        armPageTimer();
      }
    },
    [
      armPageTimer,
      emitTextDocsAndMaybeRasterize,
      fail,
      finishDone,
      mode,
      onPage,
      onPageText,
      t,
    ],
  );

  // Total timer only: 150s safety net for hung bootstrap. Do not arm the
  // page timer until the first WebView message (see handleMessage) — cold
  // Jelly + large PDF can exceed PAGE_TIMEOUT_MS before the first post.
  useEffect(() => {
    if (html) {
      armTotalTimer();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, mode]);

  const statusLabel = error
    ? t("pdf.errorPrefix", { error })
    : !html
      ? t("pdf.preparing")
      : isTextExtractMode(mode)
        ? t("pdf.extractingText")
        : t("pdf.readingPages");

  return (
    <View>
      {headless ? null : (
        <View
          style={[styles.statusRow, { backgroundColor: colors.panel }]}
          accessibilityLiveRegion="polite"
        >
          {error ? null : <ActivityIndicator size="small" color={colors.muted} />}
          <Text
            style={[
              typography.bodyXs,
              styles.statusText,
              { color: error ? colors.bad : colors.ink },
            ]}
          >
            {statusLabel}
          </Text>
        </View>
      )}
      {html && !error ? (
        <View
          pointerEvents="none"
          collapsable={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.webviewHost}
        >
          <WebView
            ref={webViewRef}
            originWhitelist={["about:", "data:"]}
            source={{ html }}
            style={styles.webview}
            containerStyle={styles.webview}
            // Hardware SurfaceView ignores size/opacity/overflow; software layer clips.
            androidLayerType="software"
            nestedScrollEnabled={false}
            scrollEnabled={false}
            setSupportMultipleWindows={false}
            allowFileAccess={false}
            allowFileAccessFromFileURLs={false}
            onShouldStartLoadWithRequest={(request) =>
              request.url.startsWith("about:") || request.url.startsWith("data:")
            }
            onMessage={handleMessage}
            // Android: renderer killed under memory pressure (app process survives).
            // Without this the message stream stops until the page/total timer fires
            // with a misleading "timed out — try again".
            onRenderProcessGone={() => {
              fail(t("errors.pdfRendererGone"), "renderer_gone");
              return true;
            }}
            // iOS: WKWebView content process terminated.
            onContentProcessDidTerminate={() => {
              fail(t("errors.pdfRendererGone"), "renderer_gone");
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

async function readAsset(moduleId: number): Promise<string> {
  const asset = Asset.fromModule(moduleId);
  await asset.downloadAsync();
  if (!asset.localUri) throw new Error("pdf.js asset not available");
  return FileSystem.readAsStringAsync(asset.localUri);
}

/** Image-only HTML — production path. Caps fail-closed inside the WebView too. */
function buildPdfHtml(pdfSrc: string, workerSrc: string, pdfB64: string, maxPages: number): string {
  const workerJson = JSON.stringify(workerSrc);
  const pdfJson = JSON.stringify(pdfB64);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;background:#0b1512}canvas{display:none}</style></head><body>
<script>${pdfSrc}</script>
<script>
(function(){
  function post(msg){ if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg)); }
  function b64ToBytes(b64){
    var bin = atob(b64); var len = bin.length; var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([${workerJson}], {type: "text/javascript"}));
    var MAX_PAGES = ${maxPages};
    var CHUNK = ${CHUNK_SIZE};
    var MAX_CHUNKS = ${MAX_CHUNKS_PER_PAGE};
    var MAX_PAYLOAD = ${MAX_PAGE_PAYLOAD_BYTES};
    var pdfData = b64ToBytes(${pdfJson});
    var current = 0;
    pdfjsLib.getDocument({data: pdfData}).promise.then(function(pdf){
      var total = Math.min(pdf.numPages, MAX_PAGES);
      function renderPage(){
        if (current >= total) { post({done: true}); return; }
        var pageNum = current + 1;
        pdf.getPage(pageNum).then(function(page){
          var base = page.getViewport({scale: 1});
          var scale = Math.min(1.5, 1024 / Math.max(1, base.width));
          var viewport = page.getViewport({scale: scale});
          var canvas = document.createElement("canvas");
          canvas.width = viewport.width; canvas.height = viewport.height;
          var ctx = canvas.getContext("2d");
          page.render({canvasContext: ctx, viewport: viewport}).promise.then(function(){
            var b64 = canvas.toDataURL("image/jpeg", 0.8).split(",")[1];
            canvas.width = 0; canvas.height = 0;
            sendChunks(pageNum, b64);
          });
        });
      }
      function sendChunks(pageNum, b64){
        var n = Math.max(1, Math.ceil((b64 && b64.length) / CHUNK) || 1);
        if ((b64 && b64.length) > MAX_PAYLOAD || n > MAX_CHUNKS) {
          post({error: "image_payload_cap"});
          return;
        }
        var i = 0;
        function next(){
          if (i >= n) { post({page: pageNum, done: true}); current++; setTimeout(renderPage, 20); return; }
          post({page: pageNum, chunk: i, total: n, data: b64.slice(i * CHUNK, (i + 1) * CHUNK)});
          i++;
          setTimeout(next, 10);
        }
        next();
      }
      renderPage();
    }).catch(function(e){ post({error: String((e && e.message) || e)}); });
  } catch (e) {
    post({error: String((e && e.message) || e)});
  }
})();
</script>
</body></html>`;
}

/**
 * Text-first HTML: one pdf.js load; stream projected text items; expose
 * window.__pdfRasterizePages(pageNums) for in-place JPEG fallback (no reload).
 * Item strings and JSON payload are budgeted BEFORE stringify.
 */
function buildPdfHtmlTextMode(
  pdfSrc: string,
  workerSrc: string,
  pdfB64: string,
  maxPages: number,
): string {
  const workerJson = JSON.stringify(workerSrc);
  const pdfJson = JSON.stringify(pdfB64);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;background:#0b1512}canvas{display:none}</style></head><body>
<script>${pdfSrc}</script>
<script>
(function(){
  function post(msg){ if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg)); }
  function b64ToBytes(b64){
    var bin = atob(b64); var len = bin.length; var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  var pdfDoc = null;
  var MAX_PAGES = ${maxPages};
  var CHUNK = ${CHUNK_SIZE};
  var MAX_CHUNKS = ${MAX_CHUNKS_PER_PAGE};
  var MAX_PAYLOAD = ${MAX_PAGE_PAYLOAD_BYTES};
  var MAX_ITEMS = ${MAX_ITEMS_PER_PAGE};
  var MAX_STR = ${MAX_ITEM_STR_CHARS};
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([${workerJson}], {type: "text/javascript"}));
    var pdfData = b64ToBytes(${pdfJson});
    pdfjsLib.getDocument({data: pdfData}).promise.then(function(pdf){
      pdfDoc = pdf;
      var total = Math.min(pdf.numPages, MAX_PAGES);
      var documentPageCount = pdf.numPages;
      var current = 0;
      function extractPage(){
        if (current >= total) {
          post({kind: "textPassDone", pageCount: total, documentPageCount: documentPageCount});
          return;
        }
        var pageNum = current + 1;
        pdf.getPage(pageNum).then(function(page){
          var t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
          page.getTextContent().then(function(tc){
            var t1 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
            var ms = Math.max(0, t1 - t0);
            var raw = (tc && tc.items) ? tc.items : [];
            // Exact O(n) payload budget: stringify each item once, accumulate
            // lengths. Avoids estimate/JSON.stringify divergence (control chars
            // escape to 6 units) and the O(n²) pop+re-stringify cut.
            var pieces = [];
            var limit = Math.min(raw.length, MAX_ITEMS);
            var total = 2; // "[]"
            var first = true;
            for (var i = 0; i < limit; i++) {
              var it = raw[i];
              if (!it || typeof it.str !== "string") continue;
              var s = it.str;
              if (s.length > MAX_STR) s = s.slice(0, MAX_STR);
              var projected = { str: s };
              if (it.hasEOL === true) projected.hasEOL = true;
              if (typeof it.width === "number" && isFinite(it.width)) projected.width = it.width;
              if (it.transform && it.transform.length >= 6) {
                projected.transform = [
                  +it.transform[0] || 0, +it.transform[1] || 0, +it.transform[2] || 0,
                  +it.transform[3] || 0, +it.transform[4] || 0, +it.transform[5] || 0
                ];
              }
              var piece = JSON.stringify(projected);
              var add = piece.length + (first ? 0 : 1);
              if (total + add > MAX_PAYLOAD) break;
              pieces.push(piece);
              total += add;
              first = false;
            }
            var json = "[" + pieces.join(",") + "]";
            if (json.length > MAX_PAYLOAD) {
              post({error: "text_payload_cap"});
              return;
            }
            var nChunks = Math.max(1, Math.ceil(json.length / CHUNK) || 1);
            if (nChunks > MAX_CHUNKS) {
              post({error: "text_chunk_cap"});
              return;
            }
            sendTextChunks(pageNum, json, {
              getTextContentMs: ms,
              itemCount: pieces.length,
              projectedBytes: json.length
            });
          }).catch(function(e){ post({error: String((e && e.message) || e)}); });
        }).catch(function(e){ post({error: String((e && e.message) || e)}); });
      }
      function sendTextChunks(pageNum, json, meta){
        post({
          kind: "textPageDone",
          page: pageNum,
          getTextContentMs: meta.getTextContentMs,
          itemCount: meta.itemCount,
          projectedBytes: meta.projectedBytes
        });
        var n = Math.max(1, Math.ceil(json.length / CHUNK) || 1);
        var i = 0;
        function next(){
          if (i >= n) {
            current++;
            setTimeout(extractPage, 20);
            return;
          }
          post({
            kind: "textChunk",
            page: pageNum,
            chunk: i,
            total: n,
            data: json.slice(i * CHUNK, (i + 1) * CHUNK)
          });
          i++;
          setTimeout(next, 10);
        }
        next();
      }
      function sendImageChunks(pageNum, b64, onComplete){
        var n = Math.max(1, Math.ceil((b64 && b64.length) / CHUNK) || 1);
        if ((b64 && b64.length) > MAX_PAYLOAD || n > MAX_CHUNKS) {
          post({error: "image_payload_cap"});
          return;
        }
        var i = 0;
        function next(){
          if (i >= n) {
            post({page: pageNum, done: true});
            if (onComplete) onComplete();
            return;
          }
          post({page: pageNum, chunk: i, total: n, data: b64.slice(i * CHUNK, (i + 1) * CHUNK)});
          i++;
          setTimeout(next, 10);
        }
        next();
      }
      function renderOne(pageNum){
        return pdfDoc.getPage(pageNum).then(function(page){
          var base = page.getViewport({scale: 1});
          var scale = Math.min(1.5, 1024 / Math.max(1, base.width));
          var viewport = page.getViewport({scale: scale});
          var canvas = document.createElement("canvas");
          canvas.width = viewport.width; canvas.height = viewport.height;
          var ctx = canvas.getContext("2d");
          return page.render({canvasContext: ctx, viewport: viewport}).promise.then(function(){
            var b64 = canvas.toDataURL("image/jpeg", 0.8).split(",")[1];
            canvas.width = 0; canvas.height = 0;
            return b64;
          });
        });
      }
      window.__pdfRasterizePages = function(pageNums){
        if (!pdfDoc) { post({error: "pdf_not_ready"}); return; }
        if (!pageNums || !pageNums.length) { post({done: true}); return; }
        var idx = 0;
        function step(){
          if (idx >= pageNums.length) { post({done: true}); return; }
          var pageNum = pageNums[idx++];
          renderOne(pageNum).then(function(b64){
            sendImageChunks(pageNum, b64, function(){ setTimeout(step, 20); });
          }).catch(function(e){ post({error: String((e && e.message) || e)}); });
        }
        step();
      };
      extractPage();
    }).catch(function(e){ post({error: String((e && e.message) || e)}); });
  } catch (e) {
    post({error: String((e && e.message) || e)});
  }
})();
</script>
</body></html>`;
}

const styles = StyleSheet.create({
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  statusText: {
    flexShrink: 1,
  },
  webviewHost: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    // Punch-through belt: some API 33 OEM SurfaceViews ignore size but follow
    // window position — park off-screen instead of over the FlatList.
    left: -4000,
    top: 0,
    opacity: 0.01,
  },
  webview: {
    width: 1,
    height: 1,
    overflow: "hidden",
    opacity: 0.01,
    backgroundColor: "transparent",
  },
});
