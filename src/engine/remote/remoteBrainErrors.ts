/**
 * Map remote-brain error codes to copy the user can act on.
 * Snake_case codes must never reach the UI, and neither must a native
 * exception: anything unrecognised fails closed to human copy.
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
  // The SSE channel died mid-stream: the computer was reachable, then was not.
  remote_brain_sse_error: "settings.remoteBrainFailNetwork",
  remote_brain_stale_init: "settings.remoteBrainFailStaleInit",
  remote_brain_model_required: "settings.remoteBrainFailModelRequired",
  remote_brain_model_missing: "settings.remoteBrainFailModelMissing",
  remote_brain_timeout: "settings.remoteBrainFailTimeout",
  remote_brain_busy: "settings.remoteBrainFailBusy",
  invalid_url: "settings.remoteBrainUrlInvalid",
  invalid_scheme: "settings.remoteBrainUrlInvalid",
  // Status 0 means the request never got an HTTP answer at all.
  remote_brain_http_0: "settings.remoteBrainFailNetwork",
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
  // Own properties only: a code off the wire ("constructor", "__proto__") must
  // not resolve to an inherited member and leak into `t()`.
  const key = Object.prototype.hasOwnProperty.call(CODE_KEYS, code)
    ? CODE_KEYS[code]
    : undefined;
  if (key) return t(key);
  const http = HTTP_STATUS_CODE.exec(code);
  if (http) return t("settings.remoteBrainFailServer", { status: http[1] });
  // Unknown code, internal English string or a native exception
  // ("fetch failed: java.net.ConnectException…"): never echo it back.
  return t("settings.remoteBrainFailGeneric");
}
