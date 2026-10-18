// The one zip reader this repo needs: nodejs.org publishes the Windows Node
// build as a zip, and nothing else here is zipped.
//
// It reads through the central directory rather than scanning for local
// headers, because the central directory is the index and a zip whose local
// headers disagree with it is malformed on purpose. Only stored and deflated
// entries are read, and a name that escapes the destination is refused, the
// same rule `tar.mjs` applies: this archive is written by someone else and
// its bytes end up on disk next to a program we run.
//
// Run: imported by scripts/build-driver-archive.mjs.

import { inflateRawSync } from "node:zlib";

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;

/**
 * The plain files of a zip: `[{ name, body }]`. Directory entries, and any
 * entry compressed by a method this reader does not implement, are refused
 * rather than skipped — a silently missing `node.exe` is worse than a build
 * that stops and says so.
 */
export function readZip(bytes) {
  const eocd = findEndOfCentralDirectory(bytes);
  const count = bytes.readUInt16LE(eocd + 10);
  let at = bytes.readUInt32LE(eocd + 16);
  const files = [];
  for (let index = 0; index < count; index += 1) {
    if (bytes.readUInt32LE(at) !== CENTRAL) throw new Error(`zip entry ${index} has no central directory header`);
    const method = bytes.readUInt16LE(at + 10);
    const packed = bytes.readUInt32LE(at + 20);
    const size = bytes.readUInt32LE(at + 24);
    const nameLength = bytes.readUInt16LE(at + 28);
    const extraLength = bytes.readUInt16LE(at + 30);
    const noteLength = bytes.readUInt16LE(at + 32);
    const local = bytes.readUInt32LE(at + 42);
    const name = clean(bytes.subarray(at + 46, at + 46 + nameLength).toString("utf8"));
    at += 46 + nameLength + extraLength + noteLength;
    if (name.endsWith("/")) continue;
    files.push({ name, body: read(bytes, local, method, packed, size) });
  }
  return files;
}

/** Where the central directory starts: the last end-of-directory record in the file. */
function findEndOfCentralDirectory(bytes) {
  const earliest = Math.max(0, bytes.length - 66 * 1024);
  for (let at = bytes.length - 22; at >= earliest; at -= 1) {
    if (bytes.readUInt32LE(at) === EOCD) return at;
  }
  throw new Error("zip has no end of central directory record");
}

/** The entry's bytes, whose real offset sits past its own local header. */
function read(bytes, local, method, packed, size) {
  if (bytes.readUInt32LE(local) !== 0x04034b50) throw new Error("zip entry has no local header");
  const nameLength = bytes.readUInt16LE(local + 26);
  const extraLength = bytes.readUInt16LE(local + 28);
  const at = local + 30 + nameLength + extraLength;
  const body = bytes.subarray(at, at + packed);
  const plain = method === 0 ? body : method === 8 ? inflateRawSync(body) : null;
  if (plain === null) {
    throw new Error(`zip entry is compressed with method ${method}, and only stored and deflated are read`);
  }
  if (plain.length !== size) {
    throw new Error(`zip entry holds ${plain.length} bytes and its directory says ${size}`);
  }
  return plain;
}

/** A name safe to join onto a destination directory, or the read is refused. */
function clean(name) {
  const normalized = name.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (normalized === "" || normalized.startsWith("/") || /^[a-z]:\//i.test(normalized)) {
    throw new Error(`zip entry ${name} is not a relative name`);
  }
  if (normalized.split("/").some((part) => part === ".." || part === "")) {
    throw new Error(`zip entry ${name} climbs out of the destination`);
  }
  return normalized;
}