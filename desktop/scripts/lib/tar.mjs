// Tar, in both directions. The writer's output is a function of the files
// alone: same inputs, same bytes, on every machine and every run.
//
// The driver archives are pinned by digest, so a gzip header carrying the
// build time or a tar listing entries in readdir order would make every
// rebuild a new pin. Everything that is not file content is fixed here:
// mtime, uid/gid, uname/gname, and the entry order (sorted, directories first).
//
// The writer only holds what a driver archive holds: plain files and the
// directories between them. The reader takes any tar and refuses the entries
// that could escape the destination — an absolute or climbing name, a link,
// a device — so a hostile archive from upstream is data, never a path.
//
// Run: imported by scripts/build-driver-archive.mjs.

import { gunzipSync, gzipSync } from "node:zlib";

const BLOCK = 512;
const MTIME = 0;

/** One tar header, 512 bytes. `mode` is the only field that varies with the file. */
function header({ name, size, mode, type }) {
  const block = Buffer.alloc(BLOCK);
  block.write(name, 0, 100, "utf8");
  block.write(mode.toString(8).padStart(7, "0") + "\0", 100, 8, "utf8");
  block.write("0000000\0", 108, 8, "utf8"); // uid
  block.write("0000000\0", 116, 8, "utf8"); // gid
  block.write(size.toString(8).padStart(11, "0") + "\0", 124, 12, "utf8");
  block.write(MTIME.toString(8).padStart(11, "0") + "\0", 136, 12, "utf8");
  // The checksum field is spaces while the sum is taken, then octal + NUL.
  block.write("        ", 148, 8, "utf8");
  block.write(type, 156, 1, "utf8");
  block.write("ustar\0", 257, 6, "utf8");
  block.write("00", 263, 2, "utf8");
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "utf8");
  return block;
}

/** Every directory between the root and `name`, parents first, no duplicates. */
function parentsOf(name) {
  const parts = name.split("/");
  return parts.slice(0, -1).map((_, index) => `${parts.slice(0, index + 1).join("/")}/`);
}

/**
 * A `.tar.gz` holding `files`: `[{ name, body, mode }]`, names relative and
 * sorted here, so the caller's list order does not leak into the bytes.
 *
 * `mode` defaults to 0644, and the executable bit is what the driver needs:
 * the archive carries `node`, which cannot start without it.
 */
export function tarGz(files) {
  const sorted = [...files].sort((a, b) => (a.name < b.name ? -1 : 1));
  const blocks = [];
  const written = new Set();
  const dir = (name) => {
    if (written.has(name)) return;
    written.add(name);
    blocks.push(header({ name, size: 0, mode: 0o755, type: "5" }));
  };
  dir("./");
  for (const file of sorted) {
    for (const parent of parentsOf(file.name)) dir(parent);
    const body = Buffer.from(file.body);
    blocks.push(header({ name: file.name, size: body.length, mode: file.mode ?? 0o644, type: "0" }));
    blocks.push(body);
    const pad = (BLOCK - (body.length % BLOCK)) % BLOCK;
    if (pad) blocks.push(Buffer.alloc(pad));
  }
  // Two empty blocks end the archive; a tar reader stops on them.
  blocks.push(Buffer.alloc(BLOCK * 2));
  const tar = Buffer.concat(blocks);
  return gzipSync(tar, { level: 9, mtime: 0 });
}

const text = (block, at, length) => block.subarray(at, at + length).toString("utf8").replace(/\0.*$/, "");
const octal = (block, at, length) => parseInt(text(block, at, length).trim() || "0", 8);

/**
 * The entries of a `.tgz`: `[{ name, body, mode }]` for the plain files, and
 * `dirs` for the directories. Links are skipped and never become entries, and
 * a name that climbs out of the destination, is absolute, or is a device node
 * is refused rather than returned — the caller writes these into a directory
 * it then runs a program from.
 */
export function readTgz(bytes) {
  const tar = gunzipSync(bytes);
  const files = [];
  const dirs = new Set();
  let at = 0;
  let longName = null;
  while (at + BLOCK <= tar.length) {
    const block = tar.subarray(at, at + BLOCK);
    if (block.every((byte) => byte === 0)) break;
    const size = octal(block, 124, 12);
    // An extended header names **the entry that follows it and no other**, so
    // the name it carried is taken and dropped here. Leaving it set would give
    // every later entry the same name, and the archive's files would be written
    // under whatever the first long name happened to be.
    const pending = longName;
    longName = null;
    const raw = pending ?? nameOf(block);
    at += BLOCK;
    const body = tar.subarray(at, at + size);
    at += Math.ceil(size / BLOCK) * BLOCK;
    const type = String.fromCharCode(block[156] || 0x30);
    // 'L' is a GNU long name: the body names the entry that follows it.
    if (type === "L") {
      longName = text(body, 0, size);
      continue;
    }
    // A per-file pax header ('x') names the next entry. A global one ('g') is
    // treated the same way: a name that outlives its entry is the leak above.
    if (type === "x" || type === "g") {
      longName = paxPath(body, null);
      continue;
    }
    // Node's own dist ships `bin/corepack` and `bin/npx` as links, and this
    // reader takes only the entries the caller names exactly — nothing here
    // ever creates a link, so a link is inert rather than a way out.
    if (type === "1" || type === "2") continue;
    if (type === "5") {
      dirs.add(clean(raw));
      continue;
    }
    if (type !== "0") throw new Error(`tar entry ${raw} is type ${type}, and only a plain file is read`);
    files.push({ name: clean(raw), body, mode: octal(block, 100, 8) & 0o777 });
  }
  return { files, dirs: [...dirs].sort() };
}

