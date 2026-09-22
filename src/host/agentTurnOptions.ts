/**
 * The engine turn options: tool schemas + executor — the old `agentOptions`
 * memo converted from `useMemo` to a builder over injected host state (the
 * same fields the old memo captured).
 *
 * Adaptations (reported): the three module turn-seq counters go through
 * `turnCorpus`'s accessors (live reads at call time, same as before);
 * `ensureSemanticIndexLoaded` takes the library ref explicitly; the dense
 * index maps and `docIndexByIdRef` are imported from `docIndexes`.
 */
import * as FileSystem from "expo-file-system/legacy";
import { htmlToText } from "../util/htmlToText";
import { embedQuery as embedQueryVec, isEmbedderHung } from "../engine/EmbeddingService";
import { getActiveModelId, type EngineToolResult, type EngineTurnOptions } from "../engine/LlamaService";
import { createDocumentChatExecutor } from "../documents/documentChatTool";
import type { DocRetrieverIndex } from "../context/retrievalLoop";
import type { LibraryDoc, LibraryState } from "../documents/DocumentLibrary";
import { makeWebSearchExecutor } from "../agent/webSearchTool";
import { makeWriteNoteExecutor } from "../agent/writeNoteTool";
import { makeCreateMiniappExecutor } from "../agent/createMiniappTool";
import { applyWarnToResult, runToolGate } from "../rules/runToolGate";
import { makeFetchAllowlist, makeWebFetchExecutor, type FetchAllowlist } from "../agent/webFetchTool";
import { assembleTools } from "../agent/toolRegistry";
import { makePdfCacheFs } from "../pdf/pdfCacheFs";
import { isPdfTextExtractionBusy, requestPdfText } from "../pdf/pdfTextService";
import {
  formatDeviceInfoResult,
  readDeviceInfo,
  runDeviceCalc,
} from "../agent/deviceTools";
import { runCalendarAgenda } from "../agent/calendarTool";
import { getStrings, type Locale } from "../i18n";
import { getToolGateEnabled } from "../bench/benchConfig";
import {
  docDenseReasonByIdRef,
  docIndexByIdRef,
  docSemanticByIdRef,
  ensureSemanticIndexLoaded,
} from "./docIndexes";
import {
  currentTurnSeq,
  latchCalendarExtract,
  latchPrivateSearch,
  privateSearchLatched,
} from "./turnCorpus";
import type { LocalAttachment } from "./hostMessage";

export interface AgentOptionsDeps {
  locale: Locale;
  webToolsEnabled: boolean;
  deviceToolsEnabled: boolean;
  calendarToolsEnabled: boolean;
  webToolsEnabledRef: { current: boolean };
  deviceToolsEnabledRef: { current: boolean };
  calendarToolsEnabledRef: { current: boolean };
  documentLibraryRef: { current: LibraryState };
  activeDocumentAttachmentRef: { current: LocalAttachment | null };
  chatEngineCtxRef: { current: number };
  embedderDownloadedRef: { current: boolean };
  thermalHardGateRef: { current: boolean };
  onMiniappRef: { current: (miniapp: unknown) => void };
  lastUserRawRef: { current: string };
  toolhelpRef: { current: boolean };
  injectedFactsRef: { current: string[] };
}

