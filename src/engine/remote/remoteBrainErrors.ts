/**
 * Map remote-brain error codes to copy the user can act on.
 * Snake_case codes must never reach the UI.
 */
import type { TranslationKey } from "../../i18n";

type Translate = (key: TranslationKey, vars?: Record<string, string>) => string;

const CODE_KEYS: Record<string, TranslationKey> = {
  remote_brain_url_missing: "settings.remoteBrainUrlMissing",
  empty_url: "settings.remoteBrainUrlMissing",
  remote_brain_https_required: "settings.remoteBrainHttpsRequired",
  remote_brain_token_required: "settings.remoteBrainTokenRequired",
  remote_brain_network: "settings.remoteBrainFailNetwork",
  remote_brain_send: "settings.remoteBrainFailNetwork",
  remote_brain_timeout: "settings.remoteBrainFailTimeout",
  remote_brain_busy: "settings.remoteBrainFailBusy",
  invalid_url: "settings.remoteBrainUrlInvalid",
  invalid_scheme: "settings.remoteBrainUrlInvalid",
};

/** HTTP failures carry the status: remote_brain_http_500. */
const HTTP_STATUS_CODE = /^remote_brain_http_(\d{3})$/;

/** Machine codes are a single lower_snake_case token; user copy never is. */
const INTERNAL_CODE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;

/** True for codes like `remote_brain_network` — these must never be shown. */
export function isInternalErrorCode(message: string): boolean {
  return INTERNAL_CODE.test(message.trim());
}

export function humanRemoteBrainError(
  code: string | undefined,
  t: Translate,
): string {
  if (!code) return t("settings.remoteBrainFailGeneric");
  const key = CODE_KEYS[code];
  if (key) return t(key);
  const http = HTTP_STATUS_CODE.exec(code);
  if (http) return t("settings.remoteBrainFailServer", { status: http[1] });
  if (isInternalErrorCode(code)) return t("settings.remoteBrainFailGeneric");
  return t("settings.remoteBrainFail", { error: code });
}
