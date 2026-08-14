/**
 * Harness for src/engine/toolCallParser.ts (BUG1, V4.2 bench — Qwen3.5-2B,
 * thinking budget256, compaction ON: raw <tool_call> XML-ish markup leaked
 * into the chat bubble instead of being parsed / executed as a tool call).
 *
 * Feeds the exact leaked string from the CI log (plus a JSON-body variant, a
 * malformed one, and a normal text reply) through:
 *  (a) parseFallbackToolCall — extraction of {name, arguments}
 *  (b) createToolCallDeltaStripper — streaming, delta-aware markup removal
 *  (c) stripToolCallTagsFinal — final (whole-text) markup removal
 * Asserts: markup never appears in visible text, name/query extracted
 * correctly, malformed input never throws.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

function compile() {
  const r = spawnSync(
    "npx",
    [
      "tsc",
      "src/engine/toolCallParser.ts",
      "--outDir",
      "scripts/.build",
      "--module",
      "nodenext",
      "--target",
      "es2020",
      "--moduleResolution",
      "nodenext",
      "--skipLibCheck",
      "--ignoreConfig",
    ],
    { cwd: projectRoot, encoding: "utf8", shell: true },
  );
  if (r.status !== 0) {
    console.error("tsc failed:\n", r.stdout, r.stderr);
    process.exit(1);
  }
}

function resolveBuilt() {
  const candidates = [
    path.join(projectRoot, "scripts/.build/toolCallParser.js"),
    path.join(projectRoot, "scripts/.build/engine/toolCallParser.js"),
    path.join(projectRoot, "scripts/.build/src/engine/toolCallParser.js"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  console.error("Could not find compiled toolCallParser.js. Tried:\n", candidates.join("\n"));
  process.exit(1);
}

/** Feed `raw` through the streaming stripper in N-char chunks (worst case for split tags). */
function streamThroughStripper(createStripper, raw, chunkSize) {
  const strip = createStripper();
  let out = "";
  for (let i = 0; i < raw.length; i += chunkSize) {
    out += strip(raw.slice(i, i + chunkSize));
  }
  return out;
}

