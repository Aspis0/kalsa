import { humanRemoteBrainError } from "../engine/remote/remoteBrainErrors";
import type { TranslateFn } from "../i18n";

/** Remote transport and native exceptions are always translated before UI. */
export function hostEngineErrorText(
  message: string,
  remote: boolean,
  t: TranslateFn,
): string {
  return remote ? humanRemoteBrainError(message, t) : message;
}