export function buildAgentOptions(deps: AgentOptionsDeps): EngineTurnOptions {
  const {
    locale,
    webToolsEnabled,
    deviceToolsEnabled,
    calendarToolsEnabled,
    webToolsEnabledRef,
    deviceToolsEnabledRef,
    calendarToolsEnabledRef,
    documentLibraryRef,
    activeDocumentAttachmentRef,
    chatEngineCtxRef,
    embedderDownloadedRef,
    thermalHardGateRef,
    onMiniappRef,
    lastUserRawRef,
    toolhelpRef,
    injectedFactsRef,
  } = deps;
    const searchExec = makeWebSearchExecutor(locale);
    const writeNoteExec = makeWriteNoteExecutor(locale);
    // create_miniapp is ungated and always on; opens the built miniapp inline
    // via the current turn's onMiniapp hook (threaded through a ref).
    const createMiniappExec = makeCreateMiniappExecutor(locale, {
      onMiniapp: (miniapp) => onMiniappRef.current?.(miniapp),
    });
    // Recreated when the per-send turn seq advances; held across
    // tool rounds within the same turn so search results stay allowlisted.
    const pdfCacheFs = makePdfCacheFs({
      getDirectory: () =>
        FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? "",
      writeAsBase64: (uri, base64) =>
        FileSystem.writeAsStringAsync(uri, base64, {
          encoding: FileSystem.EncodingType.Base64,
        }),
      deleteAsync: (uri) =>
        FileSystem.deleteAsync(uri, { idempotent: true }).then(() => undefined),
      noCacheDirMessage: getStrings(locale).errors.webFetchPdfNoCacheDir,
    });
    const fetchDeps = {
      extractPdfText: (
        fileUri: string,
        opts?: { sourceId?: string; title?: string | null; signal?: AbortSignal },
      ) => requestPdfText(fileUri, opts),
      pdfCacheFs,
      isPdfTextExtractionBusy,
    };
    let allowlist: FetchAllowlist = makeFetchAllowlist();
    let fetchExec = makeWebFetchExecutor(locale, allowlist, fetchDeps);
    let seededTurnSeq: number | null = null;

    const ensureAllowlistForTurn = (lastUserMessage?: string) => {
      if (seededTurnSeq === currentTurnSeq()) return;
      allowlist = makeFetchAllowlist();
      if (lastUserMessage) allowlist.addFromText(lastUserMessage);
      fetchExec = makeWebFetchExecutor(locale, allowlist, fetchDeps);
      seededTurnSeq = currentTurnSeq();
    };

    const documentExec = createDocumentChatExecutor(
      {
        getLibraryDocs: () => documentLibraryRef.current.docs ?? [],
        getActiveAttachment: () => {
          const attachment = activeDocumentAttachmentRef.current;
          return attachment?.kind === "document"
            ? {
                libraryDocId: attachment.libraryDocId,
                name: attachment.name,
              }
            : null;
        },
        requestPdfText: (doc: LibraryDoc, opts) =>
          requestPdfText(doc.fileUri, {
            sourceId: doc.sourceId,
            title: doc.name,
            signal: opts?.signal,
          }),
        readTxt: async (doc: LibraryDoc, opts) => {
          // Uncancellable host read: check abort BEFORE starting and AFTER
          // settle so the wrapper rejects the caller while the strategy still
          // holds the latch (expo-file-system has no AbortSignal).
          if (opts?.signal?.aborted) {
            throw new Error("document_chat aborted");
          }
          const raw = await FileSystem.readAsStringAsync(doc.fileUri);
          if (opts?.signal?.aborted) {
            throw new Error("document_chat aborted");
          }
          const looksHtml = /<\/?[a-z][\s\S]*>/i.test(raw.slice(0, 2000));
          if (looksHtml) return htmlToText(raw).text;
          return raw;
        },
        getCtxTokens: () => chatEngineCtxRef.current,
        getModelId: () => getActiveModelId(),
        getIndexFor: (docId: string) =>
          docIndexByIdRef.current.get(docId) ?? null,
        setIndexFor: (docId: string, index: DocRetrieverIndex) => {
          docIndexByIdRef.current.set(docId, index);
        },
        getSemanticIndexFor: (docId: string) =>
          docSemanticByIdRef.current.get(docId) ?? null,
        // Lazy restore from durable sidecar on first hybrid query.
        loadSemanticIndexFor: (docId: string) => ensureSemanticIndexLoaded({ documentLibraryRef }, docId),
        getDenseUnavailableReason: (docId: string) => {
          // Process-wide hung embedder wins over per-doc reasons so hybrid
          // surfaces degradedNoEmbedder after an abandoned native op.
          if (isEmbedderHung()) return "hung";
          return docDenseReasonByIdRef.current.get(docId) ?? null;
        },
        isEmbedderDownloaded: () => embedderDownloadedRef.current,
        // Thread AbortSignal into embedQuery (native abort gate).
        embedQuery: (text: string, signal?: AbortSignal) =>
          thermalHardGateRef.current
            ? Promise.resolve(null)
            : embedQueryVec(text, signal ? { signal } : undefined),
      },
      { locale },
    );

    // New tool checklist and ordering live in src/agent/toolRegistry.ts.
    const tools = assembleTools({
      web: webToolsEnabled,
      device: deviceToolsEnabled,
      calendar: calendarToolsEnabled,
    });

    return {
      tools,
      executeTool: async (name, args, signal, lastUserMessage) => {
        // Persona / format-B tails are prompt-only. Prefer the raw user text
        // captured at send (lastUserRawRef) over the engine message content.
        const rawUserText =
          typeof lastUserRawRef.current === "string"
            ? lastUserRawRef.current
            : (lastUserMessage ?? "");
        ensureAllowlistForTurn(rawUserText);

        // Defense in depth: even if a stale completion still holds the tool
        // schema, refuse web tools when the toggle is off.
        if (
          !webToolsEnabledRef.current &&
          (name === "web_search" || name === "web_fetch")
        ) {
          return {
            text: getStrings(locale).errors.unknownTool.replace(
              "{name}",
              name,
            ),
          };
        }
        if (
          !deviceToolsEnabledRef.current &&
          (name === "device_info" || name === "device_calc")
        ) {
          return {
            text: getStrings(locale).errors.unknownTool.replace("{name}", name),
          };
        }
        if (!calendarToolsEnabledRef.current && name === "calendar_agenda") {
          return {
            text: getStrings(locale).errors.unknownTool.replace("{name}", name),
          };
        }
        if (name === "web_search" && privateSearchLatched(currentTurnSeq())) {
          return { text: getStrings(locale).errors.searchSkippedPrivate };
        }

        // kalsa.bench.toolgate=0 skips the gate (CI A/B). Absent key → on.
        const gate = (await getToolGateEnabled())
          ? await runToolGate({
              toolName: name,
              args,
              lastUserMessage: rawUserText,
              memoryFacts: injectedFactsRef.current,
              toolhelpOn: toolhelpRef.current,
              locale,
            })
          : { blocked: false };
        if (gate.blocked) return { text: gate.text ?? "" };

        let outcome: EngineToolResult;
        if (name === "web_search") {
          outcome = await searchExec(name, args, signal, rawUserText);
          const sources = outcome.sources as Array<{ url?: string }> | undefined;
          if (sources?.length) {
            for (const source of sources) {
              if (typeof source?.url === "string" && source.url) {
                allowlist.add(source.url);
              }
            }
          }
        } else if (name === "web_fetch") {
          outcome = await fetchExec(name, args, signal);
        } else if (name === "device_info") {
          latchPrivateSearch(currentTurnSeq());
          try {
            const info = await readDeviceInfo(locale);
            outcome = formatDeviceInfoResult(info);
          } catch {
            outcome = { text: getStrings(locale).errors.deviceUnavailable };
          }
        } else if (name === "device_calc") {
          const strings = getStrings(locale).errors;
          outcome = runDeviceCalc(args, strings.deviceCalcInvalid, strings.deviceCalcDivZero);
        } else if (name === "calendar_agenda") {
          latchPrivateSearch(currentTurnSeq());
          latchCalendarExtract(currentTurnSeq());
          outcome = await runCalendarAgenda(args, {
            denied: getStrings(locale).errors.calendarDenied,
            failed: getStrings(locale).errors.calendarFailed,
            unavailable: getStrings(locale).errors.calendarUnavailable,
          });
        } else if (name === "document_chat") {
          const docOutcome = await documentExec(name, args, signal);
          if (docOutcome.strategy === "vision_fallback") {
            const strings = getStrings(locale);
            const msg =
              strings.errors.documentChatVisionFallback
                ?.replace("{name}", "")
                ?.replace("{pages}", "") ||
              docOutcome.text.replace(/\[\[DOCUMENT_VISION_FALLBACK\]\]\s*/g, "");
            const cleaned = docOutcome.text
              .replace(/\[\[DOCUMENT_VISION_FALLBACK\]\]\s*/g, "")
              .trim();
            outcome = {
              text:
                cleaned ||
                msg ||
                "This document has no searchable text layer. Re-attach it as page images for vision.",
              kind: "document_chat" as const,
              strategy: "vision_fallback" as const,
            };
          } else {
            outcome = {
              text: docOutcome.text,
              passages: docOutcome.passages,
              strategy: docOutcome.strategy,
              error: docOutcome.error,
              kind: "document_chat" as const,
            };
          }
        } else if (name === "write_note") {
          outcome = await writeNoteExec(name, args, signal);
        } else if (name === "create_miniapp") {
          outcome = await createMiniappExec(name, args, signal);
        } else {
          outcome = {
            text: getStrings(locale).errors.unknownTool.replace("{name}", name),
          };
        }
        return applyWarnToResult(outcome, gate.warnNote);
      },
    };
}
