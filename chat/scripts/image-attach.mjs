// Image attach, end to end against the real build: the picker offers
// pictures only while `/props` says the model can see, the re-encode strips
// the file's own metadata (a GPS-tagged JPEG arrives, an app-made JPEG
// leaves, long side capped), the wire carries the content-parts shape with a
// `data:` URI, a reload restores the thumbnail from IndexedDB, and a blind
// model gets the placeholder sentence instead of pixels. The budget phase
// proves the 560-token image cost by refusing at a window an empty attach
// would fit.
//
// Mirrors turn-failures.mjs (the real app under a __TAURI__ shim) and
// pdf-attach.mjs (chromium + webkit). No file name and no image byte ever
// reaches a console or log line — the script checks its own output too.
//
// Run: node scripts/image-attach.mjs [chromium|webkit ...]   (from chat/)

import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { chromium, webkit } from "@playwright/test";
import { build } from "vite";

const ENGINES = { chromium, webkit };
const CHAT_DIR = fileURLToPath(new URL("..", import.meta.url));
const outDir = join(CHAT_DIR, ".image-attach-dist");
// The page is served under the PACKAGED policy, read at run time: a CSP
// regression (an object URL the policy refuses) renders every blob: image
// as nothing while element-count checks keep passing — the walk at fb477ddd
// shipped exactly that because these harnesses ran without the policy.
const csp = JSON.parse(
  await readFile(join(CHAT_DIR, "..", "src-tauri", "tauri.conf.json"), "utf8"),
).app.security.csp;
const probeDir = join(CHAT_DIR, ".image-attach-probe");

let fail = 0;
function check(label, condition, detail) {
  const ok = condition ? "ok  " : "FAIL";
  if (!condition) fail++;
  console.log(`${ok} ${label}${condition || detail === undefined ? "" : `\n     ${detail}`}`);
}

// --- a small PNG encoder, enough for test sources -------------------------

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

/** `pixel(x, y)` answers [r, g, b] or [r, g, b, a]. */
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

// --- an EXIF APP1 with a GPS IFD, spliced in front of a plain JPEG --------

const GPS_SENTINEL = Buffer.from([0x5a, 0x5a, 0x5a, 0x5a]);

/** Whether a JPEG still carries an APP1 segment: the only carrier of Exif.
    Marker walk, not a byte search — four bytes can always collide inside
    compressed entropy, a segment cannot. */
function hasApp1Segment(jpeg) {
  let at = 2;
  while (at + 4 <= jpeg.length) {
    if (jpeg[at] !== 0xff) return false;
    const marker = jpeg[at + 1];
    if (marker === 0xda) return false;
    if (marker === 0xe1) return true;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    at += 2 + jpeg.readUInt16BE(at + 2);
  }
  return false;
}

/** Every marker before SOS, with its payload: the fixture writer's own view
    of what a sanitizer kept and what it dropped. */
function jpegSegmentsBeforeSos(jpeg) {
  const out = [];
  let at = 2;
  while (at + 4 <= jpeg.length) {
    if (jpeg[at] !== 0xff) return out;
    const marker = jpeg[at + 1];
    if (marker === 0xda) return out;
    const length = 2 + jpeg.readUInt16BE(at + 2);
    out.push({ marker, payload: jpeg.subarray(at + 4, at + length) });
    at += length;
  }
  return out;
}

/** One JPEG segment (marker, payload) as bytes. */
function jpegSegment(marker, payload) {
  const segment = Buffer.alloc(4 + payload.length);
  segment[0] = 0xff;
  segment[1] = marker;
  segment.writeUInt16BE(payload.length + 2, 2);
  payload.copy(segment, 4);
  return segment;
}

/** Splice segments in after the JFIF APP0 (WebKit refuses an EXIF APP1 that
    precedes it, and the fixtures must decode everywhere). */
function spliceAfterApp0(jpeg, segments) {
  let at = 2;
  while (jpeg[at] === 0xff && jpeg[at + 1] === 0xe0) {
    at += 2 + jpeg.readUInt16BE(at + 2);
  }
  return Buffer.concat([jpeg.subarray(0, at), ...segments, jpeg.subarray(at)]);
}

/** Every chunk type in a PNG, in order. */
function pngChunkTypes(png) {
  const out = [];
  let at = 8;
  while (at + 8 <= png.length) {
    const length = png.readUInt32BE(at);
    const type = png.toString("latin1", at + 4, at + 8);
    out.push(type);
    at += 12 + length;
    if (type === "IEND") return out;
  }
  return out;
}

/** A PNG with extra metadata chunks inserted after IHDR — the iCCP payload
    is a name, a null, a compression byte and some profile-ish bytes; tIME
    is its seven fixed bytes. Both are shapes real files carry. */
function pngWithMetadata(png) {
  const ihdrEnd = 8 + 12 + png.readUInt32BE(8);
  const iccp = pngChunk(
    "iCCP",
    Buffer.concat([Buffer.from("secret-icc\0", "latin1"), Buffer.from([0x00]), Buffer.from([0x9c, 0xdb, 0x42, 0x8c, 0x21])]),
  );
  const time = pngChunk("tIME", Buffer.from([7, 214, 9, 3, 12, 30, 5]));
  return Buffer.concat([png.subarray(0, ihdrEnd), iccp, time, png.subarray(ihdrEnd)]);
}

