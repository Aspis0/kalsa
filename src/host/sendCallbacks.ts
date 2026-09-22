/**
 * The stream callbacks of one send run, fenced by the run's turn token —
 * the old `(myGen, runId)` pair replaced by `fence.owns(token)` /
 * `fence.apply` (`src/host/turnGuards.ts` pins that pairing — D2 rows 3-4).
 *
 * One NEW branch, the host's whole point (D1 row 23 / §1.5): a
 * `{ kind: "tool" }` payload now CAPTURES the tool name against the
 * assistant message, where the old consumer fell through to
 * `payload?.proposed_actions` — `undefined` for a tool — and dropped it.
 */
import { normalizeMiniapp } from "../domain/askAssistant";
import type { EngineTurnCallbacks } from "./engineTurnDeps";
import type { TurnFence, TurnToken } from "./turnGuards";
import { toolNameFromActionsPayload } from "./messageMapper";
import type { ChatCta, Message, ResultDownload, ResultImage } from "./hostMessage";

export interface RichCallbackCtx {
  fence: TurnFence;
  token: TurnToken;
  assistantId: string;
  setMessages: (updater: (prev: Message[]) => Message[]) => void;
  /** The volatile tool-row capture (host-owned, never persisted). */
  onToolCapture: (assistantId: string, name: string) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

export interface RichCallbacks {
  callbacks: EngineTurnCallbacks;
  /** Everything the turn-end finalize writes back onto the message. */
  captured: () => {
    modelEmittedText: string | undefined;
    modelEmittedSource: "parsed" | "raw" | undefined;
    thinkingText: string | undefined;
    /** The engine's own failure sentence, first non-empty one wins. */
    failureReason: string | undefined;
  };
}

export function createRichCallbacks(ctx: RichCallbackCtx): RichCallbacks {
  const { fence, token, assistantId, setMessages, onToolCapture, t } = ctx;
  const patch = (fn: (message: Message) => Message) =>
    setMessages((prev) =>
      fence.apply(token, prev, (state) =>
        state.map((message) => (message.id === assistantId ? fn(message) : message)),
      ),
    );

  let modelEmittedText: string | undefined;
  let modelEmittedSource: "parsed" | "raw" | undefined;
  let thinkingText: string | undefined;
  let failureReason: string | undefined;

  const callbacks: EngineTurnCallbacks = {
    onModelEmittedText: (text, source) => {
      if (!fence.owns(token)) return;
      if (typeof text === "string" && text.length > 0) {
        modelEmittedText = text;
        // Written with the string, by the same writer: the flag records the
        // mechanism that produced it.
        modelEmittedSource = source;
      }
    },
    onThinkingText: (text) => {
      if (!fence.owns(token)) return;
      if (typeof text === "string" && text.trim().length > 0) {
        thinkingText = text;
      }
    },
    // The engine's own failure sentence (§2.8's failed row): captured verbatim,
    // first non-empty wins, fenced like every other write of this run. An empty
    // capture stays absent — the renderer draws the reasonless honest line.
    onFailedReason: (reason) => {
      if (!fence.owns(token)) return;
      if (failureReason === undefined && typeof reason === "string" && reason.trim()) {
        failureReason = reason.trim();
      }
    },
    onStatus: (status) => {
      if (!fence.owns(token)) return;
      patch((message) => ({
        ...message,
        statusLabel: status.label,
        statusHistory: [...(message.statusHistory ?? []), status.label],
      }));
    },
    // Sources do not end the streaming (the tool round may continue):
    // update sources and clear the status label only.
    onSources: (sources) => {
      if (!fence.owns(token)) return;
      patch((message) => ({ ...message, sources, statusLabel: undefined }));
    },
    onActions: (payload: any) => {
      if (!fence.owns(token)) return;
      const toolName = toolNameFromActionsPayload(payload);
      if (toolName !== null) {
        onToolCapture(assistantId, toolName);
        return;
      }
      const proposed = Array.isArray(payload?.proposed_actions) ? payload.proposed_actions : [];
      const ctas = proposed
        .filter((action: any) => action?.executable === true && action?.output_id)
        .slice(0, 4)
        .map((action: any) => ({
          artifactType: action.artifact_type || null,
          contrastId: action.contrast_id || null,
          id: `output-${action.output_id}-${action.artifact_type || "artifact"}`,
          kind: "output" as const,
          label: action.label
            ? t("chat.openAction", { label: action.label })
            : t("chat.openOutputPicker"),
          outputId: action.output_id,
          target: "outputs",
        }));
      if (ctas.length) {
        patch((message) => ({ ...message, ctas: [...(message.ctas ?? []), ...ctas] }));
      }
    },
    onCta: (payload: ChatCta) => {
      if (!payload?.kind || !payload?.label) return;
      if (!fence.owns(token)) return;
      patch((message) => ({ ...message, ctas: [...(message.ctas ?? []), payload] }));
    },
    // Miniapp callback: store only, never ends the stream; invalid payloads
    // are ignored.
    onMiniapp: (miniapp: any) => {
      if (!fence.owns(token)) return;
      const normalized = normalizeMiniapp(miniapp);
      if (!normalized) return;
      patch((message) => ({
        ...message,
        miniapp: normalized as Message["miniapp"],
      }));
    },
    // Result images/downloads ride with the reply (RNA-seq job context).
    onImages: (imgs: ResultImage[], dls: ResultDownload[]) => {
      if (!fence.owns(token)) return;
      patch((message) => ({ ...message, images: imgs, downloads: dls }));
    },
  };

  return {
    callbacks,
    captured: () => ({ modelEmittedText, modelEmittedSource, thinkingText, failureReason }),
  };
}
