// The sampling behaviour test: the app's own TypeScript builds the request,
// and the model's own text is what gets compared.
//
// `sampling-roundtrip.mjs` proves the 26 knobs REACH the model: the server
// echoes them back. It cannot prove they DO anything. A parameter can arrive
// intact and still be inert — an ignored field, a value the server clamps to
// its default, a knob whose whole effect is invisible at short lengths. The
// only evidence that a knob steers generation is the generated text itself.
//
// So every relation below is between two replies, never against a constant
// hash and never against a fixed string: the test must pass on any model, any
// seed and any day. The load-bearing knobs are temperature 0 versus 1.4, three
// seeds, top_k 1 as the greedy override, and max_tokens as the length cut.
// `temperature 0` twice, and every high-temperature seed twice, must be
// identical; a changed seed or a raised temperature must change the text;
// `top_k 1` must collapse the text back to the greedy one for every seed; and
// `max_tokens 8` must report 8 completion tokens, cut the greedy reply strictly
// shorter, and keep the short text a prefix of the greedy one.
//
// Do NOT "simplify" the temperature comparison into one greedy reply reused
// against high temperature at other seeds. That compares two variables at
// once, temperature AND seed, so a misspelled `temperature` wire name passes
// it: llama-server drops unknown fields silently, every request then runs at
// the server default (1.0 here), and three seeds at 1.0 differ from each other
// with the temperature knob entirely dead. So the temperature-0 reply is taken
// once PER SEED (`greedyBySeed`) and each high-temperature reply is compared
// with the temperature-0 reply at the SAME seed. Its converse is checked too:
// temperature 0 ignores the seed, so all of `greedyBySeed` must be identical —
// a second, independent detector of the same dead knob.
//
// The same trap has a second shape, on the seed knob, and it is why each seed
// is sampled TWICE (`hotPairs`). llama-server's default seed is random PER
// REQUEST (4294967295), so a dropped `seed` wire would still give three
// mutually distinct texts — "the seeds differ" would pass with the knob dead.
// What cannot pass is reproduction: two draws for one seed come back different.
// `seed reproduces` guards the dead wire, `seed bites` guards a constant one,
// and both read the same pairs.
//
// The `text arrives` check is not a knob test and must not be deleted as
// pointless: every equality below passes for free on two empty strings, so one
// non-empty result per reply is what makes the other checks mean anything. The
// model is a thinking model: the text usually arrives in
// `message.reasoning_content` with `message.content` as the empty string, so
// the reply is read wherever it landed. And high temperature can coincide with
// the greedy text by luck, so the two "must differ" properties sample three
// seeds and only require one of them to differ — a single coincidence is not a
// dead knob. Both `verbose` and a user-visible echo are absent here by
// construction: the app's body is sent untouched. The whole run is thirteen
// requests of at most 60 tokens.
// Run against a live server: `cd chat && node scripts/sampling-behaviour.mjs`.
// Point it elsewhere with KALSA_ENDPOINT (default http://127.0.0.1:8138).

import { rm } from "node:fs/promises";
import { loadApp, requireServer } from "./lib/app-bundle.mjs";

const ENDPOINT = process.env.KALSA_ENDPOINT ?? "http://127.0.0.1:8138";
const REQUEST_TIMEOUT = 60_000;

const MODEL = "kalsa-behaviour";
const MESSAGES = [{ role: "user", content: "Write one sentence about the sea." }];
const FULL = 60;
const SHORT = 8;
const HOT = 1.4;
/// The seeds the "must differ" properties sample, so one lucky collision does
/// not read as a dead knob.
const SEEDS = [1, 2, 3];
/// The two seeds that must both collapse onto the greedy text under top_k 1.
const TOP_K_SEEDS = [1, 7];

/// The reply text, wherever this model put it. A thinking model returns
/// `reasoning_content` and leaves `content` as the empty string; an empty
/// string never wins, so a server emitting both keys cannot silence one.
function replyText(message) {
  if (typeof message.content === "string" && message.content !== "") return message.content;
  if (typeof message.reasoning_content === "string" && message.reasoning_content !== "") {
    return message.reasoning_content;
  }
  return "";
}

