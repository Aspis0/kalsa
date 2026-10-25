// The composer's control row: it stays inside the input's box, at every width
// and with the browser chip armed.
//
// The owner's desktop test of 21 October: the block of controls under the input
// — "Allega un file", "Ragiona", the "Naviga per me" chip (longer when armed),
// the disclaimer and "Invia" — had words that were too big and spilled out of
// the input's own box.
//
// This drives the real app in a real browser and measures what is on screen:
// the row's own width against the box's, every control's edges against the
// box's, the size of the type, and the height the row takes. The chip is armed
// on the same page, so the state that made the row longer is measured too.
//
// Run: node scripts/composer-row.mjs   (from chat/)

import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { build } from "vite";

const CHAT_DIR = fileURLToPath(new URL("..", import.meta.url));
const outDir = join(CHAT_DIR, ".composer-row-dist");

let fail = 0;
function check(label, condition, detail) {
  const ok = condition ? "ok  " : "FAIL";
  if (!condition) fail++;
  console.log(`${ok} ${label}${condition || detail === undefined ? "" : `\n     ${detail}`}`);
}

await rm(outDir, { recursive: true, force: true });
let server = null;
let browser = null;
try {
  await mkdir(outDir, { recursive: true });
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

  browser = await chromium.launch({ args: ["--no-sandbox"] });

  /** What the row and its box look like right now, measured on the page. */
  async function read(page) {
    return page.evaluate(() => {
      const box = document.querySelector(".composer-box");
      const row = document.querySelector(".composer-row");
      if (!box || !row) return null;
      const bb = box.getBoundingClientRect();
      const rb = row.getBoundingClientRect();
      const kids = Array.from(row.children).map((el) => {
        const r = el.getBoundingClientRect();
        return {
          cls: String(el.className),
          text: (el.textContent ?? "").trim().slice(0, 60),
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
        };
      });
      const note = document.querySelector(".composer-note");
      const pill = document.querySelector(".composer-pill");
      const chip = document.querySelector(".composer-browser");
      return {
        box: { left: bb.left, right: bb.right, width: bb.width, clientWidth: box.clientWidth },
        row: {
          left: rb.left,
          right: rb.right,
          height: rb.height,
          clientWidth: row.clientWidth,
          scrollWidth: row.scrollWidth,
        },
        kids,
        note: note
          ? {
              text: (note.textContent ?? "").trim(),
              title: note.getAttribute("title"),
              height: note.getBoundingClientRect().height,
              scrollHeight: note.scrollHeight,
              clientWidth: note.clientWidth,
              scrollWidth: note.scrollWidth,
            }
          : null,
        pill: pill
          ? {
              fontSize: getComputedStyle(pill).fontSize,
              height: pill.getBoundingClientRect().height,
            }
          : null,
        chip: chip
          ? { text: (chip.textContent ?? "").trim(), pressed: chip.getAttribute("aria-pressed") }
          : null,
      };
    });
  }

  async function run(width, strict) {
    const page = await browser.newPage({ viewport: { width, height: 860 } });
    await page.addInitScript(() => {
      localStorage.clear();
      window.__TAURI__ = {
        core: {
          invoke: async (command) => {
            if (command === "brain_state") {
              return { kind: "running", endpoint: "http://127.0.0.1:18099/v1", model: "m" };
            }
            if (command === "brain_host_credential") return "t";
            if (command === "brain_capability") {
              return { kind: "unmeasured", chosen: true, chosen_model: "Liquid LFM 2.5" };
            }
            if (command === "brain_previous_session_crashed") return false;
            if (command === "brain_log_event") return null;
            // **The driver is there**, so the browser chip is drawn and can be armed.
            if (command === "brain_browser_driver_status") {
              return { supported: true, installed: true, size: 42 };
            }
            throw new Error(`stub missing ${command}`);
          },
        },
        event: { listen: () => Promise.resolve(() => {}) },
      };
    });
    await page.route("**/props", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          chat_template: "{% if enable_thinking %}{{ 'yes' }}{% endif %}",
          default_generation_settings: { n_ctx: 4096, params: {} },
        }),
      }),
    );
    await page.route("**/kalsa/chat/**", (route) => route.fulfill({ status: 204, body: "" }));
    await page.goto(`${origin}/`);
    await page.waitForTimeout(1000);
    const chat = page.locator('.rail-item[data-surface="chat"]');
    if ((await chat.count()) > 0) await chat.first().click();
    try {
      await page.locator(".composer-row").waitFor({ timeout: 8000 });
    } catch {
      check(`${width}px: the composer is on screen`, false, "never appeared");
      await page.close();
      return;
    }
    // The chip is there because the driver is: without it there is nothing to arm.
    await page.locator(".composer-browser").waitFor({ timeout: 8000 });

    const off = await read(page);
    check(`${width}px: the row is on screen`, off !== null);
    if (off === null) {
      await page.close();
      return;
    }

    // **Nothing leaves the box.** The row's own content must fit its own width,
    // and no control may stick out of the box that holds it.
    check(
      `${width}px: the row does not spill out of the box`,
      off.row.scrollWidth <= off.row.clientWidth + 1,
      `row scrollWidth ${off.row.scrollWidth} > clientWidth ${off.row.clientWidth}`,
    );
    const outside = off.kids.filter(
      (kid) => kid.left < off.box.left - 1 || kid.right > off.box.right + 1,
    );
    check(
      `${width}px: no control sticks out of the box`,
      outside.length === 0,
      JSON.stringify(outside),
    );
    // **The words are not oversized.** A 46px pill at 16px was the complaint.
    check(
      `${width}px: the controls are sized for the row`,
      off.pill !== null && parseFloat(off.pill.fontSize) <= 15 && off.pill.height <= 40,
      JSON.stringify(off.pill),
    );
    // **The disclaimer is clamped, not free to grow the block.**
    check(
      `${width}px: the disclaimer stays two lines`,
      off.note !== null && off.note.height <= 36,
      JSON.stringify(off.note),
    );
    // **And its words stay inside it.** Crushed to a sliver, the sentence used
    // to be printed wider than the sliver and spill out of the input's box.
    check(
      `${width}px: the disclaimer's words stay inside it`,
      off.note !== null && off.note.scrollWidth <= off.note.clientWidth + 1,
      `note scrollWidth ${off.note?.scrollWidth} > clientWidth ${off.note?.clientWidth}`,
    );
    check(
      `${width}px: the whole sentence is still in the title`,
      off.note !== null && typeof off.note.title === "string" && off.note.title.length > 0,
      JSON.stringify(off.note === null ? null : off.note.title),
    );
    // **The block is a row, not a slab.** The app's own window cannot be
    // narrower than 720px (src-tauri/tauri.conf.json), and there the row is
    // two lines at most: the controls on one, the disclaimer on the next.
    check(
      `${width}px: the block of controls stays a block`,
      !strict || off.row.height <= 90,
      `row height ${off.row.height}`,
    );

    // The armed state: the chip's suffix made the row longer before.
    await page.locator(".composer-browser").click();
    await page.mouse.move(2, 2);
    await page.waitForTimeout(120);
    const on = await read(page);
    check(`${width}px: the chip is armed`, on !== null && on.chip.pressed === "true", JSON.stringify(on?.chip));
    check(
      `${width}px: the armed row does not grow`,
      on !== null && on.row.height <= off.row.height,
      `armed ${on?.row.height} vs ${off.row.height}`,
    );
    check(
      `${width}px: the armed chip says the same thing`,
      on !== null && on.chip.text === off.chip.text,
      `"${on?.chip.text}" vs "${off.chip.text}"`,
    );
    check(
      `${width}px: the armed row does not spill out of the box`,
      on !== null && on.row.scrollWidth <= on.row.clientWidth + 1,
      `row scrollWidth ${on?.row.scrollWidth} > clientWidth ${on?.row.clientWidth}`,
    );
    const outsideOn = (on?.kids ?? []).filter(
      (kid) => kid.left < on.box.left - 1 || kid.right > on.box.right + 1,
    );
    check(
      `${width}px: no armed control sticks out of the box`,
      outsideOn.length === 0,
      JSON.stringify(outsideOn),
    );
    await page.close();
  }

  // The widths the app can be at, and then one narrower than its own minimum
  // window: the row must not spill there either, but it is allowed to be
  // taller there.
  for (const width of [1600, 1400, 1200, 1000, 900, 720]) {
    await run(width, true);
  }
  await run(560, false);
} finally {
  if (browser) await browser.close();
  if (server) server.close();
  await rm(outDir, { recursive: true, force: true });
}

if (fail > 0) {
  console.log(`\n${fail} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
