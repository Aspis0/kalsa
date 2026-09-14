/**
 * Optional remote-brain Bearer token. Same prefix as search secrets
 * (`kalsa.secret.remote-brain`). Empty default — loopback mtplx has no auth.
 */
import * as SecureStore from "expo-secure-store";

const STORAGE_KEY = "kalsa.secret.remote-brain";

function isNotFoundError(err: unknown): boolean {
  const message = err instanceof Error ? err.message.toLowerCase() : "";
  return message.includes("could not be found") || message.includes("not found");
}

export async function getRemoteBrainToken(): Promise<string | null> {
  try {
    const value = await SecureStore.getItemAsync(STORAGE_KEY);
    if (value == null || value.trim() === "") return null;
    return value.trim();
  } catch (err) {
    if (isNotFoundError(err)) return null;
    throw err;
  }
}

export async function setRemoteBrainToken(token: string): Promise<void> {
  const trimmed = token.trim();
  if (!trimmed) {
    try {
      await SecureStore.deleteItemAsync(STORAGE_KEY);
    } catch (err) {
      if (!isNotFoundError(err)) throw err;
    }
    return;
  }
  await SecureStore.setItemAsync(STORAGE_KEY, trimmed);
}
