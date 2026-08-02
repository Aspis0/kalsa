import {
  initLlama,
  type ContextParams,
  type LlamaContext,
  type RNLlamaMessagePart,
  type RNLlamaOAICompatibleMessage,
  type TokenData,
} from "llama.rn";

import { getStrings, type Locale } from "../i18n";

/**
 * Engine locale — Fase 1/2/4: llama.rn (binding llama.cpp, MIT).
 *
 * Garanzie (contratto con la UI):
 * - QUALSIASI uscita (successo, errore, abort, engine non pronto) chiude il
 *   turno con onDone/onError ESATTAMENTE una volta.
 * - init/dispose serializzati da un lock; completion sul context CATTURATO.
 * - dispose ferma e ATTENDE le completion attive prima di release().
 * - tool calling (Fase 2): loop agente con risultato reiniettato e sources.
 * - multimodale (Fase 4): mmproj caricato via initMultimodal (gate esplicito),
 *   immagini SOLO nel messaggio user corrente, ctx_shift:false.
 */

let context: LlamaContext | null = null;
let activeModelId: string | null = null;
let activeMmprojPath: string | null = null;
let activeEngineCtx = 0;

/** System prompt for the on-device model, localized via settings locale. */
export function buildSystemPrompt(locale: Locale, withTools: boolean): string {
  const strings = getStrings(locale);
  return withTools ? strings.systemPromptWithSearch : strings.systemPrompt;
}

const STOP_WORDS = [
  "<|im_end|>",
  "<|endoftext|>",
  "<|end_of_text|>",
  "<|end|>",
  "</s>",
  "<turn|>",
];

const MAX_TOOL_ROUNDS = 2;
const MAX_IMAGES_PER_TURN = 5;

