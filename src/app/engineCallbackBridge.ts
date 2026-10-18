/**
 * The single bridge from chat-screen callbacks into EngineCallbacks.
 *
 * Lives alone so a test can assert every EngineCallbacks key is forwarded:
 * onThinkingText was once silently dropped here — optional on both sides, so
 * tsc could not see it, and three engine producers became runtime no-ops.
 * Adding a key to EngineCallbacks without adding it to FORWARDED_KEYS below
 * is a compile error, and the test pins the built object's shape.
 */
import type { EngineCallbacks } from "../engine/LlamaService";
import type { EmissionSource } from "../engine/modelEmittedText";

/** Which span an `onThinkingText` call carries. */
export type ThinkingMeta = { final?: boolean };

/** UI-side callback surface the bridge forwards (structural; fed `any`). */
export type BridgedUiCallbacks = {
  onDelta?: (delta: string, full: string) => void;
  onModelEmittedText?: (text: string, source: EmissionSource) => void;
  /** `final` marks the round's reconciled span: authoritative, and allowed to
   *  be empty — streaming updates never are. */
  onThinkingText?: (text: string, meta?: ThinkingMeta) => void;
  onStatus?: (status: { label: string }) => void;
  onSources?: (sources: any[]) => void;
  onMiniapp?: (miniapp: any) => void;
  onMailCards?: (cards: any) => void;
  onMailDraft?: (draft: any) => void;
  onBrowserCard?: (card: any) => void;
  onBrowserOutcome?: (outcome: any) => void;
  onLinksAsText?: () => void;
  onActions?: (payload: any) => void;
};

/** Compile-time exhaustive key list — see the module docstring. */
const FORWARDED_KEYS = {
  onDelta: true,
  onStatus: true,
  onTool: true,
  onSources: true,
  onMiniapp: true,
  onMailCards: true,
  onMailDraft: true,
  onBrowserCard: true,
  onBrowserOutcome: true,
  onLinksAsText: true,
  onModelEmittedText: true,
  onThinkingText: true,
  onDone: true,
  onError: true,
} satisfies Record<keyof EngineCallbacks, true>;

export const ENGINE_CALLBACK_KEYS = Object.keys(
  FORWARDED_KEYS,
) as (keyof EngineCallbacks)[];

export function bridgeEngineCallbacks(
  ui: BridgedUiCallbacks,
  hooks: {
    /** Track the full streamed text (AppShell: assistantFull). */
    onDeltaFull?: (full: string) => void;
    /** Localized web-source mapper (AppShell: mapSearchSourcesToChat). */
    mapSource?: (sources: any[]) => any[];
    /** Turn finished cleanly (telemetry + extract arming stay in AppShell). */
    onDone: () => void;
    /** Turn failed (error surfacing stays in AppShell). */
    onError: (error: Error) => void;
  },
): EngineCallbacks {
  return {
    onDelta: (delta, full) => {
      hooks.onDeltaFull?.(full);
      ui.onDelta?.(delta, full);
    },
    onModelEmittedText: (text, source) => ui.onModelEmittedText?.(text, source),
    onThinkingText: (text, meta) => ui.onThinkingText?.(text, meta),
    onStatus: (status) => ui.onStatus?.(status),
    onSources: (sources) =>
      ui.onSources?.(hooks.mapSource ? hooks.mapSource(sources as any[]) : (sources as any[])),
    onMiniapp: (miniapp) => ui.onMiniapp?.(miniapp),
    onMailCards: (cards) => ui.onMailCards?.(cards),
    onMailDraft: (draft) => ui.onMailDraft?.(draft),
    onBrowserCard: (card) => ui.onBrowserCard?.(card),
    onBrowserOutcome: (outcome) => ui.onBrowserOutcome?.(outcome),
    onLinksAsText: () => ui.onLinksAsText?.(),
    onTool: (tool) => ui.onActions?.({ kind: "tool", tool }),
    onDone: hooks.onDone,
    onError: hooks.onError,
  };
}
