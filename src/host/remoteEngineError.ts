import { humanRemoteBrainError } from "../engine/remote/remoteBrainErrors";
import {
  humanContractFailure,
  isContractFailureCode,
} from "../engine/remote/phoneChatFailures";
import type { TranslateFn } from "../i18n";

/** Remote transport and native exceptions are always translated before UI. */
export function hostEngineErrorText(
  message: string,
  remote: boolean,
  t: TranslateFn,
): string {
  return remote ? humanRemoteBrainError(message, t) : message;
}

/** The streamed host path humanizes machine codes only, matching AppShell. */
export function hostStreamErrorText(message: string, t: TranslateFn): string {
  if (message.startsWith("remote_brain_")) {
    return humanRemoteBrainError(message, t);
  }
  // The turn route fails with the contract's own code (`busy`, `no_runner`, a
  // mail code). Everything else is the engine's own sentence, shown as it is.
  if (isContractFailureCode(message)) return humanContractFailure(message, t);
  return message;
}
