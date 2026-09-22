/**
 * What the root hands the shell for one render: the composer's decision
 * (phase → `composerState`), the send-enabled bit the field and control
 * dim on, and the mapped transcript. Pure — inputs in, draw data out —
 * so the decisions stay in the node-testable layer.
 */
import { composerState, type ComposerState } from "../ui/shell/composerState";
import type { TranscriptMessage } from "../ui/shell/transcriptTypes";
import type { ModelPipelineState } from "../app/AppShell";
import { hostComposerPhase } from "./composerPhase";
import { toTranscriptMessages } from "./messageMapper";
import type { Message } from "./hostMessage";

export interface ComposerViewInput {
  messages: Message[];
  toolsById: ReadonlyMap<string, readonly { name: string }[]>;
  draft: string;
  /** `t("chat.thinkingStatus")`, captured already-translated. */
  thinkingStatus: string;
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
}

export interface ComposerView {
  composer: ComposerState;
  /** Machine yes AND a draft to send: dims the control with no reason line. */
  sendEnabled: boolean;
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
    modelState: input.modelState,
    engineResident: input.engineResident,
  });
  const composer = composerState({ phase, attachment: null });
  return {
    composer,
    // Machine yes, a draft to send, and no translate holding the engine:
    // the send control dims while a translation runs (controller `Chat:3605`);
    // the phase table itself is untouched.
    sendEnabled: composer.canSend && input.draft.trim().length > 0 && !input.translating,
    transcript: toTranscriptMessages(input.messages, {
      thinkingStatus: input.thinkingStatus,
      toolsById: input.toolsById,
    }),
    historyLoaded: input.historyLoaded,
  };
}
