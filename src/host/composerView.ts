/**
 * What the root hands the shell for one render: the composer's decision
 * (phase → `composerState`), the send-enabled bit the field and control
 * dim on, the §2.7 attachment chips and the mapped transcript. Pure —
 * inputs in, draw data out — so the decisions stay in the node-testable
 * layer.
 */
import {
  attachmentViews,
  composerState,
  type AttachmentView,
  type ComposerState,
} from "../ui/shell/composerState";
import type { TranscriptMessage } from "../ui/shell/transcriptTypes";
import type { ModelPipelineState } from "./hostPipelineState";
import { hostComposerPhase } from "./composerPhase";
import { toTranscriptMessages } from "./messageMapper";
import type { LocalAttachment, Message } from "./hostMessage";

export interface ComposerViewInput {
  messages: Message[];
  toolsById: ReadonlyMap<string, readonly { name: string }[]>;
  draft: string;
  /** `t("chat.thinkingStatus")`, captured already-translated. */
  thinkingStatus: string;
  /** `t("chat.coolingStatus")`, captured already-translated. */
  coolingStatus: string;
  historyLoaded: boolean;
  thermalGated: boolean;
  sending: boolean;
  stopping: boolean;
  hasTokens: boolean;
  /** A translate holds the engine: the controller's `canSend` refused while
   *  `translatingId` was set (`AiChatPage.tsx:3605`). */
  translating: boolean;
  modelState: ModelPipelineState;
  engineResident: boolean;
  /** The composer's staged rows (D1 row 43): counted for the send control
   *  (an attachment-only send is a send) and named for the chip row. */
  attachments: readonly LocalAttachment[];
  /** A picked PDF is still being read — the `converting` phase. */
  converting: boolean;
}

export interface ComposerView {
  composer: ComposerState;
  /** Machine yes AND something to send (typed words OR staged rows): dims the
   *  control with no reason line. */
  sendEnabled: boolean;
  /** §2.7's chips, one per staged row — `composerState`'s own shape. */
  attachmentChips: AttachmentView[];
  transcript: TranscriptMessage[];
  /** The welcome gate: the host shows the first-open block only once the
   *  history load has settled. */
  historyLoaded: boolean;
}

export function composerView(input: ComposerViewInput): ComposerView {
  // The live turn's status label: the LAST streaming assistant — the label is
  // volatile and never enters the transcript's persisted shape.
  let statusLabel: string | undefined;
  for (let i = input.messages.length - 1; i >= 0; i--) {
    const message = input.messages[i];
    if (message.role === "assistant" && message.streaming === true) {
      statusLabel = message.statusLabel;
      break;
    }
  }
  const phase = hostComposerPhase({
    historyLoaded: input.historyLoaded,
    thermalGated: input.thermalGated,
    sending: input.sending,
    stopping: input.stopping,
    hasTokens: input.hasTokens,
    statusLabel,
    thinkingStatus: input.thinkingStatus,
    coolingStatus: input.coolingStatus,
    modelState: input.modelState,
    engineResident: input.engineResident,
    converting: input.converting,
  });
  // The single `attachment` field names the last-staged file (the state's
  // one-chip case); the ROW draws every chip through the same shape.
  const lastAttachment =
    input.attachments.length > 0 ? input.attachments[input.attachments.length - 1].name : null;
  const composer = composerState({ phase, attachment: lastAttachment });
  return {
    composer,
    // Machine yes, something to send, and no translate holding the engine:
    // the send control dims while a translation runs (controller `Chat:3605`);
    // the phase table itself is untouched. Rows count as something to send —
    // the controller's `!!draft.trim() || attachedItems.length > 0`
    // (`Chat:3603`).
    sendEnabled:
      composer.canSend &&
      (input.draft.trim().length > 0 || input.attachments.length > 0) &&
      !input.translating,
    attachmentChips: attachmentViews(input.attachments.map((item) => item.name)),
    transcript: toTranscriptMessages(input.messages, {
      thinkingStatus: input.thinkingStatus,
      toolsById: input.toolsById,
    }),
    historyLoaded: input.historyLoaded,
  };
}
