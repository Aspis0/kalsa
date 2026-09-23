import {
  bytesToHex,
  concatBytes,
  hexToBytes,
  hmacSha256,
  utf8Bytes,
} from "./sha256";

export type PairingPhoneDeclaration = {
  weights_bytes: number;
  parameters: { total: number; active: number } | null;
  measured_tokens_per_second: number | null;
  battery_powered: boolean | null;
};

export type PairingPhoneMacInput = {
  reachable: string;
  node: string;
  deliveryToken: string;
  phone: PairingPhoneDeclaration;
};

const PHONE_MAC_DOMAIN = "kalsa-pairing/phone-mac/v3";
const CREDENTIAL_KEY_DOMAIN = "kalsa-pairing/credential-encryption/v1";
const CREDENTIAL_STREAM_DOMAIN = "kalsa-pairing/credential-stream/v1";
const COMPUTER_MAC_DOMAIN = "kalsa-pairing/computer-mac/v2";
const MAX_SAFE_U64 = Number.MAX_SAFE_INTEGER;

function assertU64(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_SAFE_U64) {
    throw new Error(`invalid ${field}`);
  }
}

function writeU64(value: number): Uint8Array {
  assertU64(value, "u64");
  const out = new Uint8Array(8);
  let remaining = value;
  for (let index = 7; index >= 0; index -= 1) {
    out[index] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }
  return out;
}

function frame(value: Uint8Array): Uint8Array {
  return concatBytes(writeU64(value.length), value);
}

function floatJson(value: number | null): string {
  if (value === null) return "null";
  if (!Number.isFinite(value)) throw new Error("invalid measured_tokens_per_second");
  const rendered = Object.is(value, -0) ? "-0" : JSON.stringify(value);
  if (rendered === undefined) throw new Error("invalid measured_tokens_per_second");
  // serde_json keeps the f64 type visible even when the value is integral.
  return Number.isInteger(value) && !/[.eE]/.test(rendered) ? `${rendered}.0` : rendered;
}

function integerJson(value: number): string {
  assertU64(value, "integer");
  return String(value);
}

export function canonicalPhoneJson(phone: PairingPhoneDeclaration): string {
  const parameters = phone.parameters;
  const parametersJson = parameters === null
    ? "null"
    : `{"total":${integerJson(parameters.total)},"active":${integerJson(parameters.active)}}`;
  const battery = phone.battery_powered === null ? "null" : String(phone.battery_powered);
  return `{"weights_bytes":${integerJson(phone.weights_bytes)},"parameters":${parametersJson},"measured_tokens_per_second":${floatJson(phone.measured_tokens_per_second)},"battery_powered":${battery}}`;
}

function assertKeyAndNonce(key: Uint8Array, nonce: Uint8Array): void {
  if (key.length !== 16) throw new Error("invalid code length");
  if (nonce.length !== 32) throw new Error("invalid nonce length");
}

export function phoneMacBytes(
  key: Uint8Array,
  nonce: Uint8Array,
  input: PairingPhoneMacInput,
): Uint8Array {
  assertKeyAndNonce(key, nonce);
  if (input.deliveryToken !== "" && !/^[0-9a-f]{32}$/.test(input.deliveryToken)) {
    throw new Error("invalid delivery token");
  }
  const canonical = canonicalPhoneJson(input.phone);
  const payload = concatBytes(
    frame(utf8Bytes(input.reachable)),
    frame(utf8Bytes(input.node)),
    frame(utf8Bytes(input.deliveryToken)),
    frame(utf8Bytes(canonical)),
  );
  return hmacSha256(
    key,
    concatBytes(utf8Bytes(PHONE_MAC_DOMAIN), nonce, payload),
  );
}

export function phoneMacHex(
  codeHex: string,
  nonceHex: string,
  input: PairingPhoneMacInput,
): string {
  return bytesToHex(phoneMacBytes(hexToBytes(codeHex), hexToBytes(nonceHex), input));
}

export function constantTimeBytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left[index] ^ right[index];
  }
  return mismatch === 0;
}

function xorBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (left.length !== right.length) throw new Error("length mismatch");
  const result = new Uint8Array(left.length);
  for (let index = 0; index < left.length; index += 1) result[index] = left[index] ^ right[index];
  return result;
}

function credentialStream(key: Uint8Array, nonce: Uint8Array, length: number): Uint8Array {
  const streamKey = hmacSha256(
    key,
    concatBytes(utf8Bytes(CREDENTIAL_KEY_DOMAIN), nonce, utf8Bytes("key")),
  );
  const blocks: Uint8Array[] = [];
  for (let index = 0; blocks.reduce((sum, block) => sum + block.length, 0) < length; index += 1) {
    blocks.push(
      hmacSha256(
        streamKey,
        concatBytes(utf8Bytes(CREDENTIAL_STREAM_DOMAIN), nonce, writeU64(index)),
      ),
    );
  }
  return concatBytes(...blocks).slice(0, length);
}

/** Verify the ciphertext MAC first, then open the fixed 32-byte credential. */
export function openCredentialSeal(
  key: Uint8Array,
  nonce: Uint8Array,
  ciphertextHex: string,
  macHex: string,
): Uint8Array {
  assertKeyAndNonce(key, nonce);
  const ciphertext = hexToBytes(ciphertextHex);
  const suppliedMac = hexToBytes(macHex);
  if (ciphertext.length !== 32) throw new Error("invalid credential ciphertext length");
  if (suppliedMac.length !== 32) throw new Error("invalid seal mac length");
  const expectedMac = hmacSha256(
    key,
    concatBytes(utf8Bytes(COMPUTER_MAC_DOMAIN), nonce, ciphertext),
  );
  if (!constantTimeBytesEqual(suppliedMac, expectedMac)) throw new Error("invalid credential seal");
  return xorBytes(ciphertext, credentialStream(key, nonce, ciphertext.length));
}
