// The window's contract: WHICH `/props` field is the per-slot size, which
// four look-alikes are not it, and that an unknown answer is never an
// answer — the cache and the panel's refresh guard must both heal by asking
// again instead of freezing the unknown until a settings save.
//
// Pure by construction: `parseContextSize` takes already-parsed JSON and
// `ensureContextSize` takes the fetch as an injected `ask`, so every case
// below runs with no server, no socket and no network — the real module is
// compiled by `lib/app-bundle.mjs`, never copied (a JavaScript copy would
// test the copy).
//
// The React half — App.tsx wiring `hasContextSize` into the refresh effect
// and `ensureContextSize` into `ensureCtx` — cannot run here; `npx tsc
// --noEmit` covers the compile and reading the diff covers the rest, the
// same split `slot-hold.mjs` declares.
//
// Red first: this harness was run against `contextSize.ts` written exactly
// as the old code behaved (top-level read, memoized null, endpoint-only
// guard) and failed 11 checks; the module was then corrected to the
// contract and it went green — 28 passed.
//
// Run: node scripts/context-size.mjs

import { rm } from "node:fs/promises";
import { loadApp } from "./lib/app-bundle.mjs";

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const { app, dir } = await loadApp();
try {
  const { parseContextSize, ensureContextSize, rememberContextSize, hasContextSize } = app;
  const EP = "http://127.0.0.1:8130";

  // The contract's own shape: /props → default_generation_settings.n_ctx,
  // already per slot (the engine divides ctx-size by parallel), with
  // total_slots sitting in the same reply and being the wrong number.
  {
    const props = {
      default_generation_settings: { params: { temperature: 0.8 }, n_ctx: 4096 },
      total_slots: 4,
      model_alias: "m",
      chat_template: "{% for message in messages %}{{ message['content'] }}{% endfor %}",
    };
    check("the contract's shape → the number", parseContextSize(props) === 4096, String(parseContextSize(props)));
    check("total_slots in the same reply is not read", parseContextSize({ ...props, total_slots: 64 }) === 4096);
    check(
      "total_slots alone is not a fallback",
      parseContextSize({ default_generation_settings: { params: {} }, total_slots: 4 }) === null,
    );
    check("a fractional n_ctx is floored, not rounded up", parseContextSize({ default_generation_settings: { n_ctx: 4096.7 } }) === 4096);
  }

  // Missing and non-numeric: anything that is not a positive finite number
  // at the contract's path means UNKNOWN — never an invented limit.
  {
    check("no default_generation_settings → null", parseContextSize({ total_slots: 4 }) === null);
    check("settings without n_ctx → null", parseContextSize({ default_generation_settings: { params: {} } }) === null);
    check("n_ctx as a numeric string → null", parseContextSize({ default_generation_settings: { n_ctx: "4096" } }) === null);
    check("n_ctx NaN → null", parseContextSize({ default_generation_settings: { n_ctx: Number.NaN } }) === null);
    check("n_ctx Infinity → null", parseContextSize({ default_generation_settings: { n_ctx: Number.POSITIVE_INFINITY } }) === null);
    check("n_ctx negative → null", parseContextSize({ default_generation_settings: { n_ctx: -4096 } }) === null);
    check("a non-object body → null", parseContextSize(null) === null && parseContextSize("n_ctx") === null);
  }

  // The decoys, each a body that carries an n_ctx somewhere and must still
  // parse to null — the wrong path is not a smaller answer, it is no answer.
  {
    check(
      "decoy 1: a top-level n_ctx alone → null (that is the old defect's read)",
      parseContextSize({ n_ctx: 8192 }) === null,
      String(parseContextSize({ n_ctx: 8192 })),
    );
    check(
      "decoy 1b: top-level n_ctx beside empty settings → null",
      parseContextSize({ n_ctx: 8192, default_generation_settings: { params: {} } }) === null,
    );
    check(
      "decoy 2: /models' meta.n_ctx → null (data[].meta, server-context.cpp:4889)",
      parseContextSize({ data: [{ meta: { n_ctx: 8192 } }] }) === null,
    );
    check(
      "decoy 3: a GET /slots slot JSON → null (server-context.cpp:696; the door refuses that route anyway)",
      parseContextSize([{ id: 0, n_ctx: 8192, is_processing: false }]) === null,
    );
    check(
      "decoy 3b: an EXCEED_CONTEXT_SIZE reply's top-level n_ctx → null (server-task.cpp:1505)",
      parseContextSize({ error: { code: 2, message: "EXCEED_CONTEXT_SIZE" }, n_prompt_tokens: 9000, n_ctx: 8192 }) === null,
    );
    check(
      "decoy 4: the router's n_ctx: 0 at the RIGHT path → null (server-models.cpp:1936)",
      parseContextSize({ default_generation_settings: { params: {}, n_ctx: 0 } }) === null,
      String(parseContextSize({ default_generation_settings: { params: {}, n_ctx: 0 } })),
    );
  }

  // The healing: an unknown answer leaves no entry, so the next ask goes
  // back to the server; a number is stored and the asking stops; a late
  // unknown arriving after a number erases nothing.
  {
    const cache = new Map();
    let asks = 0;
    const answers = [null, 4096];
    const ask = async () => {
      asks++;
      return answers.shift() ?? null;
    };

    const first = await ensureContextSize(cache, EP, ask);
    check("first ask: the engine's unknown comes back as null", first === null, String(first));
    check("the unknown stored NO entry — the cache does not memoize it", !cache.has(EP), JSON.stringify([...cache]));
    check("so the window asks AGAIN instead of replaying the unknown", asks === 1, "precondition");

    const second = await ensureContextSize(cache, EP, ask);
    check("second ask reaches the server (asks=2), not a frozen null", asks === 2 && second === 4096, `asks=${asks} nctx=${second}`);
    check("the number is remembered", cache.get(EP) === 4096, String(cache.get(EP)));

    const third = await ensureContextSize(cache, EP, ask);
    check("a known number is served from cache without asking (asks stays 2)", asks === 2 && third === 4096, `asks=${asks}`);

    // The write side's declared invariant: a late unknown after a known
    // number must not un-know it — an unknown changes nothing, ever.
    const writes = new Map();
    rememberContextSize(writes, EP, 4096);
    rememberContextSize(writes, EP, null);
    check("a late null does not erase a known number", writes.get(EP) === 4096, String(writes.get(EP)));

    // The panel's own half of the same rule: what the refresh effect reads.
    check("the guard: no answer yet → not settled, ask", hasContextSize(null, EP) === false);
    check("the guard: another endpoint → not settled", hasContextSize({ endpoint: "other", nctx: 4096 }, EP) === false);
    check(
      "the guard: a stored UNKNOWN is not settled — this is the line that lets the panel heal",
      hasContextSize({ endpoint: EP, nctx: null }, EP) === false,
      String(hasContextSize({ endpoint: EP, nctx: null }, EP)),
    );
    check("the guard: a number for this endpoint → settled", hasContextSize({ endpoint: EP, nctx: 4096 }, EP) === true);
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? "context-size: all checks passed" : `context-size: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