function withGpsExif(jpeg) {
  const tiff = Buffer.concat([
    Buffer.from("II", "latin1"),
    Buffer.from([0x2a, 0x00]),
    Buffer.from([0x08, 0x00, 0x00, 0x00]),
    Buffer.from([0x01, 0x00]),
    // IFD0: one entry, the GPS pointer to offset 26.
    Buffer.from([0x25, 0x88, 0x04, 0x00, 0x01, 0x00, 0x00, 0x00, 0x1a, 0x00, 0x00, 0x00]),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    // GPS IFD at 26: lat ref N, long ref E, altitude carrying the sentinel.
    Buffer.from([0x02, 0x00]),
    Buffer.from([0x01, 0x00, 0x02, 0x00, 0x02, 0x00, 0x00, 0x00, 0x4e, 0x00, 0x00, 0x00]),
    Buffer.from([0x04, 0x00, 0x02, 0x00, 0x02, 0x00, 0x00, 0x00, 0x45, 0x00, 0x00, 0x00]),
    Buffer.from([0x06, 0x00, 0x04, 0x00, 0x01, 0x00, 0x00, 0x00, ...GPS_SENTINEL]),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
  ]);
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const segment = Buffer.alloc(2 + payload.length);
  segment[0] = 0xff;
  segment[1] = 0xe1;
  segment.writeUInt16BE(payload.length + 2, 2);
  payload.copy(segment, 4);
  // The APP1 rides after the canvas's JFIF APP0: WebKit refuses an EXIF
  // segment that precedes the APP0, and the point is a source every decoder
  // here accepts.
  let at = 2;
  while (jpeg[at] === 0xff && jpeg[at + 1] === 0xe0) {
    at += 2 + jpeg.readUInt16BE(at + 2);
  }
  return Buffer.concat([jpeg.subarray(0, at), segment, jpeg.subarray(at)]);
}


/** A one-page fixture builder: mediabunny mints the MP4 the app phase
    attaches — the same tiny clip room-media's probe makes. */
async function buildProbe() {
  await rm(probeDir, { recursive: true, force: true });
  await mkdir(probeDir, { recursive: true });
  await writeFile(
    join(probeDir, "index.html"),
    '<!doctype html><html><head><meta charset="utf-8"><title>video fixture</title></head><body><script type="module" src="./main.ts"></script></body></html>',
  );
  const main = [
    'import { Output, Mp4OutputFormat, BufferTarget, CanvasSource } from "mediabunny";',
    "(window as unknown as { __FIXTURE__: unknown }).__FIXTURE__ = {",
    "  build: async () => {",
    "    const canvas = document.createElement('canvas');",
    "    canvas.width = 640; canvas.height = 360;",
    "    const ctx = canvas.getContext('2d');",
    "    const source = new CanvasSource(canvas, { codec: 'avc', bitrate: 1_000_000 });",
    "    const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });",
    "    output.addVideoTrack(source, { frameRate: 30 });",
    "    await output.start();",
    "    for (let at = 0; at < 45; at += 1) {",
    "      ctx.fillStyle = 'hsl(' + (at * 8) + ', 70%, 50%)';",
    "      ctx.fillRect(0, 0, 640, 360);",
    "      ctx.fillStyle = '#fff';",
    "      ctx.fillRect(at * 14, 150, 40, 60);",
    "      await source.add(at / 30, 1 / 30);",
    "    }",
    "    await output.finalize();",
    "    const bytes = new Uint8Array(output.target.buffer);",
    "    let binary = '';",
    "    for (let walk = 0; walk < bytes.length; walk += 0x8000) {",
    "      binary += String.fromCharCode(...bytes.subarray(walk, walk + 0x8000));",
    "    }",
    "    return btoa(binary);",
    "  },",
    "  buildSlow: async () => {",
    "    const canvas = document.createElement('canvas');",
    "    canvas.width = 1280; canvas.height = 720;",
    "    const ctx = canvas.getContext('2d');",
    "    const source = new CanvasSource(canvas, { codec: 'avc', bitrate: 2_000_000 });",
    "    const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });",
    "    output.addVideoTrack(source, { frameRate: 30 });",
    "    await output.start();",
    "    for (let at = 0; at < 600; at += 1) {",
    "      const shade = (at * 3) % 255;",
    "      ctx.fillStyle = 'rgb(' + shade + ',' + ((shade + 80) % 255) + ',' + ((shade + 160) % 255) + ')';",
    "      ctx.fillRect(0, 0, 1280, 720);",
    "      ctx.fillStyle = '#fff';",
    "      ctx.fillRect((at * 7) % 1200, 300, 60, 90);",
    "      await source.add(at / 30, 1 / 30);",
    "    }",
    "    await output.finalize();",
    "    const bytes = new Uint8Array(output.target.buffer);",
    "    let binary = '';",
    "    for (let walk = 0; walk < bytes.length; walk += 0x8000) {",
    "      binary += String.fromCharCode(...bytes.subarray(walk, walk + 0x8000));",
    "    }",
    "    return btoa(binary);",
    "  },",
    "};",
    "",
  ].join("\n");
  await writeFile(join(probeDir, "main.ts"), main);
  await build({
    root: CHAT_DIR,
    configFile: false,
    base: "./",
    logLevel: "silent",
    build: {
      outDir: join(CHAT_DIR, ".image-attach-dist"),
      emptyOutDir: false,
      target: "es2022",
      rollupOptions: { input: join(probeDir, "index.html") },
    },
  });
}

