import { initLlama, type ContextParams, type LlamaContext, type TokenData } from "llama.rn";

/**
 * Engine locale — Fase 1: llama.rn (binding llama.cpp, MIT).
 *
 * Garanzie (contratto con la UI):
 * - QUALSIASI uscita (successo, errore, abort, engine non pronto) chiude il
 *   turno con onDone/onError ESATTAMENTE una volta.
 * - init/dispose serializzati da un lock (niente race tra switch modello,
 *   download completato e cleanup).
 * - ogni completion lavora sul context CATTURATO al momento della chiamata:
 *   un eventuale switch/release successivo non la tocca.
 */

let context: LlamaContext | null = null;
let activeModelId: string | null = null;

const SYSTEM_PROMPT =
  "You are AI Chat, a private assistant running fully on this device (no cloud, no account). " +
  "Answer concisely and helpfully in the user's language. " +
  "You can generate interactive mini-apps: JSON blocks with types like table, chart, calculator, " +
  "metric, tabs, expandable and html.";

const STOP_WORDS = [
  "<|im_end|>",
  "<|endoftext|>",
  "<|end_of_text|>",
  "<|end|>",
  "</s>",
  "<turn|>",
];

export type EngineMessage = {
  role: "user" | "assistant";
  content: string;
};

export type EngineCallbacks = {
  onDelta: (delta: string, full: string) => void;
  onStatus?: (status: { label: string }) => void;
  onTool?: (tool: unknown) => void;
  onSources?: (sources: unknown[]) => void;
  onMiniapp?: (miniapp: unknown) => void;
  onDone: () => void;
  onError: (error: Error) => void;
};

// ── Lock sul lifecycle ─────────────────────────────────────────────────────
let lifecycleChain: Promise<void> = Promise.resolve();

function withLifecycleLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = lifecycleChain.then(fn, fn);
  lifecycleChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export function isEngineReady(): boolean {
  return context !== null;
}

export function getActiveModelId(): string | null {
  return activeModelId;
}

export function initEngine(modelPath: string, modelId: string): Promise<void> {
  return withLifecycleLock(async () => {
    if (context && activeModelId === modelId) return;
    await disposeEngineLocked();

    const params: ContextParams = {
      model: modelPath,
      use_mlock: true,
      n_ctx: 4096,
      n_batch: 512,
      n_ubatch: 256,
      n_gpu_layers: 99, // Metal (iOS) / OpenCL (Android)
      flash_attn_type: "auto",
      cache_type_k: "q8_0",
      cache_type_v: "q8_0",
    };

    context = await initLlama(params);
    activeModelId = modelId;
  });
}

export function disposeEngine(): Promise<void> {
  return withLifecycleLock(disposeEngineLocked);
}

async function disposeEngineLocked(): Promise<void> {
  const current = context;
  context = null;
  activeModelId = null;
  if (current) {
    try {
      await current.release();
    } catch {
      // rilascio best-effort
    }
  }
}

export async function streamAssistantTurn(
  messages: EngineMessage[],
  callbacks: EngineCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const engine = context;
  if (!engine) {
    callbacks.onError(new Error("Model not loaded. Download and load a model first."));
    return;
  }

  let finished = false;
  let aborted = false;
  const finishOnce = (fn: () => void) => {
    if (!finished) {
      finished = true;
      fn();
    }
  };

  // Abort deterministico: chiude subito il turno e poi ferma la completion
  // sul context CATTURATO. I token successivi vengono ignorati.
  const abort = () => {
    aborted = true;
    finishOnce(() => callbacks.onDone());
    void engine.stopCompletion().catch(() => undefined);
  };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) {
    abort();
    signal.removeEventListener("abort", abort);
    return;
  }

  try {
    callbacks.onStatus?.({ label: "Thinking" });

    const result = await engine.completion(
      {
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...messages.map((message) => ({ role: message.role, content: message.content })),
        ],
        n_predict: 512,
        stop: STOP_WORDS,
        temperature: 0.7,
        top_k: 40,
        top_p: 0.95,
        enable_thinking: false,
        reasoning_format: "none",
        chat_template_kwargs: { enable_thinking: false },
      },
      (data: TokenData) => {
        if (finished || aborted) return;
        const delta = data.content ?? data.token ?? "";
        if (delta) callbacks.onDelta(delta, data.accumulated_text ?? "");
      },
    );

    if (finished || aborted) return;
    // `content` è il testo filtrato (senza reasoning/tool call), coerente
    // con lo streaming; `text` è il testo grezzo.
    const finalText =
      typeof (result as { content?: unknown }).content === "string"
        ? ((result as { content: string }).content as string)
        : (result.text ?? "");
    if (finalText) callbacks.onDelta(finalText, finalText);
    finishOnce(() => callbacks.onDone());
  } catch (error) {
    if (aborted || signal?.aborted) {
      finishOnce(() => callbacks.onDone());
      return;
    }
    finishOnce(() => callbacks.onError(error instanceof Error ? error : new Error(String(error))));
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}
