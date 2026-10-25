/**
 * The secret keys (LINK_KEY for the tester link, UPDATE_KEY for the desktop
 * updater): the length and character rules, and the one constant-time comparison.
 */
import { sha256Bytes } from "./hash";

export const MIN_KEY_LENGTH = 32;
// The page writes the link key into its links unescaped, so only URL-safe keys are accepted.
const KEY_CHARS = /^[A-Za-z0-9_-]+$/;
// Hashed in place of a candidate that cannot match, so every request does the same work.
export const PLACEHOLDER = "0".repeat(MIN_KEY_LENGTH);

export function usableSecret(secret: string | undefined): string | null {
  return secret !== undefined && secret.length >= MIN_KEY_LENGTH && KEY_CHARS.test(secret) ? secret : null;
}

/** Both sides are hashed first, so the loop always runs over 32 bytes and never exits early. */
export async function keyMatches(secret: string | undefined, candidate: string): Promise<boolean> {
  const usable = usableSecret(secret);
  const [expected, given] = await Promise.all([sha256Bytes(usable ?? PLACEHOLDER), sha256Bytes(candidate)]);
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ given[i];
  return usable !== null && diff === 0;
}