async function probeEngine(engineName, origin) {
  console.log(`\n--- ${engineName} ---`);
  const browser = await ENGINES[engineName].launch({ args: ["--no-sandbox"] });
  // The stub server's word about itself; phases flip these between reloads.
  const state = { vision: true, nctx: 1200 };
  try {
    const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    const page = await context.newPage();
    const pageErrors = [];
    const consoleLines = [];
    // WebKit answers a canceled conversion's in-flight blob read with one
    // unhandled NotReadableError nobody is left to catch — a library
    // artifact of canceling mid-read, counted so the final check allows
    // exactly as many as the cancels performed and nothing else.
    let cancelsPerformed = 0;
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    page.on("console", (message) => consoleLines.push(message.text()));
    await page.addInitScript(() => {
      window.__logEvents = [];
      window.__model = "m";
      window.__hangProps = false;
      window.__TAURI__ = {
        core: {
          invoke: async (command, args) => {
            if (command === "brain_state")
              return {
                kind: "running",
                endpoint: "http://127.0.0.1:18099/v1",
                model: window.__model,
              };
            if (command === "brain_host_credential") return "t";
            if (command === "brain_capability") return { kind: "unmeasured", chosen: true };
            if (command === "brain_previous_session_crashed") return false;
            if (command === "brain_log_event") {
              window.__logEvents.push(String(args?.code ?? args?.event ?? JSON.stringify(args) ?? ""));
              return null;
            }
            throw new Error(`stub missing ${command}`);
          },
        },
        event: { listen: () => Promise.resolve(() => {}) },
      };
    });
    await page.route("**/kalsa/chat/**", (route) => route.fulfill({ status: 204, body: "" }));
    await page.route("**/props", async (route) => {
      // The pending window a model switch really has: /props asked and not
      // yet answered.
      if (await page.evaluate(() => window.__hangProps)) return;
      await route.fulfill({
        json: {
          default_generation_settings: { n_ctx: state.nctx },
          modalities: { vision: state.vision, audio: false, video: false },
          chat_template: "",
        },
      });
    });
    const bodies = [];
    const bodyLengths = [];
    await page.route("**/v1/chat/completions", async (route) => {
      try {
        const raw = route.request().postData() ?? "";
        bodies.push(JSON.parse(raw));
        bodyLengths.push(raw.length);
      } catch {
        bodies.push(null);
        bodyLengths.push(0);
      }
      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
        body: 'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      });
    });

    async function openChat() {
      const chip = page.locator(".brain-bar-chat");
      if ((await chip.count()) > 0) await chip.first().click();
      await page.waitForTimeout(400);
    }

    async function reopenConversation(titleRegex) {
      await page.reload();
      await page.waitForTimeout(1200);
      await openChat();
      const drawer = page.getByRole("button", { name: "Show conversations", exact: true });
      if (await drawer.isVisible()) await drawer.click();
      await page.locator(".sidebar").getByRole("button", { name: titleRegex }).first().click();
      await page.waitForTimeout(600);
    }

    async function attach(files) {
      const chooserPromise = page.waitForEvent("filechooser");
      await page.locator(".composer-attach").click();
      const chooser = await chooserPromise;
      await chooser.setFiles(files);
    }

    /** The bytes behind the pending chip, as the app made them: read from
        the image store the chip's own attach filled (the store holds the
        exact blob the wire would send), base64'd for Node, decode-checked
        in the page's own decoder. Call `clearImages` first — the record to
        read is the only one. */
    async function readChip() {
      return page.evaluate(async () => {
        const record = await new Promise((resolve, reject) => {
          const open = indexedDB.open("kalsa-chat.images");
          open.onsuccess = () => {
            const db = open.result;
            const request = db.transaction("images", "readonly").objectStore("images").getAll();
            request.onsuccess = () => {
              db.close();
              resolve(request.result.at(-1) ?? null);
            };
            request.onerror = () => {
              db.close();
              reject(request.error ?? new Error("indexeddb"));
            };
          };
          open.onerror = () => reject(open.error ?? new Error("indexeddb"));
        });
        if (record === null) return { b64: "", decodes: false };
        const blob = new Blob([record.bytes], { type: record.mime });
        const b64 = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.readAsDataURL(blob);
        });
        let decodes = true;
        try {
          const bitmap = await createImageBitmap(blob);
          bitmap.close();
        } catch {
          decodes = false;
        }
        return { b64, decodes };
      });
    }

    async function clearImages() {
      await page.evaluate(
        () =>
          new Promise((resolve) => {
            const open = indexedDB.open("kalsa-chat.images");
            open.onsuccess = () => {
              const db = open.result;
              const tx = db.transaction("images", "readwrite");
              tx.objectStore("images").clear();
              tx.oncomplete = () => {
                db.close();
                resolve();
              };
            };
            open.onerror = () => resolve();
          }),
      );
    }

    /** Bounded wait for a page condition: false instead of a thrown timeout,
        so a failed check reports its own detail. */
    async function settles(condition, timeout) {
      try {
        await page.waitForFunction(condition, null, { timeout });
        return true;
      } catch {
        return false;
      }
    }

    /** Back to nothing: the conversation store's keys and the image store. */
    async function wipeStorage() {
      await page.evaluate(() => {
        localStorage.clear();
        return Promise.all([
          new Promise((resolve) => {
            const req = indexedDB.deleteDatabase("kalsa-chat.images");
            req.onsuccess = req.onerror = req.onblocked = () => resolve();
          }),
        ]);
      });
    }

    // A video chip shows its glyph from the first moment; READY is when
    // its work line ("Compressing… N%") is gone.
    async function awaitVideoReady(timeout = 20000) {
      await page.waitForFunction(
        () =>
          document.querySelectorAll(".composer-image-glyph").length >= 1 &&
          document.querySelectorAll(".composer-image-label").length === 0,
        null,
        { timeout },
      );
    }

    async function sendText(text) {
      const textarea = page.locator(".composer textarea");
      await textarea.fill(text);
      await textarea.press("Enter");
      await page.waitForSelector(".composer-stop", { timeout: 4000 }).catch(() => {});
      await page.waitForFunction(
        () => !document.querySelector(".composer-stop"),
        null,
        { timeout: 8000 },
      );
      await page.waitForTimeout(300);
    }

    /** The engine's own canvas JPEG, as base64: the source the GPS tags are
        spliced onto, big enough that the 1536 cap has work to do. */
    async function bigCanvasJpeg() {
      return page.evaluate(
        () =>
          new Promise((resolve) => {
            const canvas = document.createElement("canvas");
            canvas.width = 2048;
            canvas.height = 1024;
            const ctx = canvas.getContext("2d");
            const gradient = ctx.createLinearGradient(0, 0, 2048, 1024);
            gradient.addColorStop(0, "#204a87");
            gradient.addColorStop(1, "#e9b96e");
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 2048, 1024);
            canvas.toBlob(
              (blob) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result).split(",")[1]);
                reader.readAsDataURL(blob);
              },
              "image/jpeg",
              0.9,
            );
          }),
      );
    }

    await page.goto(`${origin}/`);
    await page.waitForTimeout(1200);
    await openChat();

    // 1. Vision on: the picker offers pictures.
    const acceptSeeing = await page
      .locator('.composer input[type="file"]')
      .getAttribute("accept");
    check(
      "the picker offers pictures while the model sees",
      typeof acceptSeeing === "string" && acceptSeeing.includes(".png") && acceptSeeing.includes(".heic"),
      String(acceptSeeing),
    );

    // 2. Attach: a big JPEG carrying GPS EXIF becomes a chip.
    const gpsJpeg = withGpsExif(Buffer.from(await bigCanvasJpeg(), "base64"));
    const sourceDecodes = await page.evaluate(async (b64) => {
      try {
        const bitmap = await createImageBitmap(
          new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: "image/jpeg" }),
        );
        const dims = { width: bitmap.width, height: bitmap.height };
        bitmap.close();
        return dims;
      } catch {
        return null;
      }
    }, gpsJpeg.toString("base64"));
    check(
      "the GPS-tagged source is a decodable 2048x1024 JPEG",
      sourceDecodes?.width === 2048 && sourceDecodes?.height === 1024,
      JSON.stringify(sourceDecodes),
    );
    check(
      "the splice really gave it the GPS APP1",
      hasApp1Segment(gpsJpeg) && gpsJpeg.indexOf(GPS_SENTINEL) !== -1,
    );
    await attach([{ name: "gps-photo.jpg", mimeType: "image/jpeg", buffer: gpsJpeg }]);
    await page.waitForSelector(".composer-image", { timeout: 6000 });
    check(
      "the attached picture chips in the composer",
      (await page.locator(".composer-image").count()) === 1,
    );
    const chipPixels = await page.locator(".composer-image img").evaluate(
      (img) => img.naturalWidth,
    );
    check(
      "the chip's thumbnail really renders (the policy admits it)",
      chipPixels > 0,
      `naturalWidth=${chipPixels}`,
    );

    // 3. Send: the wire carries text part + image part with a data: URI.
    await sendText("Look at my picture.");
    const body = bodies.at(-1);
    const parts = body?.messages?.[1]?.content;
    check(
      "the pictured turn leaves as a parts array",
      Array.isArray(parts) && parts.length === 2,
      Array.isArray(parts) ? JSON.stringify(parts.map((p) => p?.type)) : typeof parts,
    );
    check(
      "the text part comes first, word for word",
      parts?.[0]?.type === "text" && parts?.[0]?.text === "Look at my picture.",
      JSON.stringify(parts?.[0] ?? null),
    );
    const url = parts?.[1]?.image_url?.url;
    check(
      "the image part is a data: jpeg uri",
      parts?.[1]?.type === "image_url" &&
        typeof url === "string" &&
        url.startsWith("data:image/jpeg;base64,"),
      typeof url === "string" ? url.split(",").slice(0, 1).join("") : typeof url,
    );
    check(
      "the seeing prompt says the images arrive as images",
      typeof body?.messages?.[0]?.content === "string" &&
        body.messages[0].content.includes("Images the user attaches reach you as images."),
      JSON.stringify(String(body?.messages?.[0]?.content ?? "").slice(0, 140)),
    );

    // 4. The bytes on the wire are app-made: metadata gone, long side capped.
    const wireB64 = typeof url === "string" ? url.split(",")[1] ?? "" : "";
    const wireBytes = Buffer.from(wireB64, "base64");
    check(
      "the wire JPEG carries no Exif segment",
      wireBytes.length > 0 && !hasApp1Segment(wireBytes),
      `${wireBytes.length} bytes`,
    );
    const wireDims = await page.evaluate(async (b64) => {
      const bitmap = await createImageBitmap(
        new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: "image/jpeg" }),
      );
      const dims = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return dims;
    }, wireB64);
    check(
      "the wire image is capped at the 1536 long side",
      wireDims.width === 1536 && wireDims.height === 768,
      JSON.stringify(wireDims),
    );

    // 5. The bubble shows the picture; its bytes are in IndexedDB.
    const bubblePixels = await page.locator(".user-bubble img").evaluate(
      (img) => img.naturalWidth,
    );
    check(
      "the user bubble shows the thumbnail, painted",
      (await page.locator(".user-bubble img").count()) === 1 && bubblePixels > 0,
      `naturalWidth=${bubblePixels}`,
    );
    const stored = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const open = indexedDB.open("kalsa-chat.images");
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction("images", "readonly");
            const count = tx.objectStore("images").count();
            count.onsuccess = () => {
              db.close();
              resolve(count.result);
            };
          };
          open.onerror = () => resolve(-1);
        }),
    );
    check("the picture's bytes sit in IndexedDB", stored === 1, String(stored));

    // 6. A reload restores the thumbnail from IndexedDB.
    await reopenConversation(/Look at my picture/i);
    check(
      "a reload restores the thumbnail from IndexedDB",
      (await page.locator(".user-bubble img").count()) === 1,
    );

    // 7. A blob that is gone renders the placeholder, not a crash.
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          const open = indexedDB.open("kalsa-chat.images");
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction("images", "readwrite");
            tx.objectStore("images").clear();
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
          };
          open.onerror = () => resolve();
        }),
    );
    await reopenConversation(/Look at my picture/i);
    check(
      "a missing blob renders the placeholder, not a crash",
      (await page.locator(".user-image-missing").count()) === 1 && pageErrors.length === 0,
      JSON.stringify(pageErrors),
    );

    // 8. Vision off: nothing about images shows, and the pictured turn goes
    //    as text with the placeholder sentence.
    state.vision = false;
    await reopenConversation(/Look at my picture/i);
    const acceptBlind = await page
      .locator('.composer input[type="file"]')
      .getAttribute("accept");
    check(
      "the blind picker offers no pictures",
      typeof acceptBlind === "string" &&
        !acceptBlind.includes(".png") &&
        !acceptBlind.includes("image"),
      String(acceptBlind),
    );
    check(
      "no image chip renders while blind",
      (await page.locator(".composer-image").count()) === 0,
    );
    await sendText("and now?");
    const blind = bodies.at(-1);
    const asked = (blind?.messages ?? [])
      .filter((m) => m.role === "user")
      .map((m) => (Array.isArray(m.content) ? "parts" : m.content));
    check(
      "the pictured turn arrives as text with the placeholder",
      asked[0] === "Look at my picture.\n[an image the current AI cannot see]",
      JSON.stringify(asked.map((a) => (typeof a === "string" ? a.slice(0, 70) : a))),
    );
    check(
      "a turn without media stays a plain string",
      asked[1] === "and now?",
      JSON.stringify(asked[1]),
    );
    const blindWire = JSON.stringify(blind ?? {});
    check(
      "no image part and no image bytes leave for a blind model",
      !blindWire.includes("image_url") && !blindWire.includes("data:image"),
      `${blindWire.length} bytes of body`,
    );
    check(
      "the blind prompt keeps its wording",
      blind?.messages?.[0]?.content?.includes("You cannot see images, audio or video.") === true,
      JSON.stringify(String(blind?.messages?.[0]?.content ?? "").slice(0, 140)),
    );
    await attach([{ name: "dropped.png", mimeType: "image/png", buffer: Buffer.from("png") }]);
    await page.waitForFunction(
      () =>
        document
          .querySelector(".attach-status")
          ?.textContent?.includes("can't read this kind of file"),
      null,
      { timeout: 4000 },
    );
    const blindStatus = await page.locator(".attach-status").textContent();
    check(
      "a picture offered while blind is refused in words",
      typeof blindStatus === "string" && blindStatus.includes("can't read this kind of file"),
      JSON.stringify(blindStatus ?? ""),
    );

    // 9. The budget: an empty conversation fits 700, so a refusal there is
    //    the picture's own 560 tokens being counted.
    state.vision = true;
    state.nctx = 700;
    await wipeStorage();
    await page.reload();
    await page.waitForTimeout(1200);
    await openChat();
    const alphaPng = makePng(8, 8, (x, y) => [255, 0, 0, x === y ? 128 : 255]);
    await attach([{ name: "tiny.png", mimeType: "image/png", buffer: alphaPng }]);
    await page.waitForSelector(".refusal-banner", { timeout: 6000 });
    check(
      "a picture is refused at a window only its own cost overflows",
      (await page.locator(".refusal-banner").count()) === 1,
    );
    check(
      "no chip survives a refused attach",
      (await page.locator(".composer-image").count()) === 0,
    );

    // 10. Room to fit: the same picture attaches, sends as PNG (it has
    //     transparency), at its own size.
    state.nctx = 1200;
    await page.reload();
    await page.waitForTimeout(1200);
    await openChat();
    const drawer = page.getByRole("button", { name: "Show conversations", exact: true });
    if (await drawer.isVisible()) await drawer.click();
    await page.locator(".sidebar").getByRole("button", { name: /tiny\.png/i }).first().click();
    await page.waitForTimeout(600);
    await attach([{ name: "tiny.png", mimeType: "image/png", buffer: alphaPng }]);
    await page.waitForSelector(".composer-image", { timeout: 6000 });
    await sendText("What is red here?");
    const red = bodies.at(-1);
    const redParts = red?.messages?.[1]?.content;
    const redUrl = redParts?.[1]?.image_url?.url;
    check(
      "transparency keeps PNG on the wire",
      Array.isArray(redParts) && typeof redUrl === "string" && redUrl.startsWith("data:image/png;base64,"),
      Array.isArray(redParts) ? JSON.stringify(redParts.map((p) => p?.type)) : typeof redParts,
    );
    const redDims = await page.evaluate(async (b64) => {
      const bitmap = await createImageBitmap(
        new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: "image/png" }),
      );
      const dims = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return dims;
    }, typeof redUrl === "string" ? redUrl.split(",")[1] ?? "" : "");
    check(
      "a small picture is not scaled up",
      redDims.width === 8 && redDims.height === 8,
      JSON.stringify(redDims),
    );

    // 11. A kind the webview cannot decode is refused with a sentence and a
    //     stable log token — never a crash, never a name.
    await attach([{ name: "broken.heic", mimeType: "image/heic", buffer: Buffer.from("not a heic") }]);
    await page.waitForFunction(
      () =>
        document
          .querySelector(".attach-status")
          ?.textContent?.includes("couldn't read this file"),
      null,
      { timeout: 4000 },
    );
    const heicStatus = await page.locator(".attach-status").textContent();
    check(
      "an undecodable picture is refused in words",
      typeof heicStatus === "string" && heicStatus.includes("couldn't read this file"),
      JSON.stringify(heicStatus ?? ""),
    );
    const logEvents = await page.evaluate(() => window.__logEvents);
    check(
      "the refusal logs its own code, not a name",
      logEvents.some((event) => /^chat\.attach_failed\.image_/.test(event)) &&
        !logEvents.some((event) => event.includes(".png") || event.includes(".heic") || event.includes("gps-photo")),
      JSON.stringify(logEvents),
    );

    // 12. The strip is an allow-list: a JPEG carrying COM, APP2 (ICC) and an
    //     APP1 XMP packet, and a PNG carrying iCCP and tIME, come out with
    //     none of them — and still decode.
    const metaJpeg = spliceAfterApp0(
      Buffer.from(await bigCanvasJpeg(), "base64"),
      [
        jpegSegment(0xfe, Buffer.from("secret-comment-marker", "latin1")),
        jpegSegment(0xe2, Buffer.concat([Buffer.from("ICC_PROFILE\0\x01", "latin1"), Buffer.alloc(64, 0x7e)])),
        jpegSegment(0xe1, Buffer.from('<x:xmpmeta xmlns:x="adobe:ns:meta/">secret-xmp-packet</x:xmpmeta>', "latin1")),
      ],
    );
    await clearImages();
    await attach([{ name: "meta.jpg", mimeType: "image/jpeg", buffer: metaJpeg }]);
    await page.waitForSelector(".composer-image", { timeout: 6000 });
    const jpegChip = await readChip();
    const jpegMarkers = jpegSegmentsBeforeSos(Buffer.from(jpegChip.b64, "base64")).map((s) => s.marker);
    check(
      "the JPEG strip keeps only structure: no COM, no APP1, no APP2",
      !jpegMarkers.includes(0xfe) && !jpegMarkers.includes(0xe1) && !jpegMarkers.includes(0xe2),
      JSON.stringify(jpegMarkers),
    );
    const jpegRaw = Buffer.from(jpegChip.b64, "base64");
    check(
      "the comment, the ICC tag and the XMP packet are gone from the bytes",
      !jpegRaw.includes("secret-comment-marker") &&
        !jpegRaw.includes("secret-xmp-packet") &&
        !jpegRaw.includes("ICC_PROFILE"),
      `${jpegRaw.length} bytes`,
    );
    check("the stripped JPEG still decodes", jpegChip.decodes === true, JSON.stringify(jpegChip.decodes));
    await page.locator(".composer-image-remove").click();
    await page.waitForFunction(() => document.querySelectorAll(".composer-image").length === 0, null, { timeout: 4000 });

    // Transparency keeps the PNG road, so this fixture exercises the PNG
    // strip and not the JPEG one.
    const metaPng = pngWithMetadata(
      makePng(32, 32, (x, y) => [30, 90 + x, 40 + y, x === 0 && y === 0 ? 128 : 255]),
    );
    const seededTypes = pngChunkTypes(metaPng);
    check(
      "the PNG fixture really carries iCCP and tIME",
      seededTypes.includes("iCCP") && seededTypes.includes("tIME"),
      JSON.stringify(seededTypes),
    );
    await clearImages();
    await attach([{ name: "meta.png", mimeType: "image/png", buffer: metaPng }]);
    await page.waitForSelector(".composer-image", { timeout: 6000 });
    const pngChip = await readChip();
    const keptTypes = pngChunkTypes(Buffer.from(pngChip.b64, "base64"));
    check(
      "the PNG strip keeps the picture and its colour, nothing else",
      keptTypes.every((type) => ["IHDR", "PLTE", "tRNS", "IDAT", "IEND", "sRGB", "gAMA", "cHRM"].includes(type)) &&
        keptTypes.includes("IHDR") &&
        keptTypes.includes("IDAT"),
      JSON.stringify(keptTypes),
    );
    check(
      "iCCP and tIME are gone",
      !keptTypes.includes("iCCP") && !keptTypes.includes("tIME"),
      JSON.stringify(keptTypes),
    );
    check("the stripped PNG still decodes", pngChip.decodes === true, JSON.stringify(pngChip.decodes));
    await page.locator(".composer-image-remove").click();
    await page.waitForFunction(() => document.querySelectorAll(".composer-image").length === 0, null, { timeout: 4000 });

    // 13. The wire budget: eight stored pictures of 1.4 MB each are ~15 MB
    //     of body as base64 — past the door's 16 MB only in a good mood. The
    //     send must pack the newest under the 12 MB budget and speak the
    //     placeholder for the oldest.
    state.vision = true;
    state.nctx = 65536;
    await wipeStorage();
    const WORDS = ["one", "two", "three", "four", "five", "six", "seven", "eight"];
    const seed = {
      id: "seed-conv",
      messages: WORDS.map((word, index) => ({
        id: `u${index}`,
        role: "user",
        content: `shot ${word}`,
        createdAt: 1000 + index,
        images: [{ id: `img${index}`, width: 100, height: 100, mime: "image/jpeg" }],
      })),
    };
    await page.evaluate(async ({ id, messages }) => {
      localStorage.setItem(
        "crescent-chat.index.v2",
        JSON.stringify([
          { id, title: "seeded shots", createdAt: 1, updatedAt: 9, preview: "shot eight", search: "seeded shots\nshot eight", hasMessages: true },
        ]),
      );
      localStorage.setItem(`crescent-chat.msgs.${id}.v2`, JSON.stringify(messages));
      await new Promise((resolve) => {
        const open = indexedDB.open("kalsa-chat.images", 1);
        open.onupgradeneeded = () => {
          const store = open.result.createObjectStore("images", { keyPath: "id" });
          store.createIndex("by-conversation", "convId", { unique: false });
        };
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("images", "readwrite");
          const store = tx.objectStore("images");
          for (let index = 0; index < 8; index += 1) {
            store.put({ id: `img${index}`, convId: id, mime: "image/jpeg", bytes: new Uint8Array(1_500_000).buffer });
          }
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
        open.onerror = () => resolve();
      });
    }, seed);
    await page.reload();
    await page.waitForTimeout(1200);
    await openChat();
    const seedDrawer = page.getByRole("button", { name: "Show conversations", exact: true });
    if (await seedDrawer.isVisible()) await seedDrawer.click();
    await page.locator(".sidebar").getByRole("button", { name: /seeded shots/i }).first().click();
    await page.waitForTimeout(600);
    await sendText("what did you see?");
    const packed = bodies.at(-1);
    const packedLength = bodyLengths.at(-1) ?? 0;
    check(
      "a body of many pictures stays under the wire budget",
      packedLength > 0 && packedLength <= 12 * 1024 * 1024,
      `${packedLength} bytes`,
    );
    check(
      "and it really packed pictures, not placeholders",
      packedLength > 11 * 1024 * 1024,
      `${packedLength} bytes`,
    );
    const packedUsers = (packed?.messages ?? []).filter((m) => m.role === "user");
    const asParts = packedUsers.filter((m) => Array.isArray(m.content));
    const asPlaceholder = packedUsers.filter(
      (m) => typeof m.content === "string" && m.content.includes("[an image the current AI cannot see]"),
    );
    check(
      "the six newest pictures ride as image parts",
      asParts.length === 6 &&
        asParts.every((m) =>
          m.content.some(
            (part) => part?.type === "image_url" && String(part?.image_url?.url).startsWith("data:image/jpeg;base64,"),
          ),
        ),
      JSON.stringify({ parts: asParts.length, of: packedUsers.length }),
    );
    check(
      "the two oldest became the placeholder text",
      asPlaceholder.length === 2 &&
        asPlaceholder.every((m) => /shot (one|two)\n\[an image/.test(m.content)),
      JSON.stringify(asPlaceholder.map((m) => m.content)),
    );

    // 14. A model switch closes the image road for the whole pending window:
    //     the old model's word does not outlive it.
    const picker = () =>
      page.evaluate(() => document.querySelector('.composer input[type="file"]')?.getAttribute("accept") ?? "");
    check(
      "the seeing picker offers pictures before the switch",
      (await picker()).includes(".png"),
      await picker(),
    );
    await page.evaluate(() => {
      window.__hangProps = true;
      window.__model = "switched";
    });
    const pendingBlind = await settles(
      () => !(document.querySelector('.composer input[type="file"]')?.getAttribute("accept") ?? "").includes(".png"),
      9000,
    );
    check(
      "while the new model's word is pending, no picture road shows",
      pendingBlind,
      await picker(),
    );
    await page.evaluate(() => {
      window.__hangProps = false;
      window.__model = "switched-again";
    });
    const seeingAgain = await settles(
      () => (document.querySelector('.composer input[type="file"]')?.getAttribute("accept") ?? "").includes(".png"),
      10000,
    );
    check("the road returns when the new model answers", seeingAgain, await picker());

    // 15. Video in the 1:1 chat: the fixture from the probe page, through
    //     the same compress road the Room uses, to the wire as FRAMES.
    await page.goto(`${origin}/.image-attach-probe/`);
    await page.waitForFunction(() => window.__FIXTURE__ !== undefined, null, { timeout: 10000 });
    const fixtureB64 = await page.evaluate(async () => String(await window.__FIXTURE__.build()));
    // Back to the app: the video phases attach against a fresh chat.
    await page.goto(`${origin}/`);
    await page.waitForTimeout(1200);
    await openChat();
    check(
      "the video fixture was built",
      typeof fixtureB64 === "string" && fixtureB64.length > 1000,
      String(fixtureB64?.length),
    );
    await attach([
      { name: "clip.mp4", mimeType: "video/mp4", buffer: Buffer.from(fixtureB64, "base64") },
    ]);
    await awaitVideoReady();
    check("the video chips in with its glyph", true);
    await sendText("watch this");
    const videoBody = bodies.at(-1);
    const videoParts = videoBody?.messages?.[1]?.content;
    const videoText = Array.isArray(videoParts) ? videoParts[0]?.text : null;
    const markerMatch = typeof videoText === "string" ? videoText.match(/\[video, (\d+) frames, 0:0\d\]/) : null;
    check(
      "the turn carries the video marker line",
      markerMatch !== null && videoText === "watch this\n" + markerMatch[0],
      JSON.stringify(videoText),
    );
    const frameParts = Array.isArray(videoParts)
      ? videoParts.filter((part) => part?.type === "image_url")
      : [];
    check(
      "the frames ride as image parts, as many as the marker says",
      frameParts.length === Number(markerMatch?.[1] ?? 0) &&
        frameParts.length >= 1 &&
        frameParts.every((part) => String(part.image_url.url).startsWith("data:image/jpeg;base64,")),
      JSON.stringify({ parts: frameParts.length, marker: markerMatch?.[1] }),
    );
    check(
      "no video bytes ride the wire",
      !JSON.stringify(videoBody ?? {}).includes("data:video"),
      "searched the whole body",
    );

    // 16. The budget: frames cost IMAGE_TOKENS each — a window that fits
    //     the words alone refuses the video.
    await wipeStorage();
    state.nctx = 700;
    await page.reload();
    await page.waitForTimeout(1200);
    await openChat();
    await attach([
      { name: "clip2.mp4", mimeType: "video/mp4", buffer: Buffer.from(fixtureB64, "base64") },
    ]);
    await page.waitForSelector(".refusal-banner", { timeout: 12000 }).catch(() => {});
    check(
      "a video is refused at a window only its frames' cost overflows",
      (await page.locator(".refusal-banner").count()) === 1,
    );
    state.nctx = 65536;
    await page.reload();
    await page.waitForTimeout(1200);
    await openChat();

    // 17. Replay: the sent video survives its own reload as a tile that
    //     opens the viewer.
    await attach([
      { name: "clip3.mp4", mimeType: "video/mp4", buffer: Buffer.from(fixtureB64, "base64") },
    ]);
    await awaitVideoReady();
    await sendText("keep this one");
    await reopenConversation(/keep this one/i);
    await page.waitForSelector(".user-video-tile", { timeout: 9000 }).catch(() => {});
    const tileImg = page.locator(".user-video-tile img");
    const posterPixels = (await tileImg.count()) > 0 ? await tileImg.evaluate((img) => img.naturalWidth) : 0;
    check(
      "the reloaded bubble shows the video tile, poster painted",
      posterPixels > 0,
      `naturalWidth=${posterPixels}`,
    );
    await page.locator(".user-video-tile").first().click();
    await page.waitForSelector(".media-viewer video", { timeout: 5000 });
    check("the tile opens the viewer, video and all", true);
    await page.locator(".media-viewer-close").click();
    await page.waitForFunction(() => document.querySelector(".media-viewer") === null, null, { timeout: 4000 });

    // 18. Blind: the same placeholder road as pictures.
    state.vision = false;
    await reopenConversation(/keep this one/i);
    await sendText("and now, blind");
    const blindVideo = bodies.at(-1);
    const blindAsked = (blindVideo?.messages ?? [])
      .filter((m) => m.role === "user")
      .map((m) => (Array.isArray(m.content) ? "parts" : m.content));
    check(
      "a blind model meets the video as the placeholder",
      blindAsked[0] === "keep this one one\n[an image the current AI cannot see]" ||
        blindAsked[0] === "keep this one\n[an image the current AI cannot see]" ||
        (typeof blindAsked[0] === "string" && blindAsked[0].endsWith("[an image the current AI cannot see]")),
      JSON.stringify(blindAsked),
    );
    const blindVideoBody = JSON.stringify(blindVideo ?? {});
    check(
      "nothing image- or video-shaped leaves for a blind model",
      !blindVideoBody.includes("image_url") && !blindVideoBody.includes("data:image") && !blindVideoBody.includes("data:video"),
      "searched the whole body",
    );
    state.vision = true;
    // The page still holds the blind answer; a model flip is the re-read.
    await page.evaluate(() => {
      window.__model = "video-cancel-walk";
    });
    await page.waitForFunction(
      () => (document.querySelector('.composer input[type="file"]')?.getAttribute("accept") ?? "").includes(".mp4"),
      null,
      { timeout: 9000 },
    );

    // 19. Cancel: the chip's × mid-work leaves quietly.
    await attach([
      { name: "gone.mp4", mimeType: "video/mp4", buffer: Buffer.from(fixtureB64, "base64") },
    ]);
    await page.waitForFunction(
      () => document.querySelectorAll(".composer-image").length >= 1,
      null,
      { timeout: 12000 },
    );
    cancelsPerformed += 1;
    await page.locator(".composer-image-remove").first().click();
    await page.waitForFunction(
      () => document.querySelectorAll(".composer-image").length === 0,
      null,
      { timeout: 6000 },
    );
    const earlyErrors = pageErrors.filter((line) => !line.includes("NotReadableError"));
    check("a canceled video chip leaves quietly", earlyErrors.length === 0, JSON.stringify(pageErrors));

    // 20. Cancel DURING compression: the chip is on screen while the work
    //     runs, its × cancels it, and nothing of it is stored.
    await page.goto(`${origin}/.image-attach-probe/`);
    await page.waitForFunction(() => window.__FIXTURE__ !== undefined, null, { timeout: 10000 });
    const slowB64 = await page.evaluate(async () => String(await window.__FIXTURE__.buildSlow()));
    await page.goto(`${origin}/`);
    await page.waitForTimeout(1200);
    await openChat();
    const idbCount = () =>
      page.evaluate(
        () =>
          new Promise((resolve) => {
            const open = indexedDB.open("kalsa-chat.images");
            open.onsuccess = () => {
              const db = open.result;
              const count = db.transaction("images", "readonly").objectStore("images").count();
              count.onsuccess = () => {
                db.close();
                resolve(count.result);
              };
            };
            open.onerror = () => resolve(-1);
          }),
      );
    const storedBefore = await idbCount();
    await attach([
      { name: "slow.mp4", mimeType: "video/mp4", buffer: Buffer.from(slowB64, "base64") },
    ]);
    const caughtCompressing = await page
      .waitForSelector(".composer-image-label", { timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    check(
      "the video chip is on screen while it compresses, saying so",
      caughtCompressing,
      "no .composer-image-label appeared",
    );
    if (caughtCompressing) {
      cancelsPerformed += 1;
      await page.locator(".composer-image-remove").first().click();
      await page.waitForFunction(
        () => document.querySelectorAll(".composer-image").length === 0,
        null,
        { timeout: 8000 },
      );
      await page.waitForTimeout(800);
      const storedAfter = await idbCount();
      check(
        "the × canceled the compression and stored nothing",
        storedAfter === storedBefore &&
          pageErrors.filter((line) => !line.includes("NotReadableError")).length === 0,
        JSON.stringify({ before: storedBefore, after: storedAfter }),
      );
    }

    // 21. A video-ONLY send: the chip leaves with the send, so no × can
    //     ever delete bytes a sent message references — and the message
    //     still replays after its reload.
    await attach([
      { name: "only.mp4", mimeType: "video/mp4", buffer: Buffer.from(fixtureB64, "base64") },
    ]);
    await awaitVideoReady();
    await page.locator(".composer textarea").fill("");
    await page.locator(".composer textarea").press("Enter");
    await page.waitForFunction(
      () => document.querySelectorAll(".composer-image").length === 0,
      null,
      { timeout: 9000 },
    ).catch(() => {});
    check(
      "a video-only send clears its chip — nothing left to ×",
      (await page.locator(".composer-image-remove").count()) === 0,
      String(await page.locator(".composer-image").count()),
    );
    await page.reload();
    await page.waitForTimeout(1200);
    await openChat();
    const reopenDrawer = page.getByRole("button", { name: "Show conversations", exact: true });
    if (await reopenDrawer.isVisible()) await reopenDrawer.click();
    await page.locator(".sidebar").getByRole("button", { name: /New conversation/i }).first().click();
    await page.waitForTimeout(900);
    await page.waitForSelector(".user-video-tile", { timeout: 9000 }).catch(() => {});
    check(
      "the sent video still replays after the × attempt's reload",
      (await page.locator(".user-video-tile").count()) === 1,
      String(await page.locator(".user-video-tile").count()),
    );

    check(
      "no content-security refusal touched the page",
      !consoleLines.some((line) => line.includes("Content Security Policy")),
      JSON.stringify(consoleLines.filter((line) => line.includes("Content Security Policy")).slice(0, 2)),
    );
    check(
      "no file name and no image bytes reached the console",
      !consoleLines.some((line) => line.includes("gps-photo") || line.includes("tiny.png") || line.includes("data:image")),
      JSON.stringify(consoleLines.slice(0, 3)),
    );
    const cancelArtifacts = pageErrors.filter((line) => line.includes("NotReadableError")).length;
    const hardErrors = pageErrors.filter((line) => !line.includes("NotReadableError"));
    check(
      "the page ran clean",
      hardErrors.length === 0 && cancelArtifacts <= cancelsPerformed,
      JSON.stringify({ hardErrors, cancelArtifacts, cancelsPerformed }),
    );
  } finally {
    await browser.close();
  }
}

await rm(outDir, { recursive: true, force: true });
let server = null;
try {
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
    response.writeHead(200, {
      "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
      "Content-Security-Policy": csp,
    });
    response.end(readFileSync(file));
  });
  await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const engines = process.argv.slice(2).length > 0 ? process.argv.slice(2) : Object.keys(ENGINES);
  for (const engineName of engines) {
    await probeEngine(engineName, origin);
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
