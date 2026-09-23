import { getStrings, type Locale } from "../../i18n";
import type {
  EngineCallbacks,
  EngineInitOptions,
  EngineInitResult,
  EngineMessage,
  MemoryExtractResult,
  StreamTurnOptions,
} from "../LlamaService";
import { createThinkStreamCleaner } from "../thinkStream";
import {
  applyMemoryFactsToLastUser,
  buildMemoryFactsBlock,
} from "../memoryFactsTail";
import { toOpenAiMessages } from "./openaiMessages";
import { buildRemoteSystemPrompt } from "./remotePrompt";
import { streamOpenAiChat } from "./openaiTransport";
import { getRemoteBrainToken } from "./remoteSecret";
import {
  canSendAuthorization,
  isNonLoopback,
  joinRemoteApiUrl,
  remoteUrlGateError,
} from "./remoteUrl";
import {
  getRemoteBrainUrl,
  getRemoteContextSize,
  getRemoteMaxTokens,
  getRemoteServerModelId,
  getRemoteTemperature,
  setRemoteContextSize,
  validateServedModel,
} from "./remoteSettings";
import { REMOTE_COMPUTER_MODEL_ID } from "./remoteComputerModel";
import { parseServerContext } from "./serverContext";

let ready = false;
let activeId: string | null = null;
let inFlight = false;
let lastRequestId: string | null = null;
let activeStream: { abort: () => void } | null = null;
let initGeneration = 0;
let streamGeneration = 0;

/**
 * Verdict for an init/stream that lost a race with a newer one (or a dispose).
 * Its result must never be written into UI state as success OR failure: the
 * operation that superseded it owns the screen. Callers ask before reporting.
 */
export function isSupersededRemoteOp(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  // Own property only: an error whose prototype happens to carry `superseded`
  // would otherwise make a current failure invisible.
  if (!Object.prototype.hasOwnProperty.call(value, "superseded")) return false;
  return (value as { superseded?: unknown }).superseded === true;
}

function supersededInitError(): Error {
  const err = new Error("remote_brain_stale_init") as Error & {
    superseded?: true;
  };
  err.superseded = true;
  return err;
}

function authHeaders(url: string, token: string | null): Record<string, string> {
  if (!token || !canSendAuthorization(url)) return {};
  return { Authorization: `Bearer ${token}` };
}

const PROBE_TIMEOUT_MS = 10_000;

async function jsonGet(
  path: string,
  token: string | null,
  signal?: AbortSignal,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const url = joinRemoteApiUrl(getRemoteBrainUrl(), path);
  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json", ...authHeaders(url, token) },
    signal,
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { ok: res.ok, status: res.status, body };
}

