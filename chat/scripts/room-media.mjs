// The room's media, end to end against the real build: a picture attached
// to the room composer is re-encoded by the same road the chat uses and
// reaches the shelf as reserve → 4 MiB chunks → publish, and the post names
// its id; a video compresses in the webview (long side ≤1280, no upscale),
// its frames upload first and its descriptor lists them; a failed chunk
// retries its idempotent index; a video past the 100 MiB cap is refused in
// words before anything reaches the shelf; the rows render the pictures and
// the video, the lightbox walks a message's media, and the computer's
// fallback words never stand next to rendered pixels.
//
// Two pages on one server: a probe (mediabunny + the app's own modules,
// pdf-attach style) builds the fixture video and proves the compress and
// upload roads against a page-level shelf; the real app, with a stubbed
// brain, proves the room flow. No filename and no media id reaches a log
// line — the script checks its own output too.
//
// Run: node scripts/room-media.mjs [chromium|webkit ...]   (from chat/)

import { deflateSync } from "node:zlib";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "@playwright/test";
import { build } from "vite";

const ENGINES = { chromium, webkit };
const CHAT_DIR = fileURLToPath(new URL("..", import.meta.url));
const outDir = join(CHAT_DIR, ".room-media-dist");
const probeDir = join(CHAT_DIR, ".room-media-probe");
const MIB = 1024 * 1024;

let fail = 0;
function check(label, condition, detail) {
  const ok = condition ? "ok  " : "FAIL";
  if (!condition) fail++;
  console.log(`${ok} ${label}${condition || detail === undefined ? "" : `\n     ${detail}`}`);
}

// --- a small PNG encoder, enough for test sources --------------------------

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  return (crc ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head, body, crc]);
}

