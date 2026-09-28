import { bytesToHex, hexToBytes, hmacSha256, utf8Bytes } from "./sha256";

const STORAGE_KEY = "kalsa.pairing.install_id.v1";
const SECRET_BYTES = 16;
let secretPromise: Promise<Uint8Array> | null = null;

export function derivePairingInstallId(secret: Uint8Array, node: string): string {
  const canonicalNode = node.toLowerCase();
  if (secret.length !== SECRET_BYTES || !/^[0-9a-f]{64}$/.test(canonicalNode)) {
    throw new Error("invalid pairing install id input");
  }
  return bytesToHex(hmacSha256(secret, utf8Bytes(canonicalNode)).slice(0, SECRET_BYTES));
}

async function readOrMintSecret(): Promise<Uint8Array> {
  const SecureStore = require("expo-secure-store") as typeof import("expo-secure-store");
  const saved = await SecureStore.getItemAsync(STORAGE_KEY);
  if (saved !== null && /^[0-9a-f]{32}$/.test(saved)) return hexToBytes(saved);

  const { getRandomBytes } = require("expo-crypto") as typeof import("expo-crypto");
  const secret = getRandomBytes(SECRET_BYTES);
  if (secret.length !== SECRET_BYTES) throw new Error("invalid pairing install secret");
  await SecureStore.setItemAsync(STORAGE_KEY, bytesToHex(secret));
  return secret;
}

async function getSecret(): Promise<Uint8Array> {
  if (!secretPromise) {
    secretPromise = readOrMintSecret().catch((error: unknown) => {
      secretPromise = null;
      throw error;
    });
  }
  return secretPromise;
}

export async function getPairingInstallId(node: string): Promise<string> {
  return derivePairingInstallId(await getSecret(), node);
}