export type EngineMessage = {
  role: "user" | "assistant";
  content: string;
  /** URI locali (file://) di immagini da allegare al messaggio USER corrente. */
  images?: string[];
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
  executeTool?: (
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<EngineToolResult>;
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

// Tracking completion attive: dispose ferma e ATTENDE prima di release().
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

export function isVisionEnabled(): boolean {
  return context !== null && activeMmprojPath !== null;
}

/**
 * Carica il modello (idempotente per la stessa coppia model+mmproj).
 * `mmprojPath` presente → initMultimodal obbligatorio: se restituisce false
 * o il supporto vision non risulta attivo, l'engine NON si considera pronto.
 */
export type EngineInitOptions = {
  mmprojPath?: string | null;
  nCtx?: number;
  cacheTypeK?: ContextParams["cache_type_k"];
  cacheTypeV?: ContextParams["cache_type_v"];
  kvUnified?: boolean;
  /** MTP (NextN speculative) embedded nel GGUF. */
  mtpNMax?: number;
  /** Settings locale for user-facing init errors (required). */
  locale: Locale;
};

/**
 * Carica il modello (idempotente per la stessa coppia model+mmproj).
 * `mmprojPath` presente → initMultimodal obbligatorio: se restituisce false
 * o il supporto vision non risulta attivo, l'engine NON si considera pronto.
 */
export function initEngine(modelPath: string, modelId: string, options: EngineInitOptions): Promise<void> {
  return withLifecycleLock(async () => {
    const strings = getStrings(options.locale);
    const engineCtx = options.nCtx ?? 8192;
    if (
      context &&
      activeModelId === modelId &&
      activeMmprojPath === (options.mmprojPath ?? null) &&
      activeEngineCtx === engineCtx
    )
      return;
    await disposeEngineLocked();

    const isMultimodal = Boolean(options.mmprojPath);
    const params: ContextParams = {
      model: modelPath,
      use_mlock: true,
      n_ctx: engineCtx, // context per modello (multi-chat)
      n_batch: 512,
      n_ubatch: 256,
      n_gpu_layers: 99, // Metal (iOS) / OpenCL (Android); senza GPU degrada a CPU
      flash_attn_type: "auto",
      cache_type_k: options.cacheTypeK ?? "q8_0", // KV quantizzata: q8_0 ≈98% qualità FP16
      cache_type_v: options.cacheTypeV ?? "q4_0", // V in q4 è la pratica comune (K resta q8)
      ...(options.kvUnified ? { kv_unified: true } : {}), // ibridi/ricorrenti (Qwen3.5 DeltaNet)
      // Richiesto per multimodal: senza context shifting i media restano ancorati.
      ctx_shift: isMultimodal ? false : true,
    };

    // MTP (NextN): speculative decoding embedded — ~1.5-2x più veloce.
    // La cache del DRAFT viene quantizzata come la target (non F16 di default).
    if (options.mtpNMax && options.mtpNMax > 0) {
      params.speculative = {
        type: "draft-mtp",
        n_max: options.mtpNMax,
        draft: {
          cache_type_k: options.cacheTypeK ?? "q8_0",
          cache_type_v: options.cacheTypeV ?? "q4_0",
        },
      };
    }

    context = await initLlama(params);
    activeModelId = modelId;
    activeMmprojPath = options.mmprojPath ?? null;
    activeEngineCtx = engineCtx;

    if (isMultimodal && options.mmprojPath) {
      const enabled = await context.initMultimodal({ path: options.mmprojPath, use_gpu: true });
      if (!enabled) {
        await disposeEngineLocked();
        throw new Error(strings.errors.visionInitFailed);
      }
      const support = await context.getMultimodalSupport().catch(() => null);
      if (!support?.vision) {
        await disposeEngineLocked();
        throw new Error(strings.errors.visionNotSupported);
      }
    }
  });
}

export function disposeEngine(): Promise<void> {
  return withLifecycleLock(disposeEngineLocked);
}

async function disposeEngineLocked(): Promise<void> {
  const current = context;
  context = null;
  activeModelId = null;
  activeMmprojPath = null;
  activeEngineCtx = 0;
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
      await current.releaseMultimodal();
    } catch {
      // best effort
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

/** Trasforma il messaggio user corrente in parts, con le immagini come image_url. */
function buildUserMessage(message: EngineMessage): RNLlamaOAICompatibleMessage {
  const images = (message.images ?? []).slice(0, MAX_IMAGES_PER_TURN);
  if (!images.length) {
    return { role: "user", content: message.content };
  }
  const parts: RNLlamaMessagePart[] = [{ type: "text", text: message.content }];
  for (const url of images) {
    parts.push({ type: "image_url", image_url: { url } });
  }
  return { role: "user", content: parts };
}

export type StreamTurnOptions = EngineTurnOptions & {
  /** Settings locale — drives system prompt language (required). */
  locale: Locale;
};

export async function streamAssistantTurn(
  messages: EngineMessage[],
  callbacks: EngineCallbacks,
  signal: AbortSignal | undefined,
  options: StreamTurnOptions,
): Promise<void> {
  const engine = context;
  const locale: Locale = options.locale;
  const strings = getStrings(locale);
  if (!engine) {
    callbacks.onError(new Error(strings.errors.modelNotLoaded));
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
  // Le immagini vivono SOLO nel messaggio user corrente.
  // MTP è text-only nel binding: con immagini la completion va in `speculative: false`.
  const hasImages = messages.some((message) => (message.images?.length ?? 0) > 0);
  // Le immagini vivono SOLO nel messaggio user corrente: system/tool/assistant
  // restano testuali (invariante del piano).
  // Il tipo del binding non dichiara tool_calls/tool_call_id sui messaggi
  // (li accetta a runtime): li modelliamo con un tipo locale e castiamo alla
  // chiamata completion.
  type ToolChatMessage =
    | RNLlamaOAICompatibleMessage
    | {
        role: "assistant";
        content?: string;
        tool_calls: Array<{ type: "function"; id?: string; function: { name: string; arguments: string } }>;
      }
    | { role: "tool"; tool_call_id: string; content: string };

  const userIndex = messages.length - 1;
  let currentMessages: ToolChatMessage[] = [
    { role: "system", content: buildSystemPrompt(locale, hasTools) },
    ...messages.map((message, index) =>
      index === userIndex ? buildUserMessage(message) : { role: message.role, content: message.content },
    ),
  ];

  // Accumulo locale del testo: streaming garantito anche se il campo
  // `accumulated_text` di llama.rn non fosse popolato dal binding.
  let streamedText = "";

  // Qwen3.5 emette un blocco `<think></think>` (vuoto) anche con
  // enable_thinking:false: va rimosso, insieme a eventuali tag residui.
  const cleanDelta = (text: string) =>
    text
      .replace(/<think>[\s\S]*?<\/think>/g, "")
      .replace(/<\/?think>/g, "");

  const emitFinalText = (raw: { text: string; content?: string }) => {
    const finalText = cleanDelta(
      typeof raw.content === "string" && raw.content.length > 0 ? raw.content : (raw.text ?? ""),
    );
    if (finalText) callbacks.onDelta(finalText, finalText);
    finishOnce(() => callbacks.onDone());
  };

  try {
    callbacks.onStatus?.({ label: strings.chat.thinkingStatus });

    for (let round = 0; round < (hasTools ? MAX_TOOL_ROUNDS : 1); round += 1) {
      const result = await trackCompletion(
        engine.completion(
          {
            messages: currentMessages as RNLlamaOAICompatibleMessage[],
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
            ...(hasImages ? { speculative: false as const } : {}),
          },
          (data: TokenData) => {
            if (finished || aborted) return;
            const raw = data.content ?? (hasTools ? "" : data.token) ?? "";
            const delta = cleanDelta(raw);
            if (delta) {
              streamedText += delta;
              callbacks.onDelta(delta, streamedText);
            }
          },
        ),
      );

      if (finished || aborted) return;

      if (result.context_full) {
        finishOnce(() =>
          callbacks.onError(new Error(strings.errors.contextFull)),
        );
        return;
      }

      const toolCalls = result.tool_calls ?? [];
      if (!toolCalls.length || !options?.executeTool) {
        emitFinalText(result);
        return;
      }

      // Round tool: esegui le chiamate, poi UN messaggio assistant con TUTTE le
      // tool_calls + i relativi risultati tool (formato OpenAI).
      // Gli id vengono NORMALIZZATI: il binding può restituire `id: null`
      // (json.type_error 302 al re-parse) — l'esempio ufficiale fa lo stesso.
      const normalizedCalls = toolCalls.slice(0, 2).map((call, index) => ({
        type: "function" as const,
        id: typeof call.id === "string" && call.id ? call.id : `call-${round}-${index}`,
        function: call.function,
      }));
      const executed: Array<{
        call: (typeof normalizedCalls)[number];
        content: string;
      }> = [];
      for (const call of normalizedCalls) {
        const name = call.function?.name ?? "";
        const args = parseToolArguments(call.function?.arguments);
        callbacks.onTool?.({ name, arguments: args });
        callbacks.onStatus?.({ label: strings.chat.searching });

        let toolContent: string;
        try {
          const outcome = await options.executeTool(name, args, signal);
          if (outcome.sources?.length) callbacks.onSources?.(outcome.sources);
          toolContent = (outcome.text ?? "").slice(0, 6000) || strings.errors.noResults;
        } catch (error) {
          toolContent = strings.errors.toolError.replace(
            "{message}",
            error instanceof Error ? error.message : String(error),
          );
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
          tool_call_id: entry.call.id,
          content: entry.content,
        })),
      ];
      callbacks.onStatus?.({ label: strings.chat.thinkingStatus });
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
