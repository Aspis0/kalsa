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

/** The streamed host path humanizes machine codes only, matching AppShell.
 *  `contractCode` is the turn route's own flag: every failure of that route is
 *  a code (or a transport code), and an unknown one must read as the generic
 *  sentence rather than as itself. */
export function hostStreamErrorText(
  message: string,
  t: TranslateFn,
  contractCode = false,
): string {
  if (contractCode) return humanContractFailure(message, t);
  if (message.startsWith("remote_brain_")) {
    return humanRemoteBrainError(message, t);
  }
  // The turn route fails with the contract's own code (`busy`, `no_runner`, a
  // mail code). Everything else is the engine's own sentence, shown as it is.
  if (isContractFailureCode(message)) return humanContractFailure(message, t);
  return message;
}
