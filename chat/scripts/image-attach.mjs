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
import { rm } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { chromium, webkit } from "@playwright/test";
import { build } from "vite";

const ENGINES = { chromium, webkit };
const CHAT_DIR = fileURLToPath(new URL("..", import.meta.url));
const outDir = join(CHAT_DIR, ".image-attach-dist");

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
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    page.on("console", (message) => consoleLines.push(message.text()));
    await page.addInitScript(() => {
      window.__logEvents = [];
      window.__TAURI__ = {
        core: {
          invoke: async (command, args) => {
            if (command === "brain_state")
              return { kind: "running", endpoint: "http://127.0.0.1:18099/v1", model: "m" };
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
    await page.route("**/props", (route) =>
      route.fulfill({
        json: {
          default_generation_settings: { n_ctx: state.nctx },
          modalities: { vision: state.vision, audio: false, video: false },
          chat_template: "",
        },
      }),
    );
    const bodies = [];
    await page.route("**/v1/chat/completions", async (route) => {
      try {
        bodies.push(JSON.parse(route.request().postData() ?? "{}"));
      } catch {
        bodies.push(null);
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
    check(
      "the user bubble shows the thumbnail",
      (await page.locator(".user-bubble img").count()) === 1,
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
    await page.evaluate(() => {
      localStorage.clear();
      return Promise.all(
        window.indexedDB
          ? [new Promise((resolve) => {
              const req = indexedDB.deleteDatabase("kalsa-chat.images");
              req.onsuccess = req.onerror = req.onblocked = () => resolve();
            })]
          : [],
      );
    });
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
    check(
      "no file name and no image bytes reached the console",
      !consoleLines.some((line) => line.includes("gps-photo") || line.includes("tiny.png") || line.includes("data:image")),
      JSON.stringify(consoleLines.slice(0, 3)),
    );
    check("the page ran clean", pageErrors.length === 0, JSON.stringify(pageErrors));
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
    await probeEngine(engineName, origin);
  }
} finally {
  if (server) server.close();
  await rm(outDir, { recursive: true, force: true });
}

if (fail > 0) {
  console.log(`\n${fail} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
