/**
 * Secure storage for search-provider API keys.
 * Single source of truth: always read/write through expo-secure-store.
 * Never cache secrets in memory (avoids desync / accidental logging).
 */
import * as SecureStore from "expo-secure-store";

import { getStrings, type Locale } from "../i18n";

const KEY_PREFIX = "kalsa.secret.";

/** Providers that may store an API key (excludes free exa-mcp). */
const KEYED_PROVIDER_IDS = new Set(["exa", "brave", "tavily"]);

function storageKey(providerId: string): string {
  return `${KEY_PREFIX}${providerId}`;
}

function secureStoreError(locale: Locale, cause: unknown): Error {
  const message = cause instanceof Error ? cause.message : String(cause);
  return new Error(
    getStrings(locale).errors.secureStoreFailed.replace("{message}", message),
  );
}

function isNotFoundError(err: unknown): boolean {
  const message = err instanceof Error ? err.message.toLowerCase() : "";
  return message.includes("could not be found") || message.includes("not found");
}

/** Reject unknown ids and free providers that never store a key. */
function assertKeyProviderId(providerId: string, locale: Locale): void {
  if (!KEYED_PROVIDER_IDS.has(providerId)) {
    throw new Error(
      getStrings(locale).errors.invalidSecretProvider.replace("{id}", providerId),
    );
  }
}

async function deleteItemRaw(providerId: string, locale: Locale): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(storageKey(providerId));
  } catch (err) {
    if (isNotFoundError(err)) return;
    throw secureStoreError(locale, err);
  }
}

/** Persist an API key for a provider. Empty/whitespace deletes the entry. */
export async function setSecret(
  providerId: string,
  key: string,
  locale: Locale = "en",
): Promise<void> {
  assertKeyProviderId(providerId, locale);
  const trimmed = key.trim();
  // Empty → delete without calling deleteSecret (avoids double-wrapping errors).
  if (!trimmed) {
    await deleteItemRaw(providerId, locale);
    return;
  }
  try {
    await SecureStore.setItemAsync(storageKey(providerId), trimmed);
  } catch (err) {
    throw secureStoreError(locale, err);
  }
}

/** Read API key; null if absent. */
export async function getSecret(
  providerId: string,
  locale: Locale = "en",
): Promise<string | null> {
  assertKeyProviderId(providerId, locale);
  try {
    const value = await SecureStore.getItemAsync(storageKey(providerId));
    if (value == null || value.trim() === "") return null;
    return value;
  } catch (err) {
    throw secureStoreError(locale, err);
  }
}

/** Remove a stored API key (no-op if missing). */
export async function deleteSecret(
  providerId: string,
  locale: Locale = "en",
): Promise<void> {
  assertKeyProviderId(providerId, locale);
  await deleteItemRaw(providerId, locale);
}

export type SecretStore = {
  setSecret: typeof setSecret;
  getSecret: typeof getSecret;
  deleteSecret: typeof deleteSecret;
};

export const secretStore: SecretStore = {
  setSecret,
  getSecret,
  deleteSecret,
};