export async function testRemoteConnection(): Promise<{
  ok: boolean;
  modelId: string | null;
  models?: string[];
  error?: string;
}> {
  const configured = getRemoteServerModelId();
  const probe = new AbortController();
  const probeTimer = setTimeout(() => probe.abort(), PROBE_TIMEOUT_MS);
  try {
    const base = getRemoteBrainUrl();
    const urlGate = remoteUrlGateError(base);
    if (urlGate) {
      return {
        ok: false,
        modelId: configured || null,
        error: urlGate,
      };
    }
    const token = await getRemoteBrainToken();
    if (isNonLoopback(base) && !token) {
      return {
        ok: false,
        modelId: configured || null,
        error: "remote_brain_token_required",
      };
    }
    // The window the server will actually answer within: we send no context
    // length, so its setting decides, and sizing prompts beyond it fails with
    // something the user cannot act on. Best effort and backend-agnostic: a
    // server that does not expose /props keeps our conservative default.
    const props = await jsonGet("/props", token, probe.signal);
    const serverContext = props.ok ? parseServerContext(props.body) : null;
    if (serverContext !== null && serverContext !== getRemoteContextSize()) {
      await setRemoteContextSize(serverContext);
    }

    const models = await jsonGet("/v1/models", token, probe.signal);
    let ids: string[] = [];
    if (models.ok) {
      const data = (models.body as { data?: Array<{ id?: string }> } | null)?.data;
      ids = Array.isArray(data)
        ? data.map((row) => row?.id).filter((id): id is string => typeof id === "string" && id.length > 0)
        : [];
    } else {
      const health = await jsonGet("/health", token, probe.signal);
      if (!health.ok) {
        return {
          ok: false,
          modelId: configured || null,
          error: `models HTTP ${models.status}`,
        };
      }
    }
    const invalid = validateServedModel(configured, ids);
    if (invalid) {
      return {
        ok: false,
        modelId: configured || null,
        models: ids,
        error: invalid,
      };
    }
    return { ok: true, modelId: configured, models: ids };
  } catch (err) {
    return {
      ok: false,
      modelId: configured || null,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(probeTimer);
  }
}

export async function initRemoteEngine(
  _modelPath: string,
  modelId: string,
  options: EngineInitOptions,
): Promise<EngineInitResult> {
  const gen = ++initGeneration;
  const probe = await testRemoteConnection();
  if (gen !== initGeneration) {
    throw supersededInitError();
  }
  if (!probe.ok) {
    ready = false;
    activeId = null;
    const strings = getStrings(options.locale);
    throw new Error(probe.error || strings.errors.modelNotLoaded);
  }
  ready = true;
  activeId = REMOTE_COMPUTER_MODEL_ID;
  const serverId = probe.modelId || getRemoteServerModelId();
  console.log(
    "remote.brain.init",
    JSON.stringify({
      ok: true,
      modelId: activeId,
      serverModelId: serverId,
    }),
  );
  return { effectiveNCtx: getRemoteContextSize() };
}

export async function disposeRemoteEngine(): Promise<void> {
  initGeneration += 1;
  streamGeneration += 1;
  try {
    activeStream?.abort();
  } catch {
    // ignore
  }
  activeStream = null;
  ready = false;
  activeId = null;
  inFlight = false;
}

export function isRemoteEngineReady(): boolean {
  return ready;
}

export function getRemoteActiveModelId(): string | null {
  return activeId;
}

export function remoteNativeWorkInFlight(): boolean {
  return inFlight;
}

export function getLastRemoteRequestId(): string | null {
  return lastRequestId;
}

export async function streamRemoteAssistantTurn(
  messages: EngineMessage[],
  callbacks: EngineCallbacks,
  signal: AbortSignal | undefined,
  options: StreamTurnOptions,
): Promise<void> {
  const locale: Locale = options.locale;
  const strings = getStrings(locale);
  if (!ready) {
    callbacks.onError(new Error(strings.errors.modelNotLoaded));
    return;
  }
  if (inFlight) {
    callbacks.onError(new Error("remote_brain_busy"));
    return;
  }
  const myGen = ++streamGeneration;
  const stillMine = () => myGen === streamGeneration;
  inFlight = true;
  let visible = "";
  let emitted = "";
  let thinking = false;
  let writing = false;
  const think = createThinkStreamCleaner();
  let closed = false;
  const flushEveryMs = 32;
  let pending = "";
  let timer: ReturnType<typeof setTimeout> | null = null;

  const safeDelta = (chunk: string, full: string) => {
    try {
      callbacks.onDelta(chunk, full);
    } catch {
      // never wedge the stream on a UI throw
    }
  };
  const safeStatus = (label: string) => {
    try {
      callbacks.onStatus?.({ label });
    } catch {
      // ignore
    }
  };

  const flush = () => {
    if (!pending) return;
    const chunk = pending;
    pending = "";
    visible += chunk;
    safeDelta(chunk, visible);
  };

  const queue = (text: string) => {
    if (!text) return;
    pending += text;
    if (timer != null) return;
    timer = setTimeout(() => {
      timer = null;
      try {
        flush();
      } catch {
        // ignore
      }
    }, flushEveryMs);
  };

  const finishOnce = (err?: Error) => {
    if (closed) return;
    closed = true;
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
    const mine = stillMine();
    if (!mine && err) {
      // A newer turn or a dispose owns the UI now. The failure is still
      // delivered (it may carry "your partial reply was interrupted", which
      // only the caller can mark) but flagged, so the caller does not report it
      // as the failure of the conversation that replaced this one.
      (err as Error & { superseded?: true }).superseded = true;
    }
    if (mine) {
      inFlight = false;
      activeStream = null;
    }
    if (mine) {
      try {
        flush();
        const finalVisible = think.finalize(emitted);
        if (finalVisible !== visible) {
          visible = finalVisible;
          safeDelta("", visible);
        }
      } catch {
        // finalize must not suppress terminal dispatch
      }
      try {
        // EmissionSource by outcome, mirroring the local paths: only a
        // completed turn is "parsed"; interrupted / truncated / error
        // partials are raw accumulation. `emitted` is raw delta.content —
        // think tags are stripped only for display (onDelta), never here.
        if (emitted.length > 0) {
          callbacks.onModelEmittedText?.(emitted, err ? "raw" : "parsed");
        }
      } catch {
        // ignore
      }
    }
    // A dead turn writes no success: the operation that replaced it owns the UI,
    // and the awaiting caller still unwinds the turn on its own.
    try {
      if (err) {
        callbacks.onError(err);
      } else if (mine) {
        callbacks.onDone();
      }
    } catch {
      // terminal attempted
    }
  };

  safeStatus(strings.chat.thinkingStatus);

  let streamStarted = false;
  try {
  const base = getRemoteBrainUrl();
  const urlGate = remoteUrlGateError(base);
  if (urlGate) {
    finishOnce(new Error(urlGate));
    return;
  }
  const token = await getRemoteBrainToken();
  if (!stillMine()) return;
  if (isNonLoopback(base) && !token) {
    finishOnce(new Error("remote_brain_token_required"));
    return;
  }
  if (signal?.aborted) {
    const err = new Error(strings.chat.interrupted);
    (err as { code?: string; preservePartial?: boolean }).code = "interrupted";
    (err as { preservePartial?: boolean }).preservePartial = true;
    finishOnce(err);
    return;
  }
  if (!stillMine()) return;
  // Format B, local parity (ttftFlags.ts:26): facts ride the last user turn,
  // never the system prompt — a fact edit must not rewrite prompt position 0.
  const factsTail = buildMemoryFactsBlock(locale, options.memoryFacts);
  const turnMessages = factsTail
    ? applyMemoryFactsToLastUser(messages, factsTail)
    : messages;
  streamStarted = true;
  await new Promise<void>((resolve) => {
    const settle = (err?: Error) => {
      try {
        finishOnce(err);
      } finally {
        resolve();
      }
    };
    if (!stillMine()) {
      resolve();
      return;
    }
    const handle = streamOpenAiChat(
      {
        completionsUrl: joinRemoteApiUrl(base, "/v1/chat/completions"),
        model: getRemoteServerModelId(),
        messages: toOpenAiMessages(
          turnMessages,
          buildRemoteSystemPrompt({
            locale,
            operativeContext: options.operativeContext,
          }),
        ),
        maxTokens: getRemoteMaxTokens(),
        temperature: getRemoteTemperature(),
        token: token && canSendAuthorization(base) ? token : null,
        signal,
      },
      {
        onDelta: (delta) => {
          if (delta.reasoning && !thinking && !writing) {
            thinking = true;
            safeStatus(strings.chat.thinkingStatus);
          }
          if (delta.content) {
            emitted += delta.content;
            const visibleChunk = think.cleanDelta(delta.content);
            if (!writing && visibleChunk) {
              writing = true;
              safeStatus(strings.chat.writingStatus);
              console.log(
                "remote.brain.token",
                JSON.stringify({ n: visibleChunk.length }),
              );
            }
            if (visibleChunk) queue(visibleChunk);
          }
        },
        onFinish: (finish) => {
          if (finish.kind === "complete") {
            settle();
            return;
          }
          const err = new Error(
            finish.kind === "truncated"
              ? strings.chat.truncated
              : finish.kind === "interrupted"
                ? strings.chat.interrupted
                : finish.error?.message || strings.chat.serviceUnreachable,
          );
          (err as { code?: string; preservePartial?: boolean }).code =
            finish.kind;
          (err as { preservePartial?: boolean }).preservePartial =
            finish.kind === "interrupted" || finish.kind === "truncated";
          settle(err);
        },
      },
    );
    if (handle.isClosed()) {
      return;
    }
    if (!stillMine()) {
      handle.abort();
      resolve();
      return;
    }
    lastRequestId = handle.requestId;
    activeStream = handle;
    console.log(
      "remote.brain.stream",
      JSON.stringify({ requestId: lastRequestId, model: activeId }),
    );
    if (signal?.aborted) handle.abort();
  });
  } catch (err) {
    if (!closed) {
      finishOnce(err instanceof Error ? err : new Error(String(err)));
    }
  } finally {
    if (!streamStarted && stillMine()) inFlight = false;
  }
}

export async function remoteSaveEngineSession(): Promise<boolean> {
  return false;
}

export async function remoteRestoreEngineSession(): Promise<boolean> {
  return false;
}

export async function remoteInvalidateEngineSession(): Promise<void> {
  return;
}

export async function remoteInvalidateConversationSessions(): Promise<void> {
  return;
}

export function remoteExtractMemory(): MemoryExtractResult {
  return {
    add: [],
    remove: [],
    parseOutcome: 0,
    durationMs: 0,
    timeoutMs: 0,
    stopReason: "skipped_no_snapshot",
  };
}

export async function remoteTranslateText(): Promise<{
  text: string;
  truncated: boolean;
}> {
  return { text: "", truncated: false };
}

export async function remoteCompleteOnce(): Promise<{
  text: string;
  aborted: boolean;
}> {
  return { text: "", aborted: true };
}
