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
  invalid_url: "settings.remoteBrainUrlInvalid",
  invalid_scheme: "settings.remoteBrainUrlInvalid",
};

export function humanRemoteBrainError(
  code: string | undefined,
  t: Translate,
): string {
  if (!code) return t("settings.remoteBrainFailGeneric");
  const key = CODE_KEYS[code];
  if (key) return t(key);
  if (/^[a-z][a-z0-9_]*$/.test(code)) return t("settings.remoteBrainFailGeneric");
  return t("settings.remoteBrainFail", { error: code });
}
