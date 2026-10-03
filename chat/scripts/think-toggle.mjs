// The composer's Think toggle: the state must be visible (aria-pressed and the
// accent chip treatment the AI page's presets use) and the word must fit — the
// button used to be a 32 px circle clipped to "Thi" with no on/off styling at
// all. Checked in both themes and at a narrow window.
//
// Run: node scripts/think-toggle.mjs   (from chat/)

import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { build } from "vite";

const CHAT_DIR = fileURLToPath(new URL("..", import.meta.url));
const outDir = join(CHAT_DIR, ".think-toggle-dist");

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

  /** The button's computed colors and its fit, plus the theme's tokens. */
  async function readToggle(page) {
    return page.evaluate(() => {
      const button = document.querySelector(".composer-thinking");
      if (!button) return null;
      const probe = document.createElement("span");
      document.body.append(probe);
      const token = (name) => {
        probe.style.color = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return getComputedStyle(probe).color;
      };
      const colors = {
        off: token("--surface-muted"),
        on: token("--accent"),
        ink: token("--accent-ink"),
      };
      probe.remove();
      const style = getComputedStyle(button);
      return {
        pressed: button.getAttribute("aria-pressed"),
        text: button.textContent,
        clipped: button.scrollWidth > button.clientWidth + 1,
        background: style.backgroundColor,
        color: style.color,
        colors,
      };
    });
  }

  async function run(theme, viewport) {
    const page = await browser.newPage({ viewport });
    await page.addInitScript((chosenTheme) => {
      localStorage.clear();
      localStorage.setItem("crescent-chat.theme.v1", chosenTheme);
      window.__TAURI__ = {
        core: {
          invoke: async (command) => {
            if (command === "brain_state") return { kind: "running", endpoint: "http://127.0.0.1:18099/v1", model: "m" };
            if (command === "brain_host_credential") return "t";
            if (command === "brain_capability") return { kind: "unmeasured", chosen: true };
            if (command === "brain_previous_session_crashed") return false;
            if (command === "brain_log_event") return null;
            throw new Error(`stub missing ${command}`);
          },
        },
        event: { listen: () => Promise.resolve(() => {}) },
      };
    }, theme);
    // The template must read the thinking switch, or the control is not offered.
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
    await page.route("**/v1/chat/completions", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: `data: ${JSON.stringify({ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] })}\n\n` +
          "data: [DONE]\n\n",
      }),
    );
    await page.goto(`${origin}/`);
    await page.waitForTimeout(1000);
    const chip = page.locator(".brain-bar-chat");
    if ((await chip.count()) > 0) await chip.first().click();
    try {
      await page.locator(".composer-thinking").waitFor({ timeout: 8000 });
    } catch {
      check(`${theme}/${viewport.width}px: the toggle is offered`, false, "never appeared");
      await page.close();
      return;
    }
    const label = `${theme}/${viewport.width}px`;
    // A click parks the pointer where the chip was; at a narrow width that can
    // be the toggle itself, and :hover would answer for the state under test.
    await page.mouse.move(2, 2);
    const on = await readToggle(page);
    check(`${label}: the word fits whole`, on.clipped === false && on.text === "Think", JSON.stringify(on));
    check(`${label}: on at rest is pressed`, on.pressed === "true", JSON.stringify(on));
    check(
      `${label}: on wears the accent`,
      on.background === on.colors.on && on.color === on.colors.ink,
      JSON.stringify({ background: on.background, on: on.colors.on, ink: on.colors.ink, color: on.color }),
    );
    await page.locator(".composer-thinking").click();
    await page.mouse.move(2, 2);
    const off = await readToggle(page);
    check(`${label}: a press turns it off`, off.pressed === "false", JSON.stringify(off));
    check(
      `${label}: off is quiet`,
      off.background === off.colors.off && off.background !== on.background,
      JSON.stringify({ off: off.background, muted: off.colors.off, wasOn: on.background }),
    );
    check(`${label}: still the whole word when off`, off.clipped === false && off.text === "Think", JSON.stringify(off));
    await page.close();
  }

  for (const theme of ["light", "dark"]) {
    await run(theme, { width: 1100, height: 800 });
    await run(theme, { width: 380, height: 720 });
  }

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
