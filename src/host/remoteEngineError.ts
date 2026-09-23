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

/** The streamed host path humanizes machine codes only, matching AppShell. */
export function hostStreamErrorText(message: string, t: TranslateFn): string {
  return message.startsWith("remote_brain_")
    ? humanRemoteBrainError(message, t)
    : message;
}
