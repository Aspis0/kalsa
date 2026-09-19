// The accumulator for streamed tool calls, fed the fragment sequences that a
// real server produces and the ones it produces when something is wrong.
// Pure: no server, no browser, no network.
//
// Run: node scripts/tool-calls.mjs   (from chat/)

import { rm } from "node:fs/promises";
import { loadApp } from "./lib/app-bundle.mjs";

const { dir, app } = await loadApp();
const { accumulate, readArguments, MAX_ARGUMENTS } = app;

let fail = 0;
function check(label, condition, detail) {
  const ok = condition ? "ok  " : "FAIL";
  if (!condition) fail++;
  console.log(`${ok} ${label}${condition || detail === undefined ? "" : `\n     ${detail}`}`);
}
function equal(label, actual, expected) {
  check(label, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}\n     want ${JSON.stringify(expected)}`);
}
/** A call as the accumulator returns it, so expectations stay readable. */
function call(index, id, name, args, cut = false) {
  return { index, id, name, arguments: args, cut };
}

// A single call, arguments in one chunk: the easy case.
equal(
  "one chunk carries the whole call",
  accumulate([], [{ index: 0, id: "a1", function: { name: "web_search", arguments: '{"query":"x"}' } }]),
  [call(0, "a1", "web_search", '{"query":"x"}')],
);

// Arguments split across chunks, name and id only on the first.
const split = [
  [{ index: 0, id: "b2", function: { name: "web_fetch", arguments: '{"url":' } }],
  [{ index: 0, function: { arguments: '"https://exa' } }],
  [{ index: 0, function: { arguments: 'mple.com/page"}' } }],
];
let calls = [];
for (const delta of split) calls = accumulate(calls, delta);
equal("arguments are concatenated in arrival order", calls, [
  call(0, "b2", "web_fetch", '{"url":"https://example.com/page"}'),
]);

// Two calls interleaved by index, as a parallel-calling server sends them.
calls = [];
calls = accumulate(calls, [
  { index: 0, id: "c0", function: { name: "web_search", arguments: '{"query":' } },
  { index: 1, id: "c1", function: { name: "web_fetch", arguments: '{"url":' } },
]);
calls = accumulate(calls, [{ index: 1, function: { arguments: '"https://b"' } }]);
calls = accumulate(calls, [{ index: 0, function: { arguments: '"a"}' } }]);
calls = accumulate(calls, [{ index: 1, function: { arguments: "}" } }]);
equal("interleaved calls are kept apart by index", calls, [
  call(0, "c0", "web_search", '{"query":"a"}'),
  call(1, "c1", "web_fetch", '{"url":"https://b"}'),
]);

// A call the server never named: it still needs an id to answer.
equal(
  "a call with no id gets one",
  accumulate([], [{ index: 0, function: { name: "web_search", arguments: "{}" } }]),
  [call(0, "call-0", "web_search", "{}")],
);
equal(
  "the second unnamed call gets its own id",
  accumulate([], [
    { index: 0, function: { name: "web_search", arguments: "{}" } },
    { index: 1, function: { name: "web_fetch", arguments: "{}" } },
  ]),
  [call(0, "call-0", "web_search", "{}"), call(1, "call-1", "web_fetch", "{}")],
);

// Nothing to fold: the same array comes back, untouched.
const before = [call(0, "d1", "web_search", '{"query":"q"}')];
check("an empty delta returns the same array", accumulate(before, undefined) === before);
check("a non-array delta returns the same array", accumulate(before, "nonsense") === before);
check("the input array is never mutated", before[0].name === "web_search" && before.length === 1);

// Arguments that arrive empty: a call that takes none.
calls = accumulate([], [{ index: 0, id: "e1", function: { name: "web_search" } }]);
equal("missing arguments stay empty", calls, [call(0, "e1", "web_search", "")]);
equal("empty arguments parse to none", readArguments(calls[0].name, calls[0].arguments), { args: {}, problem: null });

// Malformed JSON at the end is a tool error, not a thrown exception.
const broken = accumulate([], [{ index: 0, id: "f1", function: { name: "web_fetch", arguments: '{"url": ' } }]);
const brokenRead = readArguments(broken[0].name, broken[0].arguments);
check("malformed JSON does not throw", brokenRead.problem !== null, JSON.stringify(brokenRead));
check("the refusal names the tool", (brokenRead.problem ?? "").includes("web_fetch"), brokenRead.problem ?? "");
equal("a refusal runs the tool with no arguments", brokenRead.args, {});

// JSON that is valid but not an object cannot be a tool's arguments either.
check("an array is not an argument object", readArguments("web_search", "[1,2]").problem !== null);
check("a bare string is not an argument object", readArguments("web_search", '"x"').problem !== null);
check("a real object parses", readArguments("web_search", '{"query":"q"}').problem === null);

// --- placement: an index that cannot be placed must not be guessed (finding 11)

check("non-object fragments are skipped", accumulate([], [null, 7, "x"]).length === 0);
check("an absurd index is ignored", accumulate([], [{ index: 1e9, function: { name: "web_search" } }]).length === 0);
check(
  "a fractional index is ignored",
  accumulate([], [{ index: 0.5, function: { name: "web_search", arguments: "{}" } }]).length === 0,
);
// This used to be asserted the other way round: a negative index folded its
// arguments into the real call at zero, which is one tool receiving another's
// arguments. It must be dropped, and call zero must be left alone.
const real = accumulate([], [{ index: 0, id: "g1", function: { name: "web_search", arguments: '{"query":"real"}' } }]);
const corrupted = accumulate(real, [{ index: -1, function: { name: "web_fetch", arguments: '{"url":"https://evil"}' } }]);
equal("a negative index is dropped and the real call is untouched", corrupted, [
  call(0, "g1", "web_search", '{"query":"real"}'),
]);
check(
  "a missing index is dropped, not folded into call zero",
  accumulate(real, [{ id: "x", function: { name: "web_fetch", arguments: '{"url":"https://evil"}' } }])[0]
    .arguments === '{"query":"real"}',
  JSON.stringify(accumulate(real, [{ id: "x", function: { name: "web_fetch", arguments: '{"url":"https://evil"}' } }])),
);
// Sparse: index 2 is one call, not three with two empty phantoms in front.
const sparse = accumulate([], [{ index: 2, id: "h2", function: { name: "web_search", arguments: "{}" } }]);
equal("a sparse index creates no phantom calls", sparse, [call(2, "h2", "web_search", "{}")]);

// --- ids: unique, or the transcript loses a run (finding 12)

const reused = accumulate([], [
  { index: 0, id: "same", function: { name: "web_search", arguments: "{}" } },
  { index: 1, id: "same", function: { name: "web_fetch", arguments: "{}" } },
]);
check("a reused id is made unique", reused[0].id !== reused[1].id, JSON.stringify(reused.map((c) => c.id)));
const clash = accumulate([], [
  { index: 0, function: { name: "web_search", arguments: "{}" } },
  { index: 1, id: "call-0", function: { name: "web_fetch", arguments: "{}" } },
]);
check("a real id cannot collide with a synthetic one", new Set(clash.map((c) => c.id)).size === 2, JSON.stringify(clash.map((c) => c.id)));

// --- a call the stream never named (finding 13): kept, but unnamed.
const named = accumulate([], [{ index: 0, id: "i1", function: { arguments: "{}" } }]);
equal("a fragment with no name leaves the call unnamed", named, [call(0, "i1", "", "{}")]);

// --- the argument cap (finding 14)

const flood = accumulate([], [{ index: 0, id: "j1", function: { name: "web_search", arguments: '{"query":"' + "x".repeat(5000) + '"}' } }]);
check("arguments are cut at the cap", flood[0].arguments.length === MAX_ARGUMENTS, String(flood[0].arguments.length));
check("a cut call is marked", flood[0].cut === true);
const floodRead = readArguments(flood[0].name, flood[0].arguments, flood[0].cut);
check("a cut call fails honestly instead of parsing half a sentence", (floodRead.problem ?? "").includes("longer than this app accepts"), floodRead.problem ?? "");
equal("and it runs with no arguments", floodRead.args, {});
// The cap holds across many small fragments too.
let long = [];
for (let i = 0; i < 300; i += 1) long = accumulate(long, [{ index: 0, function: { arguments: "y".repeat(100) } }]);
check("the cap holds across many chunks", long[0].arguments.length <= MAX_ARGUMENTS && long[0].cut === true, `${long[0].arguments.length}`);

await rm(dir, { recursive: true, force: true });
console.log(fail ? `\n${fail} failed` : "\nall tool-call fragment cases passed");
process.exit(fail ? 1 : 0);