/** ustar splits a long name into a 155-byte prefix and a 100-byte tail. */
function nameOf(block) {
  const prefix = text(block, 345, 155);
  const name = text(block, 0, 100);
  return prefix ? `${prefix}/${name}` : name;
}

/** The `path=` record of a pax extended header, which overrides the ustar name. */
function paxPath(body, fallback) {
  for (const record of body.toString("utf8").split("\n")) {
    const space = record.indexOf(" ");
    if (space === -1) continue;
    if (record.slice(space + 1).startsWith("path=")) return record.slice(space + 6);
  }
  return fallback;
}

/** A name safe to join onto a destination directory, or the read is refused. */
function clean(name) {
  const normalized = name.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (normalized === "" || normalized.startsWith("/") || /^[a-z]:\//i.test(normalized)) {
    throw new Error(`tar entry ${name} is not a relative name`);
  }
  if (normalized.split("/").some((part) => part === ".." || part === "")) {
    throw new Error(`tar entry ${name} climbs out of the destination`);
  }
  return normalized;
}
/** One 512-byte ustar header, for the tests below. `type` is the typeflag. */
function headerOf(name, body, type) {
  const block = Buffer.alloc(512);
  block.write(name.slice(0, 100), 0, 100, "utf8");
  block.write("0000644\0", 100, 8, "utf8");
  block.write("0000000\0", 108, 8, "utf8");
  block.write("0000000\0", 116, 8, "utf8");
  block.write(body.length.toString(8).padStart(11, "0") + "\0", 124, 12, "utf8");
  block.write("00000000000\0", 136, 12, "utf8");
  block.write("        ", 148, 8, "utf8");
  block.write(type, 156, 1, "utf8");
  block.write("ustar\0", 257, 6, "utf8");
  block.write("00", 263, 2, "utf8");
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "utf8");
  const pad = (BLOCK - (body.length % BLOCK)) % BLOCK;
  return pad ? Buffer.concat([block, body, Buffer.alloc(pad)]) : Buffer.concat([block, body]);
}

/**
 * The two extended-header shapes a real tarball uses, and the leak that comes
 * with them. A GNU `L` header and a pax `x` header each name the entry that
 * follows; a reader that keeps the name instead of consuming it gives every
 * later entry the same one, and the caller's unpack writes files under a name
 * the archive never used.
 *
 * Run: node scripts/lib/tar.mjs
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const long = "package/lib/a-directory-nested-fairly-deeply/inside/node_modules/playwright-core/lib/server.js";
  const gnu = gzipSync(
    Buffer.concat([
      headerOf("././@LongLink", Buffer.from(`${long}\0`), "L"),
      headerOf("short.js", Buffer.from("runtime"), "0"),
      headerOf("LICENSE", Buffer.from("licence bytes"), "0"),
      headerOf("././@LongLink", Buffer.from("package/cli.js\0"), "L"),
      headerOf("also-short.js", Buffer.from("another body"), "0"),
      Buffer.alloc(1024),
    ]),
    { level: 9, mtime: 0 },
  );
  const read = readTgz(gnu);
  const names = read.files.map((file) => file.name);
  let failures = 0;
  const check = (ok, label) => {
    if (!ok) failures += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  };
  // An extended header names the entry that follows it and is not an entry
  // itself, so five headers hold three files.
  for (const [index, name] of [long, "LICENSE", "package/cli.js"].entries()) {
    check(
      names[index] === name,
      names[index] === name ? name : `entry ${index} is ${names[index]}, not ${name}`,
    );
  }
  // The proof the name is consumed rather than kept: a reader that left it set
  // would name `LICENSE` `long` as well, and the first long name would be used
  // twice.
  check(new Set(names).size === names.length, "no name is used twice");

  const pax = gzipSync(
    Buffer.concat([
      headerOf("PaxHeader/0", Buffer.from("30 path=from/pax/header.txt\n\0"), "x"),
      headerOf("placeholder", Buffer.from("pax body"), "0"),
      headerOf("after.js", Buffer.from("its own name"), "0"),
      Buffer.alloc(1024),
    ]),
    { level: 9, mtime: 0 },
  );
  const paxNames = readTgz(pax).files.map((file) => file.name);
  for (const [index, name] of ["from/pax/header.txt", "after.js"].entries()) {
    check(
      paxNames[index] === name,
      paxNames[index] === name ? `pax ${name}` : `pax entry ${index} is ${paxNames[index]}, not ${name}`,
    );
  }

  console.log(failures === 0 ? "\nOK — every extended header names one entry" : `\n${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}