async function main() {
  console.log("Compiling toolCallParser.ts …");
  compile();
  const modPath = resolveBuilt();
  console.log("Loading", modPath);
  const mod = await import(`${pathToFileURL(modPath).href}?t=${Date.now()}`);
  const { parseFallbackToolCall, parseFallbackToolCalls, createToolCallDeltaStripper, stripToolCallTagsFinal, TOOL_CALL_OPEN, TOOL_CALL_CLOSE, LFM_TOOL_CALL_START, LFM_TOOL_CALL_END } = mod;

  const results = [];
  const check = (label, cond, detail) => {
    results.push({ label, pass: Boolean(cond), detail });
  };

  // ── Fixture 1: exact leaked string from the CI log ─────────────────────
  const LEAKED =
    "\n\n<tool_call>\n<function=web_search>\n<parameter=query>\nGatto Leopoldo Budget 4500 prodotto\n</parameter>\n</function>\n</tool_call>";

  let parsed1;
  let threw1 = false;
  try {
    parsed1 = parseFallbackToolCall(LEAKED);
  } catch {
    threw1 = true;
  }
  check("F1 parse: does not throw", !threw1);
  check(
    "F1 parse: name === web_search",
    parsed1 && parsed1.name === "web_search",
    JSON.stringify(parsed1),
  );
  check(
    "F1 parse: query extracted correctly",
    parsed1 && parsed1.arguments && parsed1.arguments.query === "Gatto Leopoldo Budget 4500 prodotto",
    JSON.stringify(parsed1),
  );

  // Streaming strip, delivered in 3-char chunks (forces split tags every few chars).
  const streamed1 = streamThroughStripper(createToolCallDeltaStripper, LEAKED, 3);
  check(
    "F1 stream-strip: no <tool_call> markup leaks (chunked)",
    !streamed1.includes(TOOL_CALL_OPEN) && !streamed1.includes(TOOL_CALL_CLOSE) && !streamed1.includes("<function=") && !streamed1.includes("<parameter="),
    JSON.stringify(streamed1),
  );
  check("F1 stream-strip: visible text is empty", streamed1.trim() === "", JSON.stringify(streamed1));

  // Whole-string delivery too (single chunk).
  const streamed1Whole = streamThroughStripper(createToolCallDeltaStripper, LEAKED, LEAKED.length);
  check(
    "F1 stream-strip (single chunk): no markup leaks",
    !streamed1Whole.includes(TOOL_CALL_OPEN),
    JSON.stringify(streamed1Whole),
  );

  const final1 = stripToolCallTagsFinal(LEAKED);
  check(
    "F1 final-strip: no <tool_call> markup leaks",
    !final1.includes(TOOL_CALL_OPEN) && !final1.includes(TOOL_CALL_CLOSE),
    JSON.stringify(final1),
  );

  // ── Fixture 2: JSON-body variant ────────────────────────────────────────
  const JSON_VARIANT =
    '<tool_call>{"name":"web_search","arguments":{"query":"Gatto Leopoldo Budget 4500 prodotto","numResults":4}}</tool_call>';
  let parsed2;
  let threw2 = false;
  try {
    parsed2 = parseFallbackToolCall(JSON_VARIANT);
  } catch {
    threw2 = true;
  }
  check("F2 parse: does not throw", !threw2);
  check("F2 parse: name === web_search", parsed2 && parsed2.name === "web_search", JSON.stringify(parsed2));
  check(
    "F2 parse: query extracted correctly",
    parsed2 && parsed2.arguments && parsed2.arguments.query === "Gatto Leopoldo Budget 4500 prodotto",
    JSON.stringify(parsed2),
  );
  check("F2 parse: numResults extracted correctly", parsed2 && parsed2.arguments && parsed2.arguments.numResults === 4);

  const streamed2 = streamThroughStripper(createToolCallDeltaStripper, JSON_VARIANT, 5);
  check("F2 stream-strip: no markup leaks", streamed2.trim() === "" , JSON.stringify(streamed2));

  // ── Fixture 3: malformed markup (unterminated + garbled) ────────────────
  const MALFORMED_UNTERMINATED = "\n\nSure, let me check that.\n\n<tool_call>\n<function=web_sea";
  let parsed3;
  let threw3 = false;
  try {
    parsed3 = parseFallbackToolCall(MALFORMED_UNTERMINATED);
  } catch {
    threw3 = true;
  }
  check("F3a malformed (unterminated, cut mid-tag): does not throw", !threw3);
  check("F3a malformed: no crash, returns null or a best-effort object", parsed3 === null || typeof parsed3 === "object");

  const streamed3 = streamThroughStripper(createToolCallDeltaStripper, MALFORMED_UNTERMINATED, 4);
  check(
    "F3a stream-strip: visible text keeps prose, drops open tag/tail",
    streamed3.startsWith("\n\nSure, let me check that.") && !streamed3.includes(TOOL_CALL_OPEN),
    JSON.stringify(streamed3),
  );

  const final3 = stripToolCallTagsFinal(MALFORMED_UNTERMINATED);
  check(
    "F3a final-strip: trailing unterminated block removed",
    final3 === "\n\nSure, let me check that.\n\n",
    JSON.stringify(final3),
  );

  const MALFORMED_GARBLED = "<tool_call>{not json, not xml either <function without closing";
  let parsed4;
  let threw4 = false;
  try {
    parsed4 = parseFallbackToolCall(MALFORMED_GARBLED);
  } catch {
    threw4 = true;
  }
  check("F3b malformed (garbled body): does not throw", !threw4);
  check("F3b malformed (garbled body): returns null (falls through)", parsed4 === null, JSON.stringify(parsed4));

  const MALFORMED_EMPTY_INPUTS = [null, undefined, "", 123, {}, []];
  let anyThrew = false;
  for (const bad of MALFORMED_EMPTY_INPUTS) {
    try {
      parseFallbackToolCall(bad);
    } catch {
      anyThrew = true;
    }
  }
  check("F3c malformed (null/undefined/empty/non-string inputs): never throws", !anyThrew);

  // ── Fixture 4: normal text reply (no tool call at all) — must pass through untouched ──
  const NORMAL_REPLY =
    "Certo! Il tuo gatto Leopoldo ha un budget di 4500 euro con scadenza il 14 marzo, colore blu associato al progetto.";
  let parsed5;
  let threw5 = false;
  try {
    parsed5 = parseFallbackToolCall(NORMAL_REPLY);
  } catch {
    threw5 = true;
  }
  check("F4 normal reply: does not throw", !threw5);
  check("F4 normal reply: parseFallbackToolCall returns null (no <tool_call> present)", parsed5 === null);

  const streamed5 = streamThroughStripper(createToolCallDeltaStripper, NORMAL_REPLY, 7);
  check("F4 normal reply: stream-strip is a no-op (text unchanged)", streamed5 === NORMAL_REPLY, JSON.stringify(streamed5));

  const final5 = stripToolCallTagsFinal(NORMAL_REPLY);
  check("F4 normal reply: final-strip is a no-op (text unchanged)", final5 === NORMAL_REPLY, JSON.stringify(final5));

  // ── Fixture 5: tool_call block with leading/trailing literal text (not just isolated) ──
  const MIXED = "Here is what I found:\n<tool_call><function=web_search><parameter=query>test query here</parameter></function></tool_call>\nDone.";
  const streamed6 = streamThroughStripper(createToolCallDeltaStripper, MIXED, 6);
  check(
    "F5 mixed content: markup stripped, surrounding prose kept",
    streamed6 === "Here is what I found:\n\nDone." && !streamed6.includes(TOOL_CALL_OPEN),
    JSON.stringify(streamed6),
  );

  // ── Fixture 6: LFM2.5 Python-call dialect (real upstream chat-template form) ──
  // The old parser assumed JSON; the real template emits `func_name(arg=val)`.
  // These cases cover every robustness bullet from the spec.

  // 6a: comma inside a string value
  {
    const RAW = `${LFM_TOOL_CALL_START}[web_search(query="Roma, Italia")]${LFM_TOOL_CALL_END}`;
    const calls = parseFallbackToolCalls(RAW);
    check(
      "F6a LFM2.5: comma inside string value",
      calls.length === 1 && calls[0].name === "web_search" && calls[0].arguments.query === "Roma, Italia",
      JSON.stringify(calls),
    );
  }
  // 6b: closing paren inside a string
  {
    const RAW = `${LFM_TOOL_CALL_START}[web_search(query="smile :)")]${LFM_TOOL_CALL_END}`;
    const calls = parseFallbackToolCalls(RAW);
    check(
      "F6b LFM2.5: closing paren inside string",
      calls.length === 1 && calls[0].name === "web_search" && calls[0].arguments.query === "smile :)",
      JSON.stringify(calls),
    );
  }
  // 6c: escaped quote inside a string
  {
    const RAW = `${LFM_TOOL_CALL_START}[web_search(query="dice \\"ciao\\"")]${LFM_TOOL_CALL_END}`;
    const calls = parseFallbackToolCalls(RAW);
    check(
      "F6c LFM2.5: escaped quote inside string",
      calls.length === 1 && calls[0].name === "web_search" && calls[0].arguments.query === 'dice "ciao"',
      JSON.stringify(calls),
    );
  }
  // 6d: two calls in one payload
  {
    const RAW = `${LFM_TOOL_CALL_START}[web_search(query="a"), web_fetch(url="b")]${LFM_TOOL_CALL_END}`;
    const calls = parseFallbackToolCalls(RAW);
    check(
      "F6d LFM2.5: two calls in one payload",
      calls.length === 2 &&
        calls[0].name === "web_search" && calls[0].arguments.query === "a" &&
        calls[1].name === "web_fetch" && calls[1].arguments.url === "b",
      JSON.stringify(calls),
    );
  }
  // 6e: JSON object value (complex type — format_arg_value JSON-serialises it)
  {
    const RAW = `${LFM_TOOL_CALL_START}[foo(opts={"k": [1,2]})]${LFM_TOOL_CALL_END}`;
    const calls = parseFallbackToolCalls(RAW);
    const opts = calls[0] && calls[0].arguments && calls[0].arguments.opts;
    check(
      "F6e LFM2.5: JSON object value",
      calls.length === 1 && calls[0].name === "foo" &&
        opts && typeof opts === "object" && !Array.isArray(opts) &&
        Array.isArray(opts.k) && opts.k.length === 2 && opts.k[0] === 1 && opts.k[1] === 2,
      JSON.stringify(calls),
    );
  }
  // 6f: no arguments
  {
    const RAW = `${LFM_TOOL_CALL_START}[get_time()]${LFM_TOOL_CALL_END}`;
    const calls = parseFallbackToolCalls(RAW);
    check(
      "F6f LFM2.5: no arguments",
      calls.length === 1 && calls[0].name === "get_time" &&
        calls[0].arguments && Object.keys(calls[0].arguments).length === 0,
      JSON.stringify(calls),
    );
  }
  // 6g: unknown/garbage payload → [] never a throw, never a partial bogus call
  {
    let threw = false;
    let calls;
    try { calls = parseFallbackToolCalls(`${LFM_TOOL_CALL_START}[???]${LFM_TOOL_CALL_END}`); }
    catch { threw = true; }
    check(
      "F6g LFM2.5: garbage payload → [] (never throws, never partial)",
      !threw && Array.isArray(calls) && calls.length === 0,
      JSON.stringify(calls),
    );
  }
  // 6h: JSON-array form still parses (no regression)
  {
    const RAW = `${LFM_TOOL_CALL_START}[{"name":"web_search","arguments":{"query":"cats"}}]${LFM_TOOL_CALL_END}`;
    const calls = parseFallbackToolCalls(RAW);
    check(
      "F6h LFM2.5: JSON-array form still parses (no regression)",
      calls.length === 1 && calls[0].name === "web_search" && calls[0].arguments.query === "cats",
      JSON.stringify(calls),
    );
  }
  // 6i: Qwen dialect unaffected
  {
    const QWEN = '<tool_call>\n<function=web_search>\n<parameter=query>Qwen untouched\n</parameter>\n</function>\n</tool_call>'
    const parsed = parseFallbackToolCall(QWEN);
    check(
      "F6i Qwen dialect unaffected by LFM2.5 Python-call parser",
      parsed && parsed.name === "web_search" && parsed.arguments.query === "Qwen untouched",
      JSON.stringify(parsed),
    );
  }
  // ── Report ───────────────────────────────────────────────────────────────
  console.log("\n=== Results ===");
  let allPass = true;
  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.label}${r.pass ? "" : `  — ${r.detail}`}`);
    if (!r.pass) allPass = false;
  }

  console.log(`\n=== OVERALL: ${allPass ? "PASS" : "FAIL"} ===`);
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
