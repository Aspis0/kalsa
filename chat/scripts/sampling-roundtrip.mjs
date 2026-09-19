// The sampling wire round trip: the app's own TypeScript builds the request,
// a real llama-server answers, and the server says what it actually used.
//
// `llama-server` silently ignores a field name it does not know — no error,
// no warning. A typo in `chat/src/lib/knobs/sampling.ts` would therefore be a
// knob that turns for ever and does nothing, and no unit test of ours can see
// it, because our unit tests only prove our own JSON contains our own names.
// The proof is this round trip: `"verbose": true` makes the server echo the
// EFFECTIVE parameters in `__verbose.generation_settings`, and this script
// compares all 26 of them — by name, with a float32 tolerance.
//
// The real `samplingWire`, `completionBody` and `completionsUrl` are compiled
// with esbuild and exercised, never a JavaScript copy of them. `verbose` is
// added to a copy here, in the test only: the echoed `__verbose` carries the
// user's prompt back, so the app must never send it.
//
// The app streams, and the echo does not ride in the same place in both
// shapes, so both are checked: `stream: false` puts it at the top level of
// the JSON, `stream: true` puts it in the LAST SSE data chunk before `[DONE]`.
//
// Run against a live server:
//   cd chat && node scripts/sampling-roundtrip.mjs
// Point it elsewhere with KALSA_ENDPOINT (default http://127.0.0.1:8138).

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "../node_modules/esbuild/lib/main.js";

const CHAT_DIR = fileURLToPath(new URL("..", import.meta.url));
const SCRIPTS_DIR = fileURLToPath(new URL(".", import.meta.url));
const ENDPOINT = process.env.KALSA_ENDPOINT ?? "http://127.0.0.1:8138";
/// The server returns float32, so 0.77 comes back 0.7699999809265137. An
/// absolute band this wide is still far under any real transformation.
const TOLERANCE = 1e-4;
const REQUEST_TIMEOUT = 60_000;

// One distinctive value per knob, each inside the row's own min/max in
// `knobs/sampling.ts` and a whole number where the row says integer — checked
// against the real table below, never assumed. Two traps: `dry_base` stays
// >= 1 (below it the server substitutes its default) and `max_tokens` stays
// tiny so a run is fast.
const VALUES = {
  temperature: 0.77,
  dynatemp_range: 0.42,
  dynatemp_exponent: 1.23,
  top_k: 37,
  top_p: 0.83,
  min_p: 0.07,
  typical_p: 0.91,
  top_n_sigma: 1.5,
  xtc_probability: 0.33,
  xtc_threshold: 0.21,
  min_keep: 7,
  repeat_penalty: 1.13,
  repeat_last_n: 53,
  frequency_penalty: 0.29,
  presence_penalty: -0.37,
  dry_multiplier: 0.61,
  dry_base: 1.31,
  dry_allowed_length: 3,
  dry_penalty_last_n: 71,
  mirostat: 2,
  mirostat_tau: 4.7,
  mirostat_eta: 0.13,
  adaptive_target: 0.62,
  adaptive_decay: 0.88,
  seed: 12345,
  max_tokens: 4,
};

