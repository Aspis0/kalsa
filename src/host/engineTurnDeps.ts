/**
 * The dependency surface of the lifted engine half
 * (`AppShell.tsx:5363-6719`, handleSendStream).
 *
 * The lift rule: the body moves verbatim and these names are destructured at
 * the top of each phase so the moved code compiles unchanged. Everything NOT
 * here is a module import — services, pure helpers, the compactor maps — and
 * is imported directly, never injected. Members are host-owned STATE:
 * refs the old component held, setters it owned, values it captured in the
 * useCallback dependency array.
 *
 * `EngineTurnCallbacks` mirrors the old screen's `StreamCallbacks`
 * (AiChatPage.tsx:261-272) structurally, so the single
 * `bridgeEngineCallbacks` call at the stream site stays byte-identical.
 */
import type { ConversationsState } from "../conversations/ConversationsStore";
import type { PersonasPersisted } from "../conversations/PersonasStore";
import type { LibraryState } from "../documents/DocumentLibrary";
import type { ContextMode, HistoryRoleMessage } from "../context/compactor";
import type { DecodeMeasurement } from "../engine/deviceThroughput";
import type { EngineTurnOptions } from "../engine/LlamaService";
import type { ModelInfo } from "../engine/ModelRegistry";
import type { bumpForegroundIdleRef } from "../app/foregroundIdleDispose";
import type { BridgedUiCallbacks } from "../app/engineCallbackBridge";
import type * as MemoryStore from "../memory/MemoryStore";
import type { ToolChoiceMode } from "../bench/benchConfig";
import type { Locale, TranslateFn } from "../i18n";
import type { ChatCta, LocalAttachment, ResultDownload, ResultImage } from "./hostMessage";

export type EngineTurnCallbacks = BridgedUiCallbacks & {
  onCta?: (payload: ChatCta) => void;
  onImages?: (images: ResultImage[], downloads: ResultDownload[]) => void;
  onFailed?: (reasonKey: string) => void;
  /**
   * The engine's own failure REASON (raw message or the host's localized
   * line), alongside the catalogued `onFailed` key: §2.8's failed row shows
   * the engine's words, never a generic apology. The chat side captures it
   * onto `Message.failureReason` at finalize.
   */
  onFailedReason?: (reason: string) => void;
};

export interface EngineTurnDeps {
  t: TranslateFn;
  locale: Locale;
  thermalHardGateRef: { current: boolean };
  /** Render-time value of the hook's `gated` — the old useCallback captured it. */
  thermalHardGated: boolean;
  setStreaming: (streaming: boolean) => void;
  streamInFlightRef: { current: boolean };
  nativeTurnStartAtRef: { current: number };
  bumpForegroundIdleRef: typeof bumpForegroundIdleRef;
  lastUserRawRef: { current: string };
  activeDocumentAttachmentRef: { current: LocalAttachment | null };
  onMiniappRef: { current: (miniapp: unknown) => void };
  memoryExtractRef: { current: Promise<void> | null };
  memoryExtractCancelRef: { current: (() => void) | null };
  memoryEnabledRef: { current: boolean };
  memoryFactsRef: { current: MemoryStore.MemoryFact[] };
  injectedFactsRef: { current: string[] };
  setMemoryFacts: (facts: MemoryStore.MemoryFact[]) => void;
  refreshMemoryFacts: () => Promise<void>;
  ensureEngineForModel: (model: ModelInfo) => Promise<boolean>;
  currentModel: ModelInfo;
  documentLibraryRef: { current: LibraryState };
  agentOptionsRef: { current: EngineTurnOptions };
  agentOptions: EngineTurnOptions;
  chatEngineCtxRef: { current: number };
  conversationsRef: { current: ConversationsState };
  personasStateRef: { current: PersonasPersisted };
  activePersonaIdRef: { current: string };
  recordDecodeSample: (model: ModelInfo, sample: DecodeMeasurement) => void;
  contextModeRef: { current: ContextMode };
  compactionEnabledRef: { current: boolean };
  toolhelpRef: { current: boolean };
}

/** Everything one send closes over that a later phase still needs. */
export interface TurnInputs {
  text: string;
  callbacks: EngineTurnCallbacks;
  signal: AbortSignal;
  attachments?: LocalAttachment[];
  history?: unknown[];
  sendOpts?: { research?: boolean; notes?: boolean; onNotice?: () => void };
  chatId: string;
  hasImages: boolean;
  validatedHistory: HistoryRoleMessage[];
  contextMode: ContextMode;
  /** Resolved before any phase runs (notes injection may rewrite it). */
  promptText: string;
  toolChoiceMode: ToolChoiceMode;
  turnCiswireFlags: number;
}