function makePng(width, height, pixel) {
  const withAlpha = pixel(0, 0).length === 4;
  const bpp = withAlpha ? 4 : 3;
  const raw = Buffer.alloc(height * (1 + width * bpp));
  let at = 0;
  for (let y = 0; y < height; y++) {
    raw[at++] = 0;
    for (let x = 0; x < width; x++) {
      const px = pixel(x, y);
      raw[at++] = px[0];
      raw[at++] = px[1];
      raw[at++] = px[2];
      if (withAlpha) raw[at++] = px[3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = withAlpha ? 6 : 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- the probe page: the app's own modules against a page-level shelf -----

async function buildProbe() {
  await rm(probeDir, { recursive: true, force: true });
  await mkdir(probeDir, { recursive: true });
  await writeFile(
    join(probeDir, "index.html"),
    `<!doctype html><html><head><meta charset="utf-8"><title>room media probe</title></head><body><script type="module" src="./main.ts"></script></body></html>`,
  );
  await writeFile(
    join(probeDir, "main.ts"),
    `
import { Conversion, Input, Output, Mp4OutputFormat, BufferTarget, BlobSource, CanvasSource, ALL_FORMATS } from "mediabunny";
import { estimatedVideoBytes, prepareVideo, remuxOriginal, VideoCanceled } from "../src/lib/video";
import { uploadRoomMedia, sha256Hex, ROOM_VIDEO_MAX_BYTES } from "../src/lib/roomMedia";
import { wireBodyBytes } from "../src/lib/wireBudget";
import { acquireRoomMediaUrl, holdRoomMediaUrl, releaseRoomMediaUrl, forgetAllRoomMediaUrls } from "../src/lib/roomMediaCache";
(window as unknown as { __MEDIA__: unknown }).__MEDIA__ = {
  Conversion, Input, Output, Mp4OutputFormat, BufferTarget, BlobSource, CanvasSource, ALL_FORMATS,
  prepareVideo, remuxOriginal, estimatedVideoBytes, VideoCanceled, uploadRoomMedia, sha256Hex, ROOM_VIDEO_MAX_BYTES,
  wireBodyBytes, acquireRoomMediaUrl, holdRoomMediaUrl, releaseRoomMediaUrl, forgetAllRoomMediaUrls,
};
`,
  );
  // Vite mirrors the input's root-relative path into the outDir: the page
  // the build emits lives at <outDir>/.room-media-probe/ (the pdf-attach
  // pattern). emptyOutDir stays off — the app build ran here first.
  await build({
    root: CHAT_DIR,
    configFile: false,
    base: "./",
    logLevel: "silent",
    build: {
      outDir,
      emptyOutDir: false,
      target: "es2022",
      rollupOptions: { input: join(probeDir, "index.html") },
    },
  });
}

// --- MP4 boxes, enough to plant and find a location atom --------------------

/** Every box's type under `moov`, plus whether udta/\xA9xyz exist anywhere. */
function mp4Boxes(buffer) {
  const types = { top: [], underMoov: [] };
  let udta = false;
  let xyz = false;
  const walk = (at, end, under) => {
    while (at + 8 <= end) {
      const size = buffer.readUInt32BE(at);
      const type = buffer.toString("latin1", at + 4, at + 8);
      if (size < 8 || at + size > end) return;
      if (under) types.underMoov.push(type);
      else types.top.push(type);
      if (type === "udta") udta = true;
      if (type === "\u00a9xyz" || buffer.subarray(at, at + size).includes(Buffer.from("\u00a9xyz", "latin1"))) xyz = true;
      if (type === "moov") walk(at + 8, at + size, true);
      at += size;
    }
  };
  walk(0, buffer.length, false);
  return { ...types, udta, xyz };
}

/** A udta holding ©xyz (the QuickTime GPS tag), appended INSIDE the
    trailing moov — the shape a phone's recorder writes. */
function withLocationAtom(mp4) {
  const xyz = Buffer.alloc(8 + 16);
  xyz.writeUInt32BE(8 + 16, 0);
  xyz.write("\u00a9xyz", 4, "latin1");
  xyz.write("37.33/+/-122.03", 8, "latin1");
  const udta = Buffer.alloc(8 + xyz.length);
  udta.writeUInt32BE(8 + xyz.length, 0);
  udta.write("udta", 4, "latin1");
  xyz.copy(udta, 8);
  // The moov, by a proper top-level walk. Growing it shifts whatever
  // follows, so every stco chunk offset inside it moves by the same delta —
  // the one edit a real muxer would make.
  let moovAt = -1;
  let walk = 0;
  while (walk + 8 <= mp4.length) {
    const size = mp4.readUInt32BE(walk);
    if (size < 8) break;
    if (mp4.toString("latin1", walk + 4, walk + 8) === "moov") moovAt = walk;
    walk += size;
  }
  if (moovAt === -1) throw new Error("fixture: no moov box");
  const moovSize = mp4.readUInt32BE(moovAt);
  const delta = udta.length;
  const grown = Buffer.alloc(moovSize + delta);
  mp4.subarray(moovAt, moovAt + moovSize).copy(grown);
  grown.writeUInt32BE(moovSize + delta, 0);
  udta.copy(grown, moovSize);
  // stco entries (absolute file offsets) under this moov move by delta.
  const patchStco = (at, end) => {
    while (at + 8 <= end) {
      const size = grown.readUInt32BE(at);
      const type = grown.toString("latin1", at + 4, at + 8);
      if (size < 8 || at + size > end) return;
      if (type === "stco") {
        const count = grown.readUInt32BE(at + 12);
        for (let entry = 0; entry < count && at + 16 + entry * 4 <= end; entry += 1) {
          const slot = at + 16 + entry * 4;
          grown.writeUInt32BE(grown.readUInt32BE(slot) + delta, slot);
        }
      } else if (size > 8 && type !== "mdat") {
        patchStco(at + 8, at + size);
      }
      at += size;
    }
  };
  patchStco(8, grown.length);
  return Buffer.concat([mp4.subarray(0, moovAt), grown, mp4.subarray(moovAt + moovSize)]);
}

/** The remux fallback's own proof: the ©xyz-carrying original goes in, a
    file without it comes out, still a video, with frames. */
async function remuxProbe(page, mp4B64) {
  const fixture = withLocationAtom(Buffer.from(mp4B64, "base64"));
  const before = mp4Boxes(fixture);
  const result = await page.evaluate(async (b64) => {
    const { remuxOriginal } = window.__MEDIA__;
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const file = new File([bytes], "located.mp4", { type: "video/mp4" });
    const video = await remuxOriginal(file);
    let binary = "";
    const out = new Uint8Array(await video.blob.arrayBuffer());
    for (let at = 0; at < out.length; at += 0x8000) {
      binary += String.fromCharCode(...out.subarray(at, at + 0x8000));
    }
    return {
      b64: btoa(binary),
      mime: video.blob.type,
      width: video.width,
      height: video.height,
      compressed: video.compressed,
      frames: video.frames.length,
    };
  }, fixture.toString("base64"));
  const after = mp4Boxes(Buffer.from(result.b64, "base64"));
  return {
    lines: [],
    checks: [
      {
        label: "the fixture really carries udta with a ©xyz location atom",
        ok: before.udta === true && before.xyz === true,
        detail: JSON.stringify(before.underMoov),
      },
      {
        label: "the remux drops the ©xyz location atom whole",
        ok: after.xyz === false && !Buffer.from(result.b64, "base64").includes(Buffer.from("37.33", "latin1")),
        detail: JSON.stringify({ xyz: after.xyz, underMoov: after.underMoov }),
      },
      {
        label: "the remuxed file is still an mp4 with its pixels",
        ok: result.mime === "video/mp4" && result.width > 0 && result.height > 0 && result.compressed === false,
        detail: JSON.stringify({ mime: result.mime, width: result.width, height: result.height }),
      },
      {
        label: "the remuxed fallback still carries frames for the AI",
        ok: result.frames >= 1,
        detail: JSON.stringify(result.frames),
      },
    ],
  };
}

async function probeEngine(engineName, origin) {
  console.log(`\n--- ${engineName}: probe ---`);
  const browser = await ENGINES[engineName].launch({ args: ["--no-sandbox"] });
  let mp4B64 = null;
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    const probeConsole = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    page.on("console", (message) => probeConsole.push(message.text()));
    page.on("pageerror", (error) => probeConsole.push(String(error)));
    await page.addInitScript(() => {
      window.__shelf = { specs: [], chunks: {}, fails: [] };
      window.__TAURI__ = {
        core: {
          invoke: async (command, args) => {
            const shelf = window.__shelf;
            if (command === "brain_room_media_create") {
              const upload = `up${shelf.specs.length + 1}`;
              shelf.specs.push({ upload, ...args });
              shelf.chunks[upload] = { spec: args, parts: {} };
              return upload;
            }
            if (command === "brain_room_media_chunk") {
              const held = shelf.chunks[args.upload];
              if (shelf.fails.length > 0 && shelf.fails[0] === args.upload) {
                shelf.fails.shift();
                throw { code: "internal" };
              }
              held.parts[args.index] = args.bytes;
              return { received: (args.index + 1) * 4194304 };
            }
            if (command === "brain_room_media_read") {
              shelf.reads = shelf.reads ?? {};
              shelf.reads[args.id] = (shelf.reads[args.id] ?? 0) + 1;
              return new Uint8Array([1, 2, 3, 4]);
            }
            if (command === "brain_room_media_complete") {
              const held = shelf.chunks[args.upload];
              const total = Object.values(held.parts).reduce((sum, part) => sum + part.length, 0);
              if (total !== held.spec.bytes) throw { code: "media_incomplete" };
              return {
                id: `probe${shelf.specs.length}`,
                kind: held.spec.kind,
                mime: held.spec.mime,
                bytes: held.spec.bytes,
                sha256: held.spec.sha256,
                width: held.spec.width,
                height: held.spec.height,
                duration_ms: held.spec.durationMs ?? null,
                frames: held.spec.frames ?? [],
              };
            }
            throw new Error(`stub missing ${command}`);
          },
        },
        event: { listen: () => Promise.resolve(() => {}) },
      };
    });
    await page.goto(`${origin}/.room-media-probe/`);
    await page.waitForFunction(() => window.__MEDIA__ !== undefined, null, { timeout: 10000 }).catch(() => {});
    if (probeConsole.length > 0) console.log(`     [probe console] ${probeConsole.slice(0, 4).join(" | ")}`);

    const caps = await page.evaluate(async () => {
      const answer = await VideoEncoder.isConfigSupported({
        codec: "avc1.42001E",
        width: 640,
        height: 360,
        bitrate: 2_000_000,
        framerate: 30,
      }).catch(() => ({ supported: false }));
      return { video: answer.supported === true };
    });

    // 1. The fixture: a small MP4, built in this page — 640x360, 1.5 s.
    mp4B64 = await page.evaluate(async () => {
      const { Input, Output, Mp4OutputFormat, BufferTarget, CanvasSource, ALL_FORMATS } = window.__MEDIA__;
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 360;
      const ctx = canvas.getContext("2d");
      const source = new CanvasSource(canvas, { codec: "avc", bitrate: 1_000_000 });
      const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
      output.addVideoTrack(source, { frameRate: 30 });
      await output.start();
      for (let at = 0; at < 45; at += 1) {
        ctx.fillStyle = `hsl(${at * 8}, 70%, 50%)`;
        ctx.fillRect(0, 0, 640, 360);
        ctx.fillStyle = "#fff";
        ctx.fillRect(at * 14, 150, 40, 60);
        await source.add(at / 30, 1 / 30);
      }
      await output.finalize();
      const bytes = new Uint8Array(output.target.buffer);
      let binary = "";
      for (let at = 0; at < bytes.length; at += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
      }
      return btoa(binary);
    });
    check("the fixture MP4 was built in the page", typeof mp4B64 === "string" && mp4B64.length > 1000, String(mp4B64?.length));

    const mp4Bytes = Buffer.from(mp4B64, "base64");
    const prepared = await page.evaluate(async (b64) => {
      const { prepareVideo } = window.__MEDIA__;
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const file = new File([bytes], "clip.mp4", { type: "video/mp4" });
      const seen = [];
      const video = await prepareVideo(file, (fraction) => seen.push(fraction));
      return {
        size: video.blob.size,
        type: video.blob.type,
        width: video.width,
        height: video.height,
        compressed: video.compressed,
        frames: video.frames.map((frame) => ({ mime: frame.mime, width: frame.width, height: frame.height })),
        progressReports: seen.length,
      };
    }, mp4B64);

    if (caps.video) {
      check(
        "the video compresses: mp4 out, kept at its own size, never upscaled",
        prepared.compressed === true &&
          prepared.type === "video/mp4" &&
          prepared.width === 640 &&
          prepared.height === 360,
        JSON.stringify(prepared),
      );
      check("progress walked while compressing", prepared.progressReports > 0, String(prepared.progressReports));
      check(
        "frames were pulled as jpegs",
        prepared.frames.length >= 1 && prepared.frames.every((frame) => frame.mime === "image/jpeg"),
        JSON.stringify(prepared.frames),
      );
    } else {
      check(
        "no encoder here: the original mp4 rides, honestly labeled",
        prepared.compressed === false && prepared.type === "video/mp4",
        JSON.stringify(prepared),
      );
    }

    // 2. The upload road: reserve, 4 MiB chunks, publish — with the first
    //    chunk failing once and the idempotent retry carrying it.
    const upload = await page.evaluate(async (b64) => {
      const { uploadRoomMedia, sha256Hex } = window.__MEDIA__;
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      window.__shelf.fails.push("up1");
      const seen = [];
      const descriptor = await uploadRoomMedia(
        { kind: "video", mime: "video/mp4", width: 640, height: 360, durationMs: 1500, frames: [] },
        bytes,
        (fraction) => seen.push(fraction),
      );
      return {
        descriptor,
        digest: await sha256Hex(bytes),
        lastProgress: seen.at(-1),
        chunkCount: Object.keys(window.__shelf.chunks.up1.parts).length,
        sizes: Object.values(window.__shelf.chunks.up1.parts).map((part) => part.length),
      };
    }, mp4B64);
    check(
      "the upload landed as one descriptor carrying the file's own digest",
      upload.descriptor.bytes === mp4Bytes.length &&
        upload.descriptor.sha256 === upload.digest &&
        /^[0-9a-f]{64}$/.test(upload.descriptor.sha256),
      JSON.stringify({ got: upload.descriptor.bytes, want: mp4Bytes.length }),
    );
    check("the last progress report was whole", upload.lastProgress === 1, String(upload.lastProgress));
    const expectedChunks = Math.ceil(mp4Bytes.length / (4 * 1024 * 1024));
    check(
      "the file went up in 4 MiB chunks, last one short",
      upload.chunkCount === expectedChunks &&
        upload.sizes.slice(0, -1).every((size) => size === 4 * 1024 * 1024),
      JSON.stringify({ chunkCount: upload.chunkCount, expected: expectedChunks }),
    );
    check("the failed chunk retried and the upload completed", pageErrors.length === 0, JSON.stringify(pageErrors));

    // 3. The wire's weight is UTF-8 bytes, not UTF-16 code units: a CJK
    //    conversation is three bytes a character, and the door caps bytes.
    const utf8 = await page.evaluate(() => {
      const cjk = "\u56fe".repeat(10000);
      return { wireBodyBytes: window.__MEDIA__.wireBodyBytes(cjk), length: cjk.length };
    });
    check(
      "the body's weight is its UTF-8 bytes",
      utf8.wireBodyBytes === utf8.length * 3,
      JSON.stringify(utf8),
    );

    // 4. Early refusal: a video whose duration x bitrate cannot fit the cap
    //    is refused BEFORE the encoder spends its minutes.
    const estimate = await page.evaluate(() => {
      const { estimatedVideoBytes, ROOM_VIDEO_MAX_BYTES } = window.__MEDIA__;
      return { at400s: estimatedVideoBytes(400, true), at100s: estimatedVideoBytes(100, true), cap: ROOM_VIDEO_MAX_BYTES };
    });
    check(
      "the estimate itself crosses the cap where the encoding would",
      estimate.at400s > estimate.cap && estimate.at100s < estimate.cap,
      JSON.stringify(estimate),
    );
    const longB64 = await page.evaluate(async () => {
      const { Conversion, Input, Output, Mp4OutputFormat, BufferTarget, BlobSource, CanvasSource } = window.__MEDIA__;
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 180;
      const ctx = canvas.getContext("2d");
      const source = new CanvasSource(canvas, { codec: "avc", bitrate: 500_000 });
      const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
      output.addVideoTrack(source, { frameRate: 10 });
      await output.start();
      // Sparse timestamps: a few frames, a six-minute duration — the demux
      // reads the duration without ever encoding six minutes of video.
      const stamps = [0, 0.5, 1, 1.5, 2, 400.5];
      for (const at of stamps) {
        ctx.fillStyle = `hsl(${at}, 70%, 50%)`;
        ctx.fillRect(0, 0, 320, 180);
        await source.add(at, 0.1);
      }
      await output.finalize();
      const bytes = new Uint8Array(output.target.buffer);
      let binary = "";
      for (let walk = 0; walk < bytes.length; walk += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(walk, walk + 0x8000));
      }
      return btoa(binary);
    });
    const earlyRefusal = await page.evaluate(async (b64) => {
      const { prepareVideo } = window.__MEDIA__;
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const file = new File([bytes], "long.mp4", { type: "video/mp4" });
      const progressCalls = [];
      try {
        await prepareVideo(file, (fraction) => progressCalls.push(fraction));
        return { refused: false, progressCalls: progressCalls.length };
      } catch (error) {
        return { refused: true, failure: error.failure, reason: error.reason, progressCalls: progressCalls.length };
      }
    }, longB64);
    check(
      "a seven-minute video is refused before the encoder runs",
      earlyRefusal.refused === true &&
        earlyRefusal.failure === "too-big" &&
        earlyRefusal.reason === "video_estimate" &&
        earlyRefusal.progressCalls === 0,
      JSON.stringify(earlyRefusal),
    );

    // 5. Cancel: the conversion stops where it is, not at the end.
    const cancelRun = await page.evaluate(async (b64) => {
      const { prepareVideo } = window.__MEDIA__;
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const file = new File([bytes], "cancel.mp4", { type: "video/mp4" });
      const gate = { canceled: false };
      let afterCancel = 0;
      let canceled = false;
      const run = prepareVideo(
        file,
        () => {
          if (gate.canceled) afterCancel += 1;
          if (!gate.canceled && performance.now() % 3 < 1) gate.canceled = true;
        },
        gate,
      ).then(
        () => "resolved",
        (error) => {
          canceled = error.name === "VideoCanceled";
          return "rejected";
        },
      );
      const answer = await run;
      return { answer, canceled, afterCancel };
    }, mp4B64);
    check(
      "a cancel mid-encode rejects the run and stops the work",
      cancelRun.answer === "rejected" && cancelRun.canceled === true && cancelRun.afterCancel <= 4,
      JSON.stringify(cancelRun),
    );

    // 6. The remux fallback: a ©xyz location atom does not survive the copy.
    const remux = await remuxProbe(page, mp4B64);
    for (const line of remux.lines) console.log(`     ${line}`);
    for (const one of remux.checks) check(one.label, one.ok, one.detail);

    // 7. The LRU: past its cap the oldest unheld URL is revoked (a fetch
    //    of it fails), a held one survives, and a re-acquire re-reads.
    const lru = await page.evaluate(async () => {
      const { acquireRoomMediaUrl, holdRoomMediaUrl, releaseRoomMediaUrl, forgetAllRoomMediaUrls } = window.__MEDIA__;
      forgetAllRoomMediaUrls();
      const reads = () => Object.values(window.__shelf.reads ?? {}).reduce((sum, n) => sum + n, 0);
      const ids = Array.from({ length: 24 }, (_, at) => `l${at}`);
      const urls = [];
      for (const id of ids) {
        urls.push(await acquireRoomMediaUrl(id, "image/png"));
      }
      const readsAfterFirstPass = reads();
      // The second URL is held BEFORE anything pushes past the cap.
      holdRoomMediaUrl(ids[1]);
      for (const id of ["m0", "m1", "m2"]) await acquireRoomMediaUrl(id, "image/png");
      // The first URL, unheld and oldest, was revoked by the overflow.
      let firstRevoked = false;
      try {
        await fetch(urls[0]);
      } catch {
        firstRevoked = true;
      }
      let heldSurvives = true;
      try {
        await fetch(urls[1]);
      } catch {
        heldSurvives = false;
      }
      // Re-acquiring the evicted one reads again; the held one does not.
      const before = reads();
      await acquireRoomMediaUrl(ids[0], "image/png");
      const reRead = reads() - before;
      releaseRoomMediaUrl(ids[1]);
      const heldBefore = reads();
      await acquireRoomMediaUrl(ids[1], "image/png");
      const heldReRead = reads() - heldBefore;
      forgetAllRoomMediaUrls();
      return { readsAfterFirstPass, firstRevoked, heldSurvives, reRead, heldReRead };
    });
    check(
      "the LRU revoked the oldest unheld url past its cap",
      lru.firstRevoked === true,
      JSON.stringify(lru),
    );
    check(
      "a held url survives past the cap",
      lru.heldSurvives === true,
      JSON.stringify(lru),
    );
    check(
      "an evicted url re-reads, a held one does not",
      lru.reRead === 1 && lru.heldReRead === 0,
      JSON.stringify(lru),
    );

    // 8. Over the cap: a video past 100 MiB is refused before any work.
    const tooBig = await page.evaluate(async (cap) => {
      const { prepareVideo } = window.__MEDIA__;
      const file = new File([new Uint8Array(cap + 1024)], "big.mp4", { type: "video/mp4" });
      try {
        await prepareVideo(file, () => {});
        return { refused: false };
      } catch (error) {
        return { refused: true, failure: error.failure };
      }
    }, 100 * MIB);
    check(
      "a video past the 100 MiB cap is refused before any work",
      tooBig.refused === true && tooBig.failure === "too-big",
      JSON.stringify(tooBig),
    );
    check("the probe ran clean", pageErrors.length === 0, JSON.stringify(pageErrors));
  } finally {
    await browser.close();
  }
  return mp4B64;
}

// --- the real app, with a stubbed brain -----------------------------------

function installAppStub(page) {
  void page.addInitScript(() => {
    window.__logEvents = [];
    window.__shelf = { specs: [], chunks: {}, blobs: {}, reads: {}, clears: 0, failArm: false, failIndex: -1, dropNextBlob: false, posts: [] };
    // History and blobs a test plants before a reload: the page's own reads
    // answer from here, so lazy loading is observable against them.
    window.__STUB_SEED_IDS__ = null;
    window.__STUB_HISTORY__ = [];
    const SEED_PNG = Uint8Array.from(atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    ), (c) => c.charCodeAt(0));
    let uploadSeq = 0;
    let blobSeq = 0;
    let postSeq = 100;
    const CHUNK = 4194304;
    window.__TAURI__ = {
      core: {
        invoke: async (command, args) => {
          const shelf = window.__shelf;
          if (command === "brain_state")
            return { kind: "running", endpoint: "http://127.0.0.1:18099/v1", model: "m" };
          if (command === "brain_host_credential") return "t";
          if (command === "brain_capability") return { kind: "unmeasured", chosen: true };
          if (command === "brain_previous_session_crashed") return false;
          if (command === "brain_log_event") {
            window.__logEvents.push(String(args?.code ?? ""));
            return null;
          }
          if (command === "brain_room") {
            return {
              epoch: "e1",
              open: true,
              room_name: "home",
              you: 1,
              members: [
                { member_id: 1, name: "", kind: "host", former: false },
                { member_id: 2, name: "Kalsa", kind: "ai", former: false },
              ],
              ai: { state: "idle", running: null, queue: [], you_pending: false },
            };
          }
          if (command === "brain_room_history") return window.__STUB_HISTORY__;
          if (command === "brain_room_set_name") return { member_id: 1, name: args.name };
          if (command === "brain_room_stop") return null;
          if (command === "brain_room_media_create") {
            uploadSeq += 1;
            const upload = `up${uploadSeq}`;
            shelf.specs.push({ upload, ...args });
            shelf.chunks[upload] = { spec: args, parts: {} };
            if (shelf.failArm) {
              shelf.failArm = false;
              shelf.failIndex = 0;
            }
            return upload;
          }
          if (command === "brain_room_media_chunk") {
            const held = shelf.chunks[args.upload];
            if (held === undefined) throw { code: "media_not_found" };
            if (shelf.failIndex >= 0 && args.index === shelf.failIndex) {
              shelf.failIndex = -1;
              throw { code: "internal" };
            }
            held.parts[args.index] = args.bytes;
            return { received: Math.min((args.index + 1) * CHUNK, held.spec.bytes) };
          }
          if (command === "brain_room_media_complete") {
            const held = shelf.chunks[args.upload];
            if (held === undefined) throw { code: "media_not_found" };
            const total = Object.values(held.parts).reduce((sum, part) => sum + part.length, 0);
            if (total !== held.spec.bytes) throw { code: "media_incomplete" };
            blobSeq += 1;
            const id = `${held.spec.kind === "video" ? "v" : "i"}${blobSeq.toString().padStart(6, "0")}${"0".repeat(25)}`;
            const descriptor = {
              id,
              kind: held.spec.kind,
              mime: held.spec.mime,
              bytes: held.spec.bytes,
              sha256: held.spec.sha256,
              width: held.spec.width,
              height: held.spec.height,
              duration_ms: held.spec.durationMs ?? null,
              frames: held.spec.frames ?? [],
            };
            shelf.blobs[id] = { mime: held.spec.mime, bytes: held.spec.bytes, parts: held.parts, descriptor };
            if (shelf.dropNextBlob) {
              shelf.dropNextBlob = false;
              delete shelf.blobs[id];
            }
            return descriptor;
          }
          if (command === "brain_room_media_read") {
            shelf.reads[args.id] = (shelf.reads[args.id] ?? 0) + 1;
            if (shelf.blobs[args.id] !== undefined) {
              const blob = shelf.blobs[args.id];
              const whole = new Uint8Array(blob.bytes);
              for (const [index, part] of Object.entries(blob.parts)) {
                whole.set(part, Number(index) * CHUNK);
              }
              return whole;
            }
            if (window.__STUB_SEED_IDS__ !== null && window.__STUB_SEED_IDS__.includes(args.id)) {
              return SEED_PNG;
            }
            throw { code: "media_not_found" };
          }
          if (command === "brain_room_media_clear") {
            shelf.clears += 1;
            shelf.blobs = {};
            window.__STUB_SEED_IDS__ = null;
            return null;
          }
          if (command === "brain_room_post") {
            postSeq += 1;
            const media = (args.media ?? []).map(
              (id) =>
                shelf.blobs[id]?.descriptor ?? {
                  id,
                  kind: "image",
                  mime: "image/png",
                  bytes: 1,
                  sha256: "0".repeat(64),
                  width: 1,
                  height: 1,
                  duration_ms: null,
                  frames: [],
                },
            );
            shelf.posts.push({ text: args.text, media: args.media ?? [], callAi: args.callAi });
            return {
              seq: postSeq,
              member_id: 1,
              name: "",
              former: false,
              text: args.text,
              time: Math.floor(Date.now() / 1000),
              call_ai: args.callAi,
              read: null,
              media,
              ai_call: null,
              refusal: null,
            };
          }
          throw new Error(`stub missing ${command}`);
        },
      },
      event: { listen: () => Promise.resolve(() => {}) },
    };
  });
}

async function probeApp(engineName, origin, mp4B64) {
  console.log(`\n--- ${engineName}: room ---`);
  const browser = await ENGINES[engineName].launch({ args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const consoleLines = [];
    const pageErrors = [];
    page.on("console", (message) => consoleLines.push(message.text()));
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    installAppStub(page);
    await page.route("**/props", (route) =>
      route.fulfill({
        json: {
          default_generation_settings: { n_ctx: 8192 },
          modalities: { vision: true, audio: false, video: false },
          chat_template: "",
        },
      }),
    );
    await page.goto(`${origin}/`);
    await page.waitForTimeout(1200);
    // The way in: the brain bar's room button when the home page shows it,
    // otherwise the crescent's nav point.
    const roomBar = page.locator(".brain-bar-action").nth(2);
    if ((await roomBar.count()) > 0) await roomBar.first().click();
    else {
      await page.locator(".nav-point").first().click();
      await page.locator(".nav-point").getByText(/room/i).first().click();
    }
    await page.waitForSelector(".room-page", { timeout: 6000 });
    await page.waitForTimeout(600);

    async function openRoom() {
      const roomBar = page.locator(".brain-bar-action").nth(2);
      if ((await roomBar.count()) > 0) await roomBar.first().click();
      else {
        await page.locator(".nav-point").first().click();
        await page.locator(".nav-point").getByText(/room/i).first().click();
      }
      await page.waitForSelector(".room-page", { timeout: 9000 });
      await page.waitForTimeout(600);
    }
    async function attach(files) {
      const chooserPromise = page.waitForEvent("filechooser");
      await page.locator(".composer-attach").click();
      const chooser = await chooserPromise;
      await chooser.setFiles(files);
    }
    async function waitForPost(count) {
      await page.waitForFunction(
        (wanted) => (window.__shelf.posts ?? []).filter((post) => post.text !== undefined).length >= wanted,
        count,
        { timeout: 15000 },
      );
    }
    const postCount = () => page.evaluate(() => window.__shelf.posts.filter((post) => post.text !== undefined).length);

    // The picker offers pictures and videos together.
    const accept = await page.locator('.composer input[type="file"]').getAttribute("accept");
    check(
      "the room picker offers pictures and videos",
      typeof accept === "string" && accept.includes(".png") && accept.includes(".mp4"),
      String(accept),
    );

    // 1. Two pictures in one attach: prepared by the chat's own road,
    //    uploaded, posted with their ids, rendered, walked in the lightbox.
    const pngA = makePng(320, 200, (x, y) => [40, 80 + (x % 60), 120]);
    const pngB = makePng(200, 320, (x, y) => [200 - x % 80, 60, 90 + y % 70]);
    await attach([
      { name: "shot.png", mimeType: "image/png", buffer: pngA },
      { name: "shot-b.png", mimeType: "image/png", buffer: pngB },
    ]);
    await page.waitForFunction(
      () => document.querySelectorAll(".room-media-chip").length === 2,
      null,
      { timeout: 9000 },
    );
    check("both pictures chip in the composer", true);
    await page.locator(".composer textarea").fill("look at these");
    await page.locator(".composer-send").click();
    await waitForPost(1);
    const imageSpecs = await page.evaluate(() => window.__shelf.specs.filter((spec) => spec.kind === "image"));
    const firstPost = await page.evaluate(() => window.__shelf.posts.filter((post) => post.text !== undefined).at(-1));
    check(
      "both pictures went up as reserves before the post",
      imageSpecs.length === 2 && Array.isArray(firstPost.media) && firstPost.media.length === 2,
      JSON.stringify({ specs: imageSpecs.length, media: firstPost.media?.length }),
    );
    check(
      "the posted pictures are app re-encodes, light ones",
      imageSpecs.every((spec) => spec.bytes > 0 && spec.bytes < 1.5 * MIB && /^image\//.test(spec.mime)),
      JSON.stringify(imageSpecs.map((spec) => ({ bytes: spec.bytes, mime: spec.mime }))),
    );

    await page.waitForSelector(".room-media-thumb", { timeout: 9000 });
    check(
      "both posted pictures render as thumbnails",
      (await page.locator(".room-media-thumb").count()) === 2,
    );
    const rowText = await page.locator(".room-row").last().locator(".room-bubble").textContent();
    check(
      "the words stand and no fallback word rides beside the pixels",
      rowText.includes("look at these") === true && !rowText.includes("[Image]"),
      JSON.stringify(rowText),
    );

    await page.locator(".room-media-thumb").first().click();
    await page.waitForSelector(".media-viewer", { timeout: 4000 });
    const firstSrc = await page.locator(".media-viewer-image").getAttribute("src");
    await page.locator(".media-viewer-next").click();
    await page.waitForFunction(
      (previous) => document.querySelector(".media-viewer-image")?.getAttribute("src") !== previous,
      firstSrc,
      { timeout: 4000 },
    );
    check("the lightbox walks to the next picture", true);
    const secondSrc = await page.locator(".media-viewer-image").getAttribute("src");
    await page.locator(".media-viewer-prev").click();
    await page.waitForFunction(
      (second) => document.querySelector(".media-viewer-image")?.getAttribute("src") !== second,
      secondSrc,
      { timeout: 4000 },
    );
    check("and back to the previous one", true);
    await page.locator(".media-viewer-close").click();
    await page.waitForFunction(() => document.querySelector(".media-viewer") === null, null, { timeout: 4000 });
    check("the lightbox closes", true);

    // 2. The video: compress, frames first, then the video; a media-only
    //    post carries no words and the row plays it inline.
    if (mp4B64 !== null) {
      await attach([{ name: "clip.mp4", mimeType: "video/mp4", buffer: Buffer.from(mp4B64, "base64") }]);
      await page.waitForSelector(".room-media-chip", { timeout: 9000 });
      await page.locator(".composer-send").click();
      await waitForPost(2);
      const specs = await page.evaluate(() => window.__shelf.specs);
      const frameCount = specs.filter((spec) => spec.kind === "image").length - 2;
      const videoSpecAt = specs.findIndex((spec) => spec.kind === "video");
      const frameSpecAts = specs.map((spec, at) => (spec.kind === "image" && at >= 2 ? at : -1)).filter((at) => at >= 0);
      const videoSpecs = specs.filter((spec) => spec.kind === "video");
      const videoPost = await page.evaluate(() => window.__shelf.posts.filter((post) => post.text !== undefined).at(-1));
      check(
        "the video's frames reserved before its own reserve",
        frameCount >= 1 &&
          videoSpecAt >= 0 &&
          frameSpecAts.length === frameCount &&
          frameSpecAts.every((at) => at < videoSpecAt),
        JSON.stringify({ frameCount, videoSpecAt, frameSpecAts }),
      );
      check(
        "the video's reserve names its frame ids",
        videoSpecs.length === 1 && Array.isArray(videoSpecs[0].frames) && videoSpecs[0].frames.length === frameCount,
        JSON.stringify(videoSpecs[0]?.frames),
      );
      const postedDescriptors = await page.evaluate(
        (ids) => ids.map((id) => window.__shelf.blobs[id]?.descriptor ?? null),
        videoPost.media,
      );
      check(
        "the post names the video, whose descriptor lists its frames",
        Array.isArray(postedDescriptors) &&
          postedDescriptors.some(
            (item) => item !== null && item.kind === "video" && Array.isArray(item.frames) && item.frames.length >= 1,
          ),
        JSON.stringify(postedDescriptors?.map((item) => (item === null ? null : [item.kind, item.frames.length]))),
      );
      check(
        "the video-only post carries no words",
        typeof videoPost.text === "string" && videoPost.text.length === 0,
        JSON.stringify(videoPost.text),
      );
      const videoId = videoSpecs[0] ? null : null; // ids are opaque; count reads another way
      void videoId;
      await page.waitForSelector(".room-media-item-tile", { timeout: 9000 });
      const readsBeforePlay = await page.evaluate(() => {
        const reads = window.__shelf.reads;
        return { total: Object.values(reads).reduce((sum, n) => sum + n, 0) };
      });
      const videoPostReads = await page.evaluate(() => {
        // The video's own blob id is the one its descriptor carries.
        const videoPost = window.__shelf.posts.filter((post) => post.text !== undefined).at(-1);
        const id = videoPost.media[0];
        return window.__shelf.reads[id] ?? 0;
      });
      check(
        "the video reads nothing until the reader presses play",
        videoPostReads === 0,
        JSON.stringify({ videoPostReads, readsBeforePlay }),
      );
      await page.locator(".room-media-play").last().click();
      await page.waitForSelector(".room-media-video", { timeout: 9000 });
      const videoPostReadsAfter = await page.evaluate(() => {
        const videoPost = window.__shelf.posts.filter((post) => post.text !== undefined).at(-1);
        return window.__shelf.reads[videoPost.media[0]] ?? 0;
      });
      check("play reads the video exactly once", videoPostReadsAfter === 1, String(videoPostReadsAfter));
      const videoRow = await page.locator(".room-row").last().locator(".room-bubble").textContent();
      check("no fallback word stands beside the video", !videoRow.includes("[Video]"), JSON.stringify(videoRow));
    }

    // 3. A chunk that fails once: arm the stub, then send another picture.
    await page.evaluate(() => {
      window.__shelf.failArm = true;
    });
    await attach([{ name: "third.png", mimeType: "image/png", buffer: pngA }]);
    await page.waitForSelector(".room-media-chip", { timeout: 9000 });
    await page.locator(".composer-send").click();
    await waitForPost(mp4B64 !== null ? 3 : 2);
    check("a failed chunk retried its idempotent index and completed", true);

    // 4. Over the cap: a video past 100 MiB is refused in words, nothing
    //    reaches the shelf, the chip is gone. Playwright refuses a buffer
    //    this big, so the fixture rides a real file.
    const bigPath = join(CHAT_DIR, ".room-media-big.mp4");
    await writeFile(bigPath, Buffer.alloc(101 * MIB + 16, 7));
    try {
      await attach([bigPath]);
    } finally {
      await rm(bigPath, { force: true });
    }
    await page.waitForFunction(
      () => (document.querySelector(".room-send-error")?.textContent ?? "").length > 0,
      null,
      { timeout: 9000 },
    );
    const capSentence = await page.locator(".room-send-error").textContent();
    check(
      "an over-cap video is refused in words",
      typeof capSentence === "string" && capSentence.includes("too large"),
      JSON.stringify(capSentence),
    );
    const bigOnShelf = await page.evaluate(
      () => window.__shelf.specs.filter((spec) => spec.bytes > 50 * 1024 * 1024).length,
    );
    check("nothing of it reached the shelf", bigOnShelf === 0, String(bigOnShelf));
    const chipsLeft = await page.evaluate(() => document.querySelectorAll(".room-media-chip").length);
    check("the refused chip is gone", chipsLeft === 0, String(chipsLeft));

    // 5. A blob that will not come is a neutral placeholder.
    await page.evaluate(() => {
      window.__shelf.dropNextBlob = true;
    });
    await attach([{ name: "vanish.png", mimeType: "image/png", buffer: pngA }]);
    await page.waitForSelector(".room-media-chip", { timeout: 9000 });
    await page.locator(".composer-send").click();
    await waitForPost(mp4B64 !== null ? 4 : 3);
    await page.waitForSelector(".room-media-fallback", { timeout: 9000 });
    const fallbackText = await page.locator(".room-media-fallback").first().textContent();
    check(
      "a blob that will not come renders the fallback words",
      (await page.locator(".room-media-fallback").count()) >= 1 &&
        fallbackText === "[Image]" &&
        pageErrors.length === 0,
      JSON.stringify(fallbackText),
    );

    // 6. Lazy and bounded: thirty seeded picture rows and one video read
    //    only what is near the viewport, and the LRU revokes — an evicted
    //    picture re-reads when it comes back.
    const seedIds = [];
    const seedEntries = [];
    for (let at = 0; at < 30; at += 1) {
      const id = `s${at.toString().padStart(2, "0")}${"0".repeat(28)}`;
      seedIds.push(id);
      seedEntries.push({
        seq: 500 + at,
        member_id: 1,
        name: "",
        former: false,
        text: at % 5 === 0 ? "[Image]" : `seed ${at}`,
        time: 1700000000 + at,
        call_ai: false,
        read: null,
        media: [
          {
            id,
            kind: "image",
            mime: "image/png",
            bytes: 91,
            sha256: "0".repeat(64),
            width: 1,
            height: 1,
            duration_ms: null,
            frames: [],
          },
        ],
      });
    }
    const videoSeedId = `sv${"0".repeat(29)}`;
    const frameSeedId = `sf${"0".repeat(29)}`;
    seedIds.push(videoSeedId, frameSeedId);
    seedEntries.push({
      seq: 530,
      member_id: 1,
      name: "",
      former: false,
      text: "",
      time: 1700000040,
      call_ai: false,
      read: null,
      media: [
        {
          id: videoSeedId,
          kind: "video",
          mime: "video/mp4",
          bytes: 91,
          sha256: "0".repeat(64),
          width: 1,
          height: 1,
          duration_ms: 83000,
          frames: [frameSeedId],
        },
      ],
    });
    await page.addInitScript((seed) => {
      window.__STUB_SEED_IDS__ = seed.ids;
      window.__STUB_HISTORY__ = seed.entries;
    }, { ids: seedIds, entries: seedEntries });
    await page.reload();
    await page.waitForTimeout(1200);
    await openRoom();
    await page.waitForTimeout(400);

    // The room loads GLUED TO THE BOTTOM (stick-to-bottom): the near rows
    // are the newest, and the video is among them.
    const initialReads = await page.evaluate(() => window.__shelf.reads);
    const initialDistinct = Object.keys(initialReads).length;
    check(
      "only the near-viewport rows were read",
      initialDistinct >= 1 && initialDistinct <= 16,
      JSON.stringify({ distinct: initialDistinct }),
    );
    check(
      "the seeded video read nothing, its poster frame did",
      initialReads[videoSeedId] === undefined && initialReads[frameSeedId] === 1,
      JSON.stringify({ video: initialReads[videoSeedId], frame: initialReads[frameSeedId] }),
    );

    // To the top: the oldest rows come near and read; the bottom's leave
    // the LRU and are revoked.
    await page.locator(".thread").evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.waitForTimeout(1000);
    const topReads = await page.evaluate(() => window.__shelf.reads);
    check(
      "the top of the history read once it came near",
      Object.keys(topReads).length > initialDistinct + 4 && (topReads[seedIds[0]] ?? 0) >= 1,
      JSON.stringify({ distinct: Object.keys(topReads).length, initialDistinct, first: topReads[seedIds[0]] }),
    );
    // Sweep the middle in steps so every row comes near and reads: past
    // the LRU's cap the oldest are revoked — and read again on the way back.
    const steps = await page.locator(".thread").evaluate((el) => {
      const total = el.scrollHeight - el.clientHeight;
      const step = el.clientHeight * 0.7;
      return { total, step, viewport: el.clientHeight };
    });
    for (let top = 0; top < steps.total; top += steps.step) {
      await page.locator(".thread").evaluate((el, at) => {
        el.scrollTop = at;
      }, top);
      await page.waitForTimeout(160);
    }
    await page.locator(".thread").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(800);
    const sweptReads = await page.evaluate(() => window.__shelf.reads);
    check(
      "the whole history read as it was swept",
      Object.keys(sweptReads).length >= seedIds.length - 2,
      JSON.stringify({ distinct: Object.keys(sweptReads).length, of: seedIds.length }),
    );
    // The release grace expires, the far holds go back, the LRU trims.
    await page.waitForTimeout(2600);
    await page.locator(".thread").evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.waitForTimeout(600);

    // 7. The host's broom: confirm, clear, and the rows fall back to words.
    await page.locator(".room-clear-chip").click();
    await page.waitForSelector(".room-clear", { timeout: 4000 });
    const confirmWords = await page.locator(".room-clear-ask").textContent();
    check(
      "the clear action asks first, and says what stays",
      typeof confirmWords === "string" &&
        confirmWords.includes("for everyone") &&
        confirmWords.includes("Messages stay"),
      JSON.stringify(confirmWords),
    );
    await page.locator(".room-clear-delete").click();
    await page.waitForFunction(() => window.__shelf.clears >= 1, null, { timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(900);
    const clears = await page.evaluate(() => window.__shelf.clears);
    const fallbacksAfterClear = await page.locator(".room-media-fallback").count();
    check(
      "the clear ran, and after it the rows show the fallback words",
      clears >= 1 && fallbacksAfterClear >= 1,
      JSON.stringify({ clears, fallbacksAfterClear }),
    );
    const readsAfterClear = await page.evaluate(
      () => Object.values(window.__shelf.reads).reduce((sum, n) => sum + n, 0),
    );
    await page.waitForTimeout(400);
    const readsLater = await page.evaluate(
      () => Object.values(window.__shelf.reads).reduce((sum, n) => sum + n, 0),
    );
    check("a cleared shelf answers nothing new", readsLater === readsAfterClear, `${readsAfterClear} → ${readsLater}`);

    // 8. Eight per message: the ninth is a sentence, eight chips stand.
    await page.evaluate(() => {
      window.__STUB_HISTORY__ = [];
    });
    await page.reload();
    await page.waitForTimeout(1200);
    await openRoom();
    const nine = Array.from({ length: 9 }, (_, at) => ({
      name: `nine-${at}.png`,
      mimeType: "image/png",
      buffer: pngA,
    }));
    await attach(nine);
    await page.waitForFunction(() => document.querySelectorAll(".room-media-chip").length === 8, null, { timeout: 12000 });
    const nineSentence = await page.locator(".room-send-error").textContent().catch(() => null);
    check(
      "eight ride one message and the ninth is a sentence",
      (await page.locator(".room-media-chip").count()) === 8 &&
        typeof nineSentence === "string" &&
        nineSentence.includes("8"),
      JSON.stringify(nineSentence),
    );

    check(
      "no filename and no image bytes reached the console",
      !consoleLines.some((line) => line.includes("shot.png") || line.includes("clip.mp4") || line.includes("data:")),
      JSON.stringify(consoleLines.slice(0, 3)),
    );
    check("the room ran clean", pageErrors.length === 0, JSON.stringify(pageErrors));
  } finally {
    await browser.close();
  }
}

await rm(outDir, { recursive: true, force: true });
let server = null;
try {
  await mkdir(outDir, { recursive: true });
  await build({
    root: CHAT_DIR,
    configFile: false,
    base: "./",
    logLevel: "silent",
    build: { outDir, emptyOutDir: true, target: "es2022" },
  });
  await buildProbe();

  const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css" };
  server = createServer((request, response) => {
    const path = decodeURIComponent((request.url ?? "/").split("?")[0]).replace(/^\/+/, "");
    const file = join(outDir, normalize(path.endsWith("/") || path === "" ? `${path}index.html` : path));
    if (!file.startsWith(outDir) || !existsSync(file)) {
      response.writeHead(404);
      response.end("not found");
      return;
    }
    response.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
    response.end(readFileSync(file));
  });
  await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const engines = process.argv.slice(2).length > 0 ? process.argv.slice(2) : Object.keys(ENGINES);
  for (const engineName of engines) {
    const mp4B64 = await probeEngine(engineName, origin);
    await probeApp(engineName, origin, mp4B64);
  }
} finally {
  if (server) server.close();
  await rm(outDir, { recursive: true, force: true });
  await rm(probeDir, { recursive: true, force: true });
}

if (fail > 0) {
  console.log(`\n${fail} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
