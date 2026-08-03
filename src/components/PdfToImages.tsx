import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system/legacy";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { useLocale } from "../i18n";

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
 */

type Props = {
  pdfUri: string;
  maxPages?: number;
  maxBytes?: number;
  onPage: (pageIndex: number, imageUri: string) => void;
  onDone: () => void;
  onError: (error: Error) => void;
};

const CHUNK_SIZE = 200_000;
const PAGE_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_PAGES = 5;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

type BridgeMessage =
  | { page: number; chunk: number; total: number; data: string }
  | { page: number; done: true }
  | { done: true }
  | { error: string };

export function PdfToImages({ pdfUri, maxPages = DEFAULT_MAX_PAGES, maxBytes = DEFAULT_MAX_BYTES, onPage, onDone, onError }: Props) {
  const { t } = useLocale();
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const chunksRef = useRef<Record<number, string[]>>({});
  const pageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doneRef = useRef(false);

  const fail = useCallback(
    (message: string) => {
      if (doneRef.current) return;
      doneRef.current = true;
      if (pageTimerRef.current) clearTimeout(pageTimerRef.current);
      setError(message);
      onError(new Error(message));
    },
    [onError],
  );

  // Carica gli asset pdf.js + il PDF (base64) e compone l'html della WebView.
  useEffect(() => {
    let mounted = true;
    // U2 defense in depth: even if this instance were ever reused across a
    // different pdfUri (normally prevented by `key={pdfUri}` at the call
    // site), reset all per-document state so a stale doneRef/chunksRef never
    // swallows the new document's completion/errors.
    doneRef.current = false;
    chunksRef.current = {};
    setError(null);
    setHtml(null);
    if (pageTimerRef.current) {
      clearTimeout(pageTimerRef.current);
      pageTimerRef.current = null;
    }
    void (async () => {
      try {
        const [pdfSrc, workerSrc, pdfB64] = await Promise.all([
          readAsset(require("../../assets/pdfjs/pdf.min.js.txt")),
          readAsset(require("../../assets/pdfjs/pdf.worker.min.js.txt")),
          FileSystem.readAsStringAsync(pdfUri, { encoding: FileSystem.EncodingType.Base64 }),
        ]);
        if (!mounted) return;
        if (pdfB64.length > maxBytes * 1.34) {
          setError(t("errors.pdfTooLarge"));
          return;
        }
        setHtml(buildPdfHtml(pdfSrc, workerSrc, pdfB64, maxPages));
      } catch (e) {
        if (mounted) fail(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      mounted = false;
      if (pageTimerRef.current) clearTimeout(pageTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfUri]);

  const armPageTimer = () => {
    if (pageTimerRef.current) clearTimeout(pageTimerRef.current);
    pageTimerRef.current = setTimeout(() => fail(t("errors.pdfTimeout")), PAGE_TIMEOUT_MS);
  };

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let message: BridgeMessage;
      try {
        message = JSON.parse(event.nativeEvent.data) as BridgeMessage;
      } catch {
        return;
      }
      if (pageTimerRef.current) clearTimeout(pageTimerRef.current);

      if ("error" in message && message.error) {
        fail(message.error);
        return;
      }
      // X1: page-scoped messages ({page, done:true} per-page completion, or
      // {page, chunk, total, data} chunk) MUST be checked before the overall
      // {done:true} (no page key) completion — otherwise the first per-page
      // done is mistaken for overall completion and multi-page PDFs truncate
      // to page 1.
      if ("page" in message) {
        if ("done" in message) {
          // pagina completata → prossima
          armPageTimer();
          return;
        }
        // chunk di base64 di una pagina
        const pageChunks = chunksRef.current[message.page] ?? (chunksRef.current[message.page] = []);
        pageChunks[message.chunk] = message.data;
        if (pageChunks.filter(Boolean).length === message.total) {
          const b64 = pageChunks.join("");
          delete chunksRef.current[message.page];
          const target = `${FileSystem.cacheDirectory ?? ""}pdf-page-${message.page}-${Date.now()}.jpg`;
          void FileSystem.writeAsStringAsync(target, b64, { encoding: FileSystem.EncodingType.Base64 })
            .then(() => {
              onPage(message.page - 1, target);
            })
            .catch((e) => fail(e instanceof Error ? e.message : String(e)));
        }
        armPageTimer();
        return;
      }
      // Only a done message WITHOUT a page key is overall completion.
      if ("done" in message && message.done) {
        doneRef.current = true;
        onDone();
        return;
      }
    },
    [fail, onDone, onPage],
  );

  if (error) {
    return (
      <View style={styles.box}>
        <Text style={styles.error}>{t("pdf.errorPrefix", { error })}</Text>
      </View>
    );
  }

  if (!html) {
    return (
      <View style={styles.box}>
        <ActivityIndicator size="small" />
        <Text style={styles.loading}>{t("pdf.preparing")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.box}>
      <WebView
        originWhitelist={["about:", "data:"]}
        source={{ html }}
        style={styles.webview}
        setSupportMultipleWindows={false}
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        onShouldStartLoadWithRequest={(request) =>
          request.url.startsWith("about:") || request.url.startsWith("data:")
        }
        onMessage={handleMessage}
      />
      <Text style={styles.loading}>{t("pdf.readingPages")}</Text>
    </View>
  );
}

async function readAsset(moduleId: number): Promise<string> {
  const asset = Asset.fromModule(moduleId);
  await asset.downloadAsync();
  if (!asset.localUri) throw new Error("pdf.js asset not available");
  return FileSystem.readAsStringAsync(asset.localUri);
}

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
    var CHUNK = 200000;
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
        var n = Math.ceil(b64.length / CHUNK);
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

const styles = StyleSheet.create({
  box: {
    borderRadius: 12,
    overflow: "hidden",
    padding: 8,
    backgroundColor: "#0b1512",
  },
  webview: {
    height: 1,
    width: 1,
    opacity: 0,
  },
  loading: {
    color: "#8aa39b",
    fontSize: 12,
    paddingVertical: 4,
  },
  error: {
    color: "#f87171",
    fontSize: 12,
  },
});
