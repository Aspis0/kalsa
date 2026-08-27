/**
 * Search provider registry — active provider id (AsyncStorage) + factory.
 * Default: exa-mcp (free, no key).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import { getStrings, type Locale } from "../i18n";
import { exaSearch } from "./ExaMCP";
import { missingKeyError } from "./http";
import { createBraveProvider } from "./providers/brave";
import { createExaApiProvider } from "./providers/exaApi";
import { createTavilyProvider } from "./providers/tavily";
import type { SearchProvider } from "./SearchProvider";
import { secretStore, type SecretStore } from "./secretStore";

export type SearchProviderId = "exa-mcp" | "exa" | "brave" | "tavily";

export type ProviderMeta = {
  id: SearchProviderId;
  /**
   * English brand label for non-UI paths (error messages, logs).
   * UI must use i18n keys settings.provider* instead of this field.
   */
  label: string;
  needsKey: boolean;
  keyPlaceholder?: string;
};

export const PROVIDER_STORAGE_KEY = "kalsa.search.provider";
export const DEFAULT_PROVIDER_ID: SearchProviderId = "exa-mcp";

export const PROVIDERS: Record<SearchProviderId, ProviderMeta> = {
  "exa-mcp": {
    id: "exa-mcp",
    label: "Exa MCP (free)",
    needsKey: false,
  },
  exa: {
    id: "exa",
    label: "Exa API",
    needsKey: true,
    keyPlaceholder: "exa-…",
  },
  brave: {
    id: "brave",
    label: "Brave Search",
    needsKey: true,
    keyPlaceholder: "BSA…",
  },
  tavily: {
    id: "tavily",
    label: "Tavily",
    needsKey: true,
    keyPlaceholder: "tvly-…",
  },
};

export const PROVIDER_IDS: SearchProviderId[] = [
  "exa-mcp",
  "exa",
  "brave",
  "tavily",
];

function isProviderId(value: string | null | undefined): value is SearchProviderId {
  return value === "exa-mcp" || value === "exa" || value === "brave" || value === "tavily";
}

/**
 * Read the active provider id.
 * - Missing / unknown value → DEFAULT_PROVIDER_ID (ok).
 * - AsyncStorage failure → throws a localized error (callers that need
 *   operational fallback, e.g. searchWeb, should catch and use default).
 */
export async function getActiveProviderId(
  locale: Locale = "en",
): Promise<SearchProviderId> {
  try {
    const raw = await AsyncStorage.getItem(PROVIDER_STORAGE_KEY);
    return isProviderId(raw) ? raw : DEFAULT_PROVIDER_ID;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      getStrings(locale).errors.searchStorageUnavailable.replace("{message}", message),
    );
  }
}

export async function setActiveProviderId(id: SearchProviderId): Promise<void> {
  if (!isProviderId(id)) {
    throw new Error(`Unknown search provider: ${String(id)}`);
  }
  await AsyncStorage.setItem(PROVIDER_STORAGE_KEY, id);
}

/**
 * Resolve a concrete SearchProvider for the given id.
 * Keyed providers read the secret from secretStore and throw if missing.
 */
export async function getProvider(
  id: SearchProviderId,
  store: SecretStore = secretStore,
  locale: Locale = "en",
): Promise<SearchProvider> {
  const meta = PROVIDERS[id];
  if (!meta) {
    throw new Error(`Unknown search provider: ${String(id)}`);
  }

  if (id === "exa-mcp") {
    return exaSearch;
  }

  const key = await store.getSecret(id, locale);
  if (!key) {
    throw missingKeyError(meta.label, locale);
  }

  if (id === "exa") return createExaApiProvider(key, locale);
  if (id === "brave") return createBraveProvider(key, locale);
  return createTavilyProvider(key, locale);
}
