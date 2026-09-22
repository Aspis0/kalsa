/**
 * One send run's terminal outcome: what happens to the assistant placeholder
 * and the history once `runSendStream` resolves — MOVED OUT of `sendHost.ts`
 * (`applySendOutcome` was that file's inline `result.kind` chain) so the
 * attachment snapshot could land there without raising the ratchet:
 * `sendHost.ts` sits at 350 of 350 and may only shed weight
 * (`fileSize.test.ts`). A move, not a redesign — every branch, comment and
 * call is the one the send file used to inline.
 *
 * Node-testable for the same reason `sendDraft.ts` is: the send file's
 * import graph reaches the native engine, this file reaches only the pure
 * finalize seam's types (the finalize itself stays behind its own import).
 */
import type { TranslateFn } from "../i18n";
import type { RichCallbacks } from "./sendCallbacks";
import type { SendResult } from "./sendStream";
import { finalizeAssistantTurn, type FinalizeCtx } from "./sendFinalize";

export type SendOutcomeCaptured = ReturnType<RichCallbacks["captured"]>;

export type SendOutcomeCtx = FinalizeCtx & { t: TranslateFn };

export function applySendOutcome(
  result: SendResult,
  ctx: SendOutcomeCtx,
  captured: SendOutcomeCaptured,
): void {
  if (result.kind === "aborted") {
    // Stop before any token: remove the empty placeholder (no ghost bubble).
    ctx.setMessages((prev) =>
      ctx.fence.apply(ctx.token, prev, (state) =>
        state.filter((message) => message.id !== ctx.assistantId),
      ),
    );
    return;
  }
  if (result.kind === "failed") {
    // A backend that failed without a delta still gets honest text; a
    // ⚠️ delta already streamed is kept as-is. The message is MARKED failed
    // (§2.8) with the engine's own reason when one exists — never a
    // catalogued apology; an absent reason draws the reasonless honest line
    // instead.
    finalizeAssistantTurn(ctx, captured, {
      interrupted: false,
      fallbackText: ctx.t("chat.serviceUnreachable"),
      failure: {
        reason: captured.failureReason ?? result.message?.trim(),
        thermal: result.reasonKey === "chat.thermalHardGateBody",
      },
      afterSessionSave: result.afterSessionSave,
    });
    return;
  }
  // done | interrupted: the partial stays, marked interrupted when stopped
  // after tokens; the turn-end save and the extract release run for both.
  finalizeAssistantTurn(ctx, captured, {
    interrupted: result.kind === "interrupted",
    afterSessionSave: result.afterSessionSave,
  });
}
