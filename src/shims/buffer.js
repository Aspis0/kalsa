/**
 * Minimal Buffer polyfill for Metro/Hermes.
 * whisper.rn → safe-buffer does require("buffer"); Node's built-in is not
 * available in RN, and we avoid adding the npm "buffer" package.
 * Surface used by whisper.rn 0.7.2: Buffer.from(base64, "base64").
 */

function base64ToBytes(b64) {
  const binary = globalThis.atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function utf8ToBytes(str) {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(str);
  }
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i += 1) {
    out[i] = str.charCodeAt(i) & 0xff;
  }
  return out;
}

function from(value, encodingOrOffset, length) {
  if (typeof value === "string") {
    if (encodingOrOffset === "base64") {
      return base64ToBytes(value);
    }
    return utf8ToBytes(value);
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (typeof value === "number") {
    return new Uint8Array(value);
  }
  if (Array.isArray(value)) {
    return Uint8Array.from(value);
  }
  return new Uint8Array(0);
}

function alloc(size, fill, encoding) {
  const buf = new Uint8Array(size);
  if (fill !== undefined) {
    if (typeof fill === "number") {
      buf.fill(fill);
    } else if (typeof fill === "string") {
      const bytes = from(fill, encoding);
      for (let i = 0; i < size; i += 1) {
        buf[i] = bytes[i % bytes.length];
      }
    }
  }
  return buf;
}

const Buffer = {
  from,
  alloc,
  allocUnsafe: (size) => new Uint8Array(size),
  allocUnsafeSlow: (size) => new Uint8Array(size),
  isBuffer: (obj) =>
    obj != null &&
    (obj._isBuffer === true ||
      (typeof obj === "object" && obj.constructor && obj.constructor.isBuffer)),
  BYTE_LENGTH: 1,
};

// safe-buffer checks these and re-exports the whole module when present
Buffer.Buffer = Buffer;

module.exports = {
  Buffer,
  SlowBuffer: Buffer.allocUnsafeSlow,
  INSPECT_MAX_BYTES: 50,
  kMaxLength: 0x7fffffff,
};