/// One reply to one set of knobs. The body is the app's own — `samplingWire`,
/// then `completionBody` — with `stream` turned off so the non-stream response
/// carries `usage`. No `verbose`: the app never sends it, and it echoes the
/// user's prompt back. `label` only names this reply in a failure message.
async function ask(app, url, label, sampling) {
  const body = {
    ...app.completionBody(MODEL, MESSAGES, app.samplingWire(sampling)),
    stream: false,
  };
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  });
  if (!response.ok) {
    throw new Error(`the request answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  const json = await response.json();
  return {
    label,
    text: replyText(json.choices?.[0]?.message ?? {}),
    completionTokens: json.usage?.completion_tokens ?? null,
  };
}

const timeout = setTimeout(() => {
  console.error("sampling behaviour test timed out");
  process.exit(2);
}, REQUEST_TIMEOUT + 60_000);

try {
  await requireServer(ENDPOINT);
  const { dir, app } = await loadApp();
  try {
    const url = app.completionsUrl(ENDPOINT);

    // Every reply the run takes, so the emptiness guard can name the blank ones
    // instead of quietly trusting them.
    const taken = [];
    const sample = async (label, sampling) => {
      const reply = await ask(app, url, label, sampling);
      taken.push(reply);
      return reply;
    };

    const greedyBySeed = [];
    for (const seed of SEEDS) {
      greedyBySeed.push(await sample(`temperature 0, seed ${seed}`, { temperature: 0, seed, max_tokens: FULL }));
    }
    const greedy = greedyBySeed[0];
    const greedyAgain = await sample("temperature 0, seed 1, again", { temperature: 0, seed: 1, max_tokens: FULL });
    // Two draws per seed at high temperature: the pair is what proves the seed
    // was honoured, the per-seed texts are what prove it changed anything.
    const hotPairs = [];
    for (const seed of SEEDS) {
      const first = await sample(`temperature ${HOT}, seed ${seed}`, { temperature: HOT, seed, max_tokens: FULL });
      const second = await sample(`temperature ${HOT}, seed ${seed}, again`, { temperature: HOT, seed, max_tokens: FULL });
      hotPairs.push([first, second]);
    }
    const topKBySeed = [];
    for (const seed of TOP_K_SEEDS) {
      const sampling = { temperature: HOT, seed, top_k: 1, max_tokens: FULL };
      topKBySeed.push(await sample(`top_k 1, temperature ${HOT}, seed ${seed}`, sampling));
    }
    const short = await sample(`max_tokens ${SHORT}, temperature 0, seed 1`, { temperature: 0, seed: 1, max_tokens: SHORT });

    // Every failure is collected and printed, never thrown at the first one.
    const checks = [];
    const check = (name, problems, detail) => checks.push({ name, problems, detail });

    // Not a knob test, and deliberately so: it is the guard that stops every
    // equality below it from passing on two empty strings.
    const empty = taken.filter((reply) => reply.text === "").map((reply) => reply.label);
    check(
      "text arrives",
      empty.length > 0 ? [`no text came back in content or reasoning_content for: ${empty.join(", ")}`] : [],
      `${taken.length} replies, every one non-empty`,
    );

    check(
      "determinism",
      greedy.text === greedyAgain.text ? [] : ["temperature 0 with seed 1 gave two different texts"],
      "temperature 0, seed 1, twice: identical",
    );

    const unrepeatable = SEEDS.filter((_, index) => hotPairs[index][0].text !== hotPairs[index][1].text);
    check(
      "seed reproduces",
      unrepeatable.map(
        (seed) => `temperature ${HOT} with seed ${seed} gave two different texts: either the seed is dead or this model is unstable`,
      ),
      `temperature ${HOT}, seeds ${SEEDS.join(", ")}, twice each: identical per seed`,
    );

    const differing = SEEDS.filter((_, index) => hotPairs[index][0].text !== greedyBySeed[index].text);
    check(
      "temperature bites",
      differing.length > 0
        ? []
        : [`temperature ${HOT} produced the greedy text for every seed tried (${SEEDS.join(", ")}): either the knob is dead or this model is degenerate`],
      `temperature ${HOT} differs from temperature 0 for seed(s) ${differing.join(", ")}`,
    );

    const greedyDistinct = new Set(greedyBySeed.map((reply) => reply.text)).size;
    check(
      "temperature 0 ignores the seed",
      greedyDistinct === 1
        ? []
        : [`temperature 0 returned ${greedyDistinct} distinct texts across seeds ${SEEDS.join(", ")}; either the seed leaks through or this model is unstable`],
      `temperature 0 across seeds ${SEEDS.join(", ")}: one text`,
    );

    const distinct = new Set(hotPairs.map(([first]) => first.text)).size;
    check(
      "seed bites",
      distinct > 1
        ? []
        : [`temperature ${HOT} produced the same text for every seed tried (${SEEDS.join(", ")}): either the seed is dead or this model is degenerate`],
      `seeds ${SEEDS.join(", ")} at temperature ${HOT} gave ${distinct} distinct texts`,
    );

    const topKProblems = [];
    for (const [index, seed] of TOP_K_SEEDS.entries()) {
      if (topKBySeed[index].text !== greedy.text) {
        topKProblems.push(`temperature ${HOT} with top_k 1 and seed ${seed} did not reproduce the greedy text`);
      }
    }
    check(
      "top_k bites",
      topKProblems,
      `top_k 1 at temperature ${HOT} reproduced the greedy text for seeds ${TOP_K_SEEDS.join(", ")}`,
    );

    const maxTokenProblems = [];
    if (short.completionTokens !== SHORT) {
      maxTokenProblems.push(`max_tokens ${SHORT} reported usage.completion_tokens ${JSON.stringify(short.completionTokens)}`);
    }
    if (!greedy.text.startsWith(short.text)) {
      maxTokenProblems.push(`the max_tokens ${SHORT} reply is not a prefix of the ${FULL}-token temperature-0 reply`);
    }
    if (short.text.length >= greedy.text.length) {
      maxTokenProblems.push(
        `the max_tokens ${SHORT} reply is not strictly shorter than the ${FULL}-token temperature-0 reply: ${short.text.length} characters against ${greedy.text.length}`,
      );
    }
    check(
      "max_tokens bites",
      maxTokenProblems,
      `max_tokens ${SHORT} used ${short.completionTokens} tokens and cut the greedy reply strictly shorter`,
    );

    const problems = checks.flatMap(({ name, problems: found }) => found.map((problem) => `${name}: ${problem}`));
    if (problems.length > 0) {
      console.log("SAMPLING BEHAVIOUR FAILURES:");
      for (const problem of problems) console.log(`  - ${problem}`);
      process.exitCode = 1;
    } else {
      for (const { name, detail } of checks) console.log(`ok: ${name} — ${detail}`);
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
