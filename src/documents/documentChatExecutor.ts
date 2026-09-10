import type { Locale } from "../i18n/types";
import {
  tryAcquireRead,
  releaseRead,
  isReadActive,
  isAnyActive,
  __resetDocOpGateForTests,
} from "./docOpGate";
import { catalog } from "./documentChatCatalog";
import { DOC_OP_STALE_CAP_MS, DOCUMENT_CHAT_TIMEOUT_MS } from "./documentChatConstants";
import { formatDocList, selectDoc } from "./documentChatSelection";
import { errorResult } from "./documentChatResults";
import { safeActiveAttachment, safeLibraryDocs } from "./documentChatHost";
import { runStrategy } from "./documentChatStrategy";
import type {
  DocumentChatHost,
  DocumentChatToolResult,
} from "./documentChatTypes";

let inflightGen = 0;
let staleCapTimer: ReturnType<typeof setTimeout> | null = null;
let inflightLinkedAbort: AbortController | null = null;

function releaseReadLatch(gen?: number): void {
  if (gen != null && gen !== inflightGen) return;
  releaseRead();
  inflightLinkedAbort = null;
  if (staleCapTimer != null) {
    clearTimeout(staleCapTimer);
    staleCapTimer = null;
  }
}

function armStaleCap(gen: number, controller: AbortController): void {
  if (staleCapTimer != null) clearTimeout(staleCapTimer);
  inflightLinkedAbort = controller;
  staleCapTimer = setTimeout(() => {
    if (gen === inflightGen) {
      try {
        inflightLinkedAbort?.abort();
      } catch {
        /* ignore */
      }
      staleCapTimer = null;
    }
  }, DOC_OP_STALE_CAP_MS);
}

export function isDocumentChatBusy(): boolean {
  return isReadActive();
}

export function isDocumentOpInFlight(): boolean {
  return isAnyActive();
}

export function __resetDocumentChatBusyForTests(): void {
  inflightGen += 1;
  releaseReadLatch();
  __resetDocOpGateForTests();
}

export function createDocumentChatExecutor(
  host: DocumentChatHost,
  opts?: { timeoutMs?: number; locale?: Locale },
): (
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<DocumentChatToolResult> {
  const timeoutMs =
    typeof opts?.timeoutMs === "number" && opts.timeoutMs > 0
      ? opts.timeoutMs
      : DOCUMENT_CHAT_TIMEOUT_MS;
  const locale: Locale = opts?.locale === "it" ? "it" : "en";

  return async (name, args, signal) => {
    if (name !== "document_chat") return errorResult(`Unknown tool: ${name}`);
    if (!tryAcquireRead()) return errorResult("document_chat is busy (single-flight)");

    const rawArgs = args && typeof args === "object" ? args : {};
    const query = String((rawArgs as { query?: unknown }).query ?? "").trim();
    const rawDocId = String((rawArgs as { docId?: unknown }).docId ?? "").trim();
    if (!query) {
      releaseRead();
      return errorResult(catalog(locale).emptyQuery);
    }

    const docs = safeLibraryDocs(host);
    const activeAttachment = safeActiveAttachment(host);
    const selected = selectDoc(docs, rawDocId || undefined, activeAttachment);
    if (!selected) {
      releaseRead();
      if (!docs.length) return errorResult(catalog(locale).noDoc);
      const base = rawDocId
        ? catalog(locale).docNotFound.replace("{id}", rawDocId)
        : "No document was selected.";
      return errorResult(`${base} Available documents: ${formatDocList(docs)}`);
    }
    const doc = selected.doc;
    if (signal?.aborted) {
      releaseRead();
      return errorResult(catalog(locale).aborted);
    }

    const linked = new AbortController();
    const myGen = ++inflightGen;
    armStaleCap(myGen, linked);
    let timer: ReturnType<typeof setTimeout> | null = null;
    let timedOut = false;
    let abortHandler: (() => void) | null = null;
    const forwardAbort = () => {
      try {
        linked.abort();
      } catch {
        /* ignore */
      }
    };

    const strategyPromise = runStrategy(
      host,
      doc,
      query,
      locale,
      linked.signal,
    ).finally(() => {
      releaseReadLatch(myGen);
    });

    try {
      const result = await new Promise<DocumentChatToolResult>((resolve, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          forwardAbort();
          reject(new Error("document_chat timeout"));
        }, timeoutMs);

        if (signal) {
          abortHandler = () => {
            forwardAbort();
            reject(new Error("document_chat aborted"));
          };
          signal.addEventListener("abort", abortHandler, { once: true });
        }

        void strategyPromise.then((result) => {
          if (selected.requestedIdNotFound && result.strategy !== "error") {
            resolve({
              ...result,
              text:
                catalog(locale)
                  .docFallbackSingle.replace("{id}", rawDocId)
                  .replace("{name}", doc.name) +
                "\n" +
                result.text,
            });
            return;
          }
          resolve(result);
        }, reject);
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (timedOut || /timeout/i.test(message)) return errorResult(catalog(locale).timeout);
      if (/abort/i.test(message)) return errorResult(catalog(locale).aborted);
      return errorResult(message || catalog(locale).failed);
    } finally {
      if (timer) clearTimeout(timer);
      if (signal && abortHandler) {
        try {
          signal.removeEventListener("abort", abortHandler);
        } catch {
          /* ignore */
        }
      }
    }
  };
}
