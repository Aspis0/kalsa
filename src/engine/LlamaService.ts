import { initLlama, type ContextParams, type LlamaContext, type TokenData } from "llama.rn";

/**
 * Engine locale — Fase 1/2: llama.rn (binding llama.cpp, MIT).
 *
 * Garanzie (contratto con la UI):
 * - QUALSIASI uscita (successo, errore, abort, engine non pronto) chiude il
 *   turno con onDone/onError ESATTAMENTE una volta.
 * - init/dispose serializzati da un lock (niente race tra switch modello,
 *   download completato e cleanup).
 * - ogni completion lavora sul context CATTURATO al momento della chiamata.
 * - dispose ferma e ATTENDE le completion attive prima di release().
 * - tool calling (Fase 2): loop agente fino a MAX_TOOL_ROUNDS round, con
 *   risultato tool reiniettato nel contesto e sources propagate alla UI.
 */

let context: LlamaContext | null = null;
let activeModelId: string | null = null;

const SYSTEM_PROMPT =
  "You are AI Chat, a private assistant running fully on this device (no cloud, no account). " +
  "Answer concisely and helpfully in the user's language. " +
  "You can also generate interactive mini-apps: JSON blocks with types like table, chart, calculator, " +
  "metric, tabs, expandable and html.";

const SYSTEM_PROMPT_WITH_SEARCH =
  "You are AI Chat, a private assistant running fully on this device (no cloud, no account). " +
  "Answer concisely and helpfully in the user's language. " +
  "When the user asks for current information (news, facts, prices, events), use the web_search tool. " +
  "Cite the sources you used by referencing their titles. " +
  "You can also generate interactive mini-apps: JSON blocks with types like table, chart, calculator, " +
  "metric, tabs, expandable and html.";

const STOP_WORDS = [
  "<|im_end|>",
  "<|endoftext|>",
  "<|end_of_text|>",
  "<|end|>",
  "</s>",
  "<turn|>",
];

const MAX_TOOL_ROUNDS = 2;

export type EngineMessage = {
  role: "user" | "assistant";
  content: string;
};

export type EngineTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type EngineToolResult = {
  text: string;
  sources?: unknown[];
};

export type EngineTurnOptions = {
  tools?: EngineTool[];
  executeTool?: (name: string, args: Record<string, unknown>) => Promise<EngineToolResult>;
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

// Tracking completion attive: dispose ferma e ATTENDE prima di release(),
// così un context non viene rilasciato mentre è in uso.
const activeCompletionSet = new Set<Promise<unknown>>();

function trackCompletion<T>(promise: Promise<T>): Promise<T> {
  const tracked = promise.finally(() => {
    activeCompletionSet.delete(tracked);
  });
  activeCompletionSet.add(tracked);
  return tracked;
}

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
    if (activeCompletionSet.size > 0) {
      // Ferma le completion in corso sul context VECCHIO e attendine la fine
      // (max 5s) prima di rilasciarlo.
      try {
        await current.stopCompletion();
      } catch {
        // best effort
      }
      await Promise.race([
        Promise.allSettled([...activeCompletionSet]).then(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, 5000)),
      ]);
    }
    try {
      await current.release();
    } catch {
      // rilascio best-effort
    }
  }
}

function parseToolArguments(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export async function streamAssistantTurn(
  messages: EngineMessage[],
  callbacks: EngineCallbacks,
  signal?: AbortSignal,
  options?: EngineTurnOptions,
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

  const hasTools = Boolean(options?.tools?.length && options?.executeTool);
  let currentMessages: Array<{
    role: string;
    content?: string;
    tool_calls?: Array<{ type: "function"; id?: string; function: { name: string; arguments: string } }>;
    tool_call_id?: string;
  }> = [
    { role: "system", content: hasTools ? SYSTEM_PROMPT_WITH_SEARCH : SYSTEM_PROMPT },
    ...messages.map((message) => ({ role: message.role, content: message.content })),
  ];

  // Accumulo locale del testo: streaming garantito anche se il campo
  // `accumulated_text` di llama.rn non fosse popolato dal binding.
  let streamedText = "";

  const emitFinalText = (raw: { text: string; content?: string }) => {
    // `content` è il testo filtrato (senza reasoning/tool call), coerente
    // con lo streaming; `text` è il testo grezzo.
    const finalText =
      typeof raw.content === "string" && raw.content.length > 0 ? raw.content : (raw.text ?? "");
    if (finalText) callbacks.onDelta(finalText, finalText);
    finishOnce(() => callbacks.onDone());
  };

  try {
    callbacks.onStatus?.({ label: "Thinking" });

    for (let round = 0; round < (hasTools ? MAX_TOOL_ROUNDS : 1); round += 1) {
      const result = await trackCompletion(
        engine.completion(
          {
            messages: currentMessages,
            ...(hasTools
              ? { tools: options!.tools as EngineTool[], tool_choice: "auto" as const }
              : {}),
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
            const delta = data.content ?? (hasTools ? "" : data.token) ?? "";
            if (delta) {
              streamedText += delta;
              callbacks.onDelta(delta, streamedText);
            }
          },
        ),
      );

      if (finished || aborted) return;

      const toolCalls = result.tool_calls ?? [];
      if (!toolCalls.length || !options?.executeTool) {
        emitFinalText(result);
        return;
      }

      // Round tool: esegui le chiamate, poi reinietta UN messaggio assistant
      // con TUTTE le tool_calls + i relativi risultati tool (formato OpenAI).
      const executed: Array<{
        call: { type: "function"; id?: string; function: { name: string; arguments: string } };
        content: string;
      }> = [];
      for (const call of toolCalls.slice(0, 2)) {
        const name = call.function?.name ?? "";
        const args = parseToolArguments(call.function?.arguments);
        callbacks.onTool?.({ name, arguments: args });
        callbacks.onStatus?.({ label: `Searching the web…` });

        let toolContent: string;
        try {
          const outcome = await options.executeTool(name, args);
          if (outcome.sources?.length) callbacks.onSources?.(outcome.sources);
          toolContent = (outcome.text ?? "").slice(0, 6000) || "No results.";
        } catch (error) {
          toolContent = `Tool error: ${error instanceof Error ? error.message : String(error)}`;
        }
        if (finished || aborted) return;

        executed.push({ call, content: toolContent });
      }

      currentMessages = [
        ...currentMessages,
        {
          role: "assistant",
          content: "",
          tool_calls: executed.map((entry) => entry.call),
        },
        ...executed.map((entry) => ({
          role: "tool",
          tool_call_id: entry.call.id ?? `call-${round}-${entry.call.function?.name ?? "tool"}`,
          content: entry.content,
        })),
      ];
      callbacks.onStatus?.({ label: "Thinking" });
    }

    // Raggiunto il massimo dei round senza risposta testuale: chiudi comunque.
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
