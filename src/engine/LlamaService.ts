import { initLlama, type ContextParams, type LlamaContext, type TokenData } from "llama.rn";

/**
 * Engine locale — Fase 1: llama.rn (binding llama.cpp, MIT).
 * Contratto: QUALSIASI uscita (fine, errore, abort) chiama onDone/onError
 * esattamente una volta, così la UI non resta mai bloccata.
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

export function isEngineReady(): boolean {
  return context !== null;
}

export function getActiveModelId(): string | null {
  return activeModelId;
}

/** Carica il modello (idempotente per lo stesso modello). */
export async function initEngine(modelPath: string, modelId: string): Promise<void> {
  if (context && activeModelId === modelId) return;
  await disposeEngine();

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
}

export async function disposeEngine(): Promise<void> {
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
  if (!context) {
    callbacks.onError(new Error("Model not loaded. Download and load a model first."));
    return;
  }

  callbacks.onStatus?.({ label: "Thinking" });

  let finished = false;
  const finishOnce = (fn: () => void) => {
    if (!finished) {
      finished = true;
      fn();
    }
  };

  const abort = () => {
    void context?.stopCompletion().catch(() => undefined);
  };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();

  try {
    const result = await context.completion(
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
        chat_template_kwargs: { enable_thinking: false },
      },
      (data: TokenData) => {
        const delta = data.content ?? data.token ?? "";
        if (delta) callbacks.onDelta(delta, data.accumulated_text ?? "");
      },
    );

    const finalText = result.text ?? "";
    if (finalText) callbacks.onDelta(finalText, finalText);
    finishOnce(() => callbacks.onDone());
  } catch (error) {
    if (signal?.aborted) {
      // Abort volontario: non è un errore per l'utente.
      finishOnce(() => callbacks.onDone());
      return;
    }
    finishOnce(() => callbacks.onError(error instanceof Error ? error : new Error(String(error))));
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}
