/**
 * Shared HTTP helpers for search providers (timeout + status → localized error).
 */
import { getStrings, type Locale } from "../i18n";

const DEFAULT_TIMEOUT_MS = 15_000;

/** Combine caller AbortSignal with a hard timeout (same pattern as ExaMCP). */
export async function withTimeoutSignal<T>(
  signal: AbortSignal | undefined,
  fn: (combined: AbortSignal) => Promise<T>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
  const combined = signal
    ? AbortSignal.any([signal, timeoutController.signal])
    : timeoutController.signal;
  try {
    return await fn(combined);
  } finally {
    clearTimeout(timer);
  }
}

/** Map non-2xx HTTP status to a localized, actionable Error. */
export function httpStatusError(
  status: number,
  providerLabel: string,
  locale: Locale,
): Error {
  const errors = getStrings(locale).errors;
  if (status === 401 || status === 403) {
    return new Error(errors.searchKeyInvalid.replace("{provider}", providerLabel));
  }
  if (status === 429) {
    return new Error(errors.searchRateLimited.replace("{provider}", providerLabel));
  }
  return new Error(
    errors.searchFailed
      .replace("{provider}", providerLabel)
      .replace("{message}", `HTTP ${status}`),
  );
}

export function missingKeyError(providerLabel: string, locale: Locale): Error {
  return new Error(
    getStrings(locale).errors.searchKeyMissing.replace("{provider}", providerLabel),
  );
}

/** Response body shape invalid — never include the body in the message. */
export function invalidResponseError(providerLabel: string, locale: Locale): Error {
  return new Error(
    getStrings(locale).errors.searchInvalidResponse.replace("{provider}", providerLabel),
  );
}
