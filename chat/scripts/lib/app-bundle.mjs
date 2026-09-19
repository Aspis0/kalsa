// Shared plumbing for the two sampling scripts: compile the app's own
// TypeScript, and refuse to skip when no server answers.
//
// Both the round trip (do the knobs arrive?) and the behaviour test (do they
// change what the model writes?) must exercise the real `samplingWire`,
// `completionBody` and `completionsUrl`. A JavaScript re-implementation of
// those functions would test the re-implementation. This module is the one
// place that compiles the app's modules with esbuild, and the one place that
// turns a dead endpoint into a loud failure with the command that fixes it.

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "../../node_modules/esbuild/lib/main.js";

const CHAT_DIR = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPTS_DIR = fileURLToPath(new URL("..", import.meta.url));

/// Compiles the real TypeScript and re-exports the functions under test. A
/// virtual entry (esbuild `stdin`) keeps this to one file: nothing is copied
/// into JavaScript, and nothing new is written beside the app. The caller owns
/// the returned temp directory and must remove it.
export async function loadApp() {
  const dir = await mkdtemp(join(tmpdir(), "kalsa-app-bundle-"));
  const outfile = join(dir, "app.mjs");
  await build({
    stdin: {
      contents: `
        export { samplingWire } from "../src/lib/sampling.ts";
        export { completionBody, completionsUrl } from "../src/lib/chat.ts";
        export { SAMPLING_KNOBS } from "../src/lib/knobs/sampling.ts";
        export { accumulate, readArguments, MAX_ARGUMENTS } from "../src/lib/toolCalls.ts";
        export { publicHttpUrl } from "../src/lib/publicUrl.ts";
        export { streamChatCompletion } from "../src/lib/toolLoop.ts";
        export { offeredTools, executeToolCall } from "../src/lib/tools/registry.ts";
        export { createToolMarkupStripper } from "../src/lib/toolMarkup.ts";
      `,
      resolveDir: SCRIPTS_DIR,
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    outfile,
    nodePaths: [join(CHAT_DIR, "node_modules")],
    loader: { ".css": "empty" },
    logLevel: "silent",
  });
  const app = await import(`${pathToFileURL(outfile).href}?cache=${Date.now()}`);
  return { dir, app };
}

/// The exact command that would put a server behind this endpoint, so a failed
/// health check is actionable instead of a silent skip.
export function startCommand(endpoint) {
  const url = new URL(endpoint);
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  return [
    `"$HOME/Library/Application Support/kalsa-brain/runtime/builds/metal/llama-b10950/llama-server"`,
    "--host 127.0.0.1",
    `--port ${port}`,
    `--model "$HOME/Library/Application Support/kalsa-brain/runtime/models/Trinity-Nano-Preview-Q4_K_M.gguf"`,
    "--n-gpu-layers all",
    "--flash-attn on",
    "--cache-type-k q8_0",
    "--cache-type-v q8_0",
    "--ctx-size 4096",
    "--no-webui",
  ].join(" ");
}

/// Never skips silently: a test that passes because it did nothing is worse
/// than no test.
export async function requireServer(endpoint) {
  try {
    const response = await fetch(new URL("/health", endpoint), {
      signal: AbortSignal.timeout(5_000),
    });
    if (response.ok) return;
  } catch {
    // fall through to the loud failure
  }
  console.error(`No llama-server answers /health at ${endpoint}.`);
  console.error("Start one, then run this again:");
  console.error(`  ${startCommand(endpoint)}`);
  process.exit(1);
}
