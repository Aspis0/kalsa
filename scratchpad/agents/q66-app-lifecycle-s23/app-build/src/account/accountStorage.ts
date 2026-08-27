import AsyncStorage from "@react-native-async-storage/async-storage";

/** Local mock account — email only, never leaves the device. */
export const ACCOUNT_EMAIL_KEY = "kalsa.account.email";

// ASCII-only check; unicode local parts (e.g. 例え.jp) are rejected —
// intentional for a local mock, not a bug.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

export function parseStoredEmail(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim();
  return isValidEmail(email) ? email : null;
}

export async function loadAccountEmail(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(ACCOUNT_EMAIL_KEY);
    return parseStoredEmail(raw);
  } catch {
    return null;
  }
}

export async function saveAccountEmail(email: string): Promise<void> {
  const normalized = email.trim();
  await AsyncStorage.setItem(ACCOUNT_EMAIL_KEY, normalized);
}

export async function clearAccountEmail(): Promise<void> {
  await AsyncStorage.removeItem(ACCOUNT_EMAIL_KEY);
}
