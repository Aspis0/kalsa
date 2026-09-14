import { getStrings, type Locale } from "../../i18n";
import type {
  EngineCallbacks,
  EngineInitOptions,
  EngineInitResult,
  EngineMessage,
  MemoryExtractResult,
  StreamTurnOptions,
} from "../LlamaService";
import {
  DEFAULT_REMOTE_MAX_TOKENS,
  DEFAULT_REMOTE_TEMPERATURE,
  toOpenAiMessages,
} from "./openaiMessages";
import { streamOpenAiChat } from "./openaiTransport";
import { getRemoteBrainToken } from "./remoteSecret";
import {
  DEFAULT_REMOTE_MODEL_ID,
  getRemoteBrainUrl,
} from "./remoteSettings";
import { REMOTE_MAC_MODEL_ID } from "./remoteMacModel";

let ready = false;
let activeId: string | null = null;
let inFlight = false;
let lastRequestId: string | null = null;

function authHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function jsonGet(
  path: string,
  token: string | null,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const url = `${getRemoteBrainUrl()}${path}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json", ...authHeaders(token) },
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
  error?: string;
}> {
  try {
    const token = await getRemoteBrainToken();
    const health = await jsonGet("/health", token);
    if (!health.ok) {
      return { ok: false, modelId: null, error: `health HTTP ${health.status}` };
    }
    const models = await jsonGet("/v1/models", token);
    if (!models.ok) {
      return { ok: false, modelId: null, error: `models HTTP ${models.status}` };
    }
    const data = (models.body as { data?: Array<{ id?: string }> } | null)?.data;
    const id =
      (Array.isArray(data) && typeof data[0]?.id === "string" && data[0].id) ||
      DEFAULT_REMOTE_MODEL_ID;
    return { ok: true, modelId: id };
  } catch (err) {
    return {
      ok: false,
      modelId: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function initRemoteEngine(
  _modelPath: string,
  modelId: string,
  options: EngineInitOptions,
): Promise<EngineInitResult> {
  const probe = await testRemoteConnection();
  if (!probe.ok) {
    ready = false;
    activeId = null;
    const strings = getStrings(options.locale);
    throw new Error(probe.error || strings.errors.modelNotLoaded);
  }
  ready = true;
  activeId = probe.modelId || modelId || REMOTE_MAC_MODEL_ID;
  console.log(
    "remote.brain.init",
    JSON.stringify({ ok: true, modelId: activeId, url: getRemoteBrainUrl() }),
  );
  return { effectiveNCtx: 32768 };
}

export async function disposeRemoteEngine(): Promise<void> {
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
  inFlight = true;
  let visible = "";
  let emitted = "";
  let thinking = false;
  let writing = false;
  let closed = false;
  const flushEveryMs = 32;
  let pending = "";
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (!pending) return;
    const chunk = pending;
    pending = "";
    visible += chunk;
    callbacks.onDelta(chunk, visible);
  };

  const queue = (text: string) => {
    if (!text) return;
    pending += text;
    if (timer != null) return;
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, flushEveryMs);
  };

  const finishOnce = (err?: Error) => {
    if (closed) return;
    closed = true;
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
    flush();
    inFlight = false;
    if (emitted.length > 0) callbacks.onModelEmittedText?.(emitted);
    if (err) callbacks.onError(err);
    else callbacks.onDone();
  };

  callbacks.onStatus?.({ label: strings.chat.thinkingStatus });

  const token = await getRemoteBrainToken();
  await new Promise<void>((resolve) => {
    const settle = (err?: Error) => {
      finishOnce(err);
      resolve();
    };
    const handle = streamOpenAiChat(
      {
        baseUrl: getRemoteBrainUrl(),
        model: activeId || DEFAULT_REMOTE_MODEL_ID,
        messages: toOpenAiMessages(messages),
        maxTokens: DEFAULT_REMOTE_MAX_TOKENS,
        temperature: DEFAULT_REMOTE_TEMPERATURE,
        token,
        signal,
      },
      {
        onDelta: (delta) => {
          if (delta.reasoning && !thinking) {
            thinking = true;
            callbacks.onStatus?.({ label: strings.chat.thinkingStatus });
          }
          if (delta.content) {
            if (!writing) {
              writing = true;
              callbacks.onStatus?.({ label: strings.chat.writingStatus });
              console.log(
                "remote.brain.token",
                JSON.stringify({ n: delta.content.length }),
              );
            }
            emitted += delta.content;
            queue(delta.content);
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
    lastRequestId = handle.requestId;
    console.log(
      "remote.brain.stream",
      JSON.stringify({ requestId: lastRequestId, model: activeId }),
    );
    if (signal?.aborted) handle.abort();
  });
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
