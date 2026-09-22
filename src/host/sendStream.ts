/**
 * The typed seam of the send path — its shape, not its engine.
 *
 * What a send takes from the UI (draft text, attachment, history, notes /
 * research flags) and what it hands back over time (token, tool name,
 * sources) until exactly one terminal result. Semantics pinned from the
 * old path:
 *
 * - Backends RESOLVE on failure and report via onFailed(reasonKey)
 *   (AiChatPage:2693, AppShell:5399); a throw becomes the default key.
 * - Abort is classified from the AbortSignal, never from a callback: the
 *   engine resolves through its normal path after an abort
 *   (LlamaService:4554), so "done" and "aborted" share a resolution.
 * - Stopped before any token ⇒ aborted (failed, chat.sendAborted unless a
 *   backend already named the failure — AiChatPage:3101-3105); stopped
 *   after tokens ⇒ interrupted: the partial is kept and the turn-end save
 *   hook is still adopted (AiChatPage:2718-2724, 2802-2810).
 * - Events after the terminal result are dropped.
 *
 * The engine stays behind `SendEngine`; tests drive a fake.
 */

/** Mirror of the composer's attachment type (AiChatPage:229), narrowed to what a send consumes. */
export interface SendAttachment {
  id: string;
  kind: "image" | "pdf" | "document";
  name: string;
  uri: string;
  pages?: string[];
  pageCount?: number;
  /** Library document id when kind === "document". */
  libraryDocId?: string;
}

export interface SendRequest {
  /** Draft text as typed, trimmed by the caller. */
  text: string;
  attachments?: readonly SendAttachment[];
  /** UI history snapshot assembled for this turn. */
  history?: readonly unknown[];
  /** Persistable user text without doc hints (AiChatPage:335). */
  lastUserBare?: string;
  options?: {
    research?: boolean;
    notes?: boolean;
    /** Composer notice for a degraded option (e.g. truncated notes). */
    onNotice?: () => void;
  };
}

/** What the UI observes while the turn runs. Terminal state arrives on the result. */
export interface SendUiHandlers {
  onToken(delta: string, full: string): void;
  onTool?(name: string): void;
  onSources?(sources: readonly unknown[]): void;
}

/** What the engine adapter may emit during the turn. */
export interface SendEngineEmit {
  onDelta(delta: string, full: string): void;
  onTool?(name: string): void;
  onSources?(sources: readonly unknown[]): void;
  /** Named failure on a resolving backend; first key wins. */
  onFailed?(reasonKey: string): void;
}

export interface SendEngineResult {
  /** Deferred turn-end hook: run after the KV save settles (AppShell:5358). */
  afterSessionSave?: () => void;
}

export type SendEngine = (
  request: SendRequest,
  emit: SendEngineEmit,
  signal: AbortSignal,
) => Promise<SendEngineResult | void>;

export type SendResult =
  /** Clean completion; adopt afterSessionSave. */
  | { kind: "done"; afterSessionSave?: () => void }
  /** Stopped after tokens: keep the partial, mark it interrupted, still save. */
  | { kind: "interrupted"; afterSessionSave?: () => void }
  /** Stopped before any token: failed, roll back, no save hook adopted. */
  | { kind: "aborted"; reasonKey: string }
  /** Backend/throw failure: roll back and surface the key. */
  | { kind: "failed"; reasonKey: string; message?: string; afterSessionSave?: () => void };

const DEFAULT_FAILURE_KEY = "chat.serviceUnreachable";
const ABORT_FAILURE_KEY = "chat.sendAborted";

export async function runSendStream(
  engine: SendEngine,
  request: SendRequest,
  ui: SendUiHandlers,
  signal: AbortSignal,
): Promise<SendResult> {
  let terminal = false;
  let anyTextStreamed = false;
  let namedKey: string | null = null;
  let thrown: Error | null = null;

  const emit: SendEngineEmit = {
    onDelta(delta, full) {
      if (terminal) return;
      anyTextStreamed = true;
      ui.onToken(delta, full);
    },
    onTool(name) {
      if (!terminal) ui.onTool?.(name);
    },
    onSources(sources) {
      if (!terminal) ui.onSources?.(sources);
    },
    onFailed(reasonKey) {
      if (terminal) return;
      if (namedKey === null && typeof reasonKey === "string" && reasonKey.trim()) {
        namedKey = reasonKey;
      }
    },
  };

  let result: SendEngineResult | void = undefined;
  try {
    result = await engine(request, emit, signal);
  } catch (err) {
    thrown = err instanceof Error ? err : new Error(String(err));
  }
  terminal = true;

  const save = result ? result.afterSessionSave : undefined;
  const failure = namedKey ?? (thrown ? DEFAULT_FAILURE_KEY : null);
  if (signal.aborted) {
    if (anyTextStreamed) {
      return { kind: "interrupted", afterSessionSave: save };
    }
    // A named failure survives the abort default (AiChatPage:3103 only
    // overwrites the default key).
    return { kind: "aborted", reasonKey: failure ?? ABORT_FAILURE_KEY };
  }
  if (failure !== null) {
    return {
      kind: "failed",
      reasonKey: failure,
      ...(thrown ? { message: thrown.message } : {}),
      afterSessionSave: save,
    };
  }
  return { kind: "done", afterSessionSave: save };
}