/// Compiles the real TypeScript and re-exports the three functions under test.
/// A virtual entry (esbuild `stdin`) keeps this to one file: nothing is copied
/// into JavaScript, and nothing new is written beside the app.
async function loadApp() {
  const dir = await mkdtemp(join(tmpdir(), "kalsa-sampling-roundtrip-"));
  const outfile = join(dir, "app.mjs");
  await build({
    stdin: {
      contents: `
        export { samplingWire } from "../src/lib/sampling.ts";
        export { completionBody, completionsUrl } from "../src/lib/chat.ts";
        export { SAMPLING_KNOBS } from "../src/lib/knobs/sampling.ts";
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

/// A missing or wrong table entry is a product problem, not a test crash, so it
/// is collected and reported with the request results rather than thrown here.
/// Keeping the round trip running is the point: the server's own answer is the
/// evidence that the wire name did not arrive.
function tableProblems(app) {
  const problems = [];
  const byWire = new Map(app.SAMPLING_KNOBS.map((knob) => [knob.wire, knob]));
  for (const [wire, value] of Object.entries(VALUES)) {
    const knob = byWire.get(wire);
    if (!knob) {
      problems.push(`table: no knob named "${wire}" — the app cannot send it`);
      continue;
    }
    if (knob.kind === "integer" && !Number.isInteger(value)) {
      problems.push(`table: "${wire}" is an integer knob; this test sends ${value}`);
    }
    if (value < knob.min || value > knob.max) {
      problems.push(`table: "${wire}" = ${value} is outside the row's ${knob.min}..${knob.max}`);
    }
  }
  for (const knob of app.SAMPLING_KNOBS) {
    if (!(knob.wire in VALUES)) {
      problems.push(`table: this test has no value for the knob "${knob.wire}"`);
    }
  }
  return problems;
}

/// Every knob the server did not use as sent, named — not just the first.
function compare(settings) {
  if (!settings || typeof settings !== "object") {
    return ["no __verbose.generation_settings in the response"];
  }
  const problems = [];
  for (const [wire, sent] of Object.entries(VALUES)) {
    const got = settings[wire];
    if (typeof got !== "number") {
      problems.push(`knob ${wire}: sent ${sent}, server used ${JSON.stringify(got ?? null)}`);
    } else if (Math.abs(got - sent) > TOLERANCE) {
      problems.push(`knob ${wire}: sent ${sent}, server used ${got}`);
    }
  }
  return problems;
}

async function askJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  });
  if (!response.ok) {
    throw new Error(`the non-stream request answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  const json = await response.json();
  return json.__verbose?.generation_settings ?? null;
}

async function askStream(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  });
  if (!response.ok) {
    throw new Error(`the stream request answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  return lastSseData(await response.text())?.__verbose?.generation_settings ?? null;
}

/// The raw response text, for the one check that must look at what the server
/// actually sent rather than at what it was asked for.
async function askRaw(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  });
  if (!response.ok) {
    throw new Error(`the request answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  return response.text();
}

/// Every SSE data payload before `[DONE]`, so a check can look at all of them
/// and not only the last.
function ssePayloads(text) {
  const payloads = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (payload === "" || payload === "[DONE]") continue;
    payloads.push(JSON.parse(payload));
  }
  return payloads;
}

/// The last SSE data payload before `[DONE]`: that is where the measured echo
/// rides, not the first chunk.
function lastSseData(text) {
  return ssePayloads(text).at(-1) ?? null;
}

/// The exact command that would put a server behind this endpoint, so a failed
/// health check is actionable instead of a silent skip.
function startCommand() {
  const url = new URL(ENDPOINT);
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
async function requireServer() {
  try {
    const response = await fetch(new URL("/health", ENDPOINT), {
      signal: AbortSignal.timeout(5_000),
    });
    if (response.ok) return;
  } catch {
    // fall through to the loud failure
  }
  console.error(`No llama-server answers /health at ${ENDPOINT}.`);
  console.error("Start one, then run this again:");
  console.error(`  ${startCommand()}`);
  process.exit(1);
}

const timeout = setTimeout(() => {
  console.error("sampling round trip timed out");
  process.exit(2);
}, REQUEST_TIMEOUT + 30_000);

try {
  await requireServer();
  const { dir, app } = await loadApp();
  try {
    const problems = tableProblems(app);
    const wire = app.samplingWire({ ...VALUES });
    const messages = [{ role: "user", content: "Reply with the single word OK." }];
    const body = app.completionBody("kalsa-roundtrip", messages, wire);
    const url = app.completionsUrl(ENDPOINT);

    // The privacy property, proven end to end. `body` is the app's own body,
    // untouched — no `verbose`. Asserting that the body has no `verbose` key
    // proves nothing: `samplingWire` emits only the table's names, so the key
    // is absent by construction and the assertion can never fail. The proof is
    // the server's answer: without `verbose` it must not echo the prompt back
    // in `__verbose`. Both shapes are one tiny request each, so both are
    // checked.
    const appBody = body;
    const plainResponse = JSON.parse(await askRaw(url, { ...appBody, stream: false }));
    if (Object.hasOwn(plainResponse, "__verbose")) {
      problems.push(
        "the app's own request made the server echo the prompt back (non-stream): the response contains __verbose",
      );
    }
    const streamedPayloads = ssePayloads(await askRaw(url, appBody));
    if (streamedPayloads.some((payload) => Object.hasOwn(payload, "__verbose"))) {
      problems.push(
        "the app's own request made the server echo the prompt back (stream): the response contains __verbose",
      );
    }

    // The verbose-enabled copies, so the server still proves all 26 names.
    for (const problem of compare(await askJson(url, { ...body, stream: false, verbose: true }))) {
      problems.push(`non-stream: ${problem}`);
    }
    for (const problem of compare(await askStream(url, { ...body, verbose: true }))) {
      problems.push(`stream: ${problem}`);
    }

    if (problems.length > 0) {
      console.log("SAMPLING ROUND TRIP FAILURES:");
      for (const problem of problems) console.log(`  - ${problem}`);
      process.exitCode = 1;
    } else {
      const count = Object.keys(VALUES).length;
      console.log(`ok: ${count}/${count} knobs reached the model, stream and non-stream`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
} catch (error) {
  console.error(error.stack ?? error);
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
}
