/**
 * What one send composes OUT of the draft and its attachments before the
 * engine sees it: the doc-hint annotation, the empty-caption fallback and the
 * two notices the controller raised around them (`AiChatPage.tsx:2438-2477`).
 *
 * Extracted from the controller's `handleSend` and from this host's send path
 * so the rules are testable in node (the send file's import graph reaches the
 * native engine) — and so `sendHost.ts` can hold its size budget without the
 * composition becoming unreadable inside the claim/stream machinery.
 *
 * Pure: strings and booleans in, one string plus at most ONE notice out.
 */
import { hasDeepResearchTrigger, stripDeepResearchTrigger } from "../research/plan";
import type { TranslationKey } from "../i18n";
import { documentHints, visionInputPresent } from "./attachments";
import type { LocalAttachment } from "./hostMessage";

export interface SendCompositionInput {
  /** The draft as typed, trimmed by the caller. May be empty: an
   *  attachment-only send is a send (controller `Chat:3676`). */
  trimmed: string;
  /** The snapshot the send will stamp on the user message. */
  attachments: readonly LocalAttachment[];
  /** Armed-or-keyword research for this send (the arms already resolved). */
  research: boolean;
  /** `Boolean(currentModel.mmproj)` — the controller's `supportsVision`
   *  (`AppShell.tsx:7058`). */
  visionCapable: boolean;
  /** `t("chat.lookAtAttachedFile")`, captured already-translated. */
  attachedFileLabel: string;
}

export interface SendComposition {
  /** What the engine receives as the user's text (controller `Chat:2471-2477`). */
  modelText: string;
  /** At most one notice: vision-unsupported and research-ignoring-images are
   *  mutually exclusive by construction (one needs `!visionCapable`, the
   *  other `visionCapable`), so the one-slot notice can never drop one. */
  notice: TranslationKey | null;
}

export function composeSendText(input: SendCompositionInput): SendComposition {
  const hasVisionInput = visionInputPresent(input.attachments);
  const hints = documentHints(input.attachments);

  const researchQuestion = input.research
    ? stripDeepResearchTrigger(input.trimmed) || input.trimmed
    : input.trimmed;
  const modelText = researchQuestion
    ? hints
      ? `${researchQuestion}\n\n${hints}`
      : researchQuestion
    : hints || input.attachedFileLabel;

  let notice: TranslationKey | null = null;
  if (hasVisionInput && !input.visionCapable) {
    notice = "chat.visionUnsupportedNotice";
  } else if (input.research && hasVisionInput && input.visionCapable) {
    // Research is text-only: on a vision-capable model an attached image would
    // be silently dropped — say so (controller `Chat:2465-2468`).
    notice = "chat.deepResearchIgnoringImages";
  }
  return { modelText, notice };
}
