/**
 * Harness for src/engine/memoryFactsTail.ts (P1-1 format B).
 *
 * Facts must ride the last user message, stay sanitized, and keep the
 * untrusted-data framing. No llama.rn / React.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const outDir = path.join(projectRoot, "scripts/.build/memoryFactsTailHarness");

function compile() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const r = spawnSync(
    "npx",
    [
      "tsc",
      "src/engine/memoryFactsTail.ts",
      "src/engine/personaTail.ts",
      "src/i18n/en.ts",
      "src/i18n/it.ts",
      "--outDir",
      outDir,
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
    path.join(outDir, "memoryFactsTail.js"),
    path.join(outDir, "engine/memoryFactsTail.js"),
    path.join(outDir, "src/engine/memoryFactsTail.js"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  console.error("Could not find compiled memoryFactsTail.js. Tried:\n", candidates.join("\n"));
  process.exit(1);
}

/**
 * MemoryFact is an object ({ id, text, createdAt }), not a string. This harness
 * passed bare strings and every call died inside boundMemoryFacts on
 * `fact.text.replace` — 11 red assertions that said nothing about the code.
 */
/**
 * `matched` now carries ONE entry per previous user turn: the real bake, or an
 * identity tail ({bare === prefixed}) meaning "this turn has no bake, it is
 * itself". Counting the array therefore counts turns, not matches — and these
 * tests mean matches. What actually matters is whether the assembled text was
 * touched, which identity tails never do (applyBakedUserTails skips them).
 */
function realMatches(result) {
  return result.matched.filter((tail) => tail.bare !== tail.prefixed).length;
}

const DAY_MS = 86_400_000;
/** Facts one day apart, oldest first — the order MemoryStore.list returns. */
function mkFacts(...texts) {
  const base = Date.UTC(2026, 0, 1);
  return texts.map((text, i) => ({
    id: `f${i + 1}`,
    text,
    createdAt: base + i * DAY_MS,
  }));
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  console.log("Compiling memoryFactsTail.ts …");
  compile();
  const modPath = resolveBuilt();
  console.log("Loading", modPath);
  const {
    buildMemoryFactsBlock,
    applyMemoryFactsToLastUser,
    applyBakedUserTails,
    commitBakedLastUser,
    lastUserContent,
    parseBakedUserTails,
    bakeTextContent,
    bakeRematchKey,
    keepStillValidBakedTails,
    MAX_BAKED_USER_TAILS,
  } = await import(pathToFileURL(modPath).href);

  function resolvePersona() {
    const candidates = [
      path.join(outDir, "personaTail.js"),
      path.join(outDir, "engine/personaTail.js"),
      path.join(outDir, "src/engine/personaTail.js"),
    ];
    for (const c of candidates) {
      if (existsSync(c)) return c;
    }
    return null;
  }

  let passed = 0;
  let failed = 0;
  function test(name, fn) {
    try {
      fn();
      passed += 1;
      console.log("  ok  ", name);
    } catch (err) {
      failed += 1;
      console.error("  FAIL", name, err instanceof Error ? err.message : err);
    }
  }

  // sanitizeFactForPrompt and selectPromptFacts do not exist any more: facts are
  // sanitised and bounded by boundMemoryFacts, reached through this entry point.
  // The old tests called two names that resolved to undefined and had been red,
  // in a harness no workflow ran, for as long as nobody looked.
  test("a fact cannot smuggle control characters or newlines into the block", () => {
    const raw = `name\nis\tAlex${"\u0000"}!`;
    const block = buildMemoryFactsBlock("en", mkFacts(raw));
    const bullets = block.split("\n").filter((line) => line.startsWith("- "));
    assert(bullets.length === 1, `one bullet, got ${bullets.length}`);
    assert(!/[\u0000-\u0008\u000b-\u001f]/.test(block), "no control characters survive");
    assert(bullets[0].includes("name is Alex"), `collapsed: ${bullets[0]}`);
  });

  test("a 200-char fact lands in the injected block at exactly the 120-char cap", () => {
    // truncNote promises "facts over {chars} chars are shortened in replies";
    // this is that promise, tested through the real entry point.
    const block = buildMemoryFactsBlock("en", mkFacts("A".repeat(200)));
    const bullet = block
      .split("\n")
      .find((line) => /^- \[\d{4}-\d{2}-\d{2}\] /.test(line));
    assert(bullet, "one fact bullet expected");
    const text = bullet.slice("- [YYYY-MM-DD] ".length);
    assert(text.length === 120, `fact must be capped at 120, got ${text.length}`);
    assert(text === "A".repeat(120), `cap must be a clean slice, got: ${text}`);
  });

  test("the block is bounded by a token budget, and the newest days win", () => {
    // Every turn pays for this block, so it cannot grow with the user's memory.
    // The bound ranks by date descending, so what survives is recent — a fact
    // added today must not be the one deferred.
    const texts = Array.from({ length: 60 }, (_, i) => `fact-${i + 1} ${"w".repeat(120)}`);
    const block = buildMemoryFactsBlock("en", mkFacts(...texts));
    const bullets = block.split("\n").filter((line) => line.startsWith("- "));
    assert(bullets.length < 60, `bounded, got ${bullets.length} of 60`);
    assert(
      bullets[bullets.length - 1].includes("notes deferred"),
      `the deferral is stated, not silent: ${bullets[bullets.length - 1]}`,
    );
    assert(block.includes("fact-60 "), "the newest fact survives the bound");
    assert(!block.includes("fact-1 "), "the oldest is the one deferred");
  });

  test("buildMemoryFactsBlock empty when no usable facts", () => {
    assert(buildMemoryFactsBlock("en", []) === "", "[]");
    assert(buildMemoryFactsBlock("en", null) === "", "null");
    assert(buildMemoryFactsBlock("en", mkFacts("  ", "\n")) === "", "whitespace");
  });

  test("buildMemoryFactsBlock keeps untrusted framing + fact lines", () => {
    const block = buildMemoryFactsBlock("en", mkFacts("I like tea", "My name is Alex"));
    assert(block.includes("untrusted"), "framing");
    // Rendered as "- [YYYY-MM-DD] text": the date is part of the contract, the
    // model is told when it learned each fact.
    assert(/^- \[\d{4}-\d{2}-\d{2}\] I like tea$/m.test(block), "fact 1 with its date");
    assert(/^- \[\d{4}-\d{2}-\d{2}\] My name is Alex$/m.test(block), "fact 2 with its date");
    assert(!block.includes("I like tea\nMy name"), "not raw-joined");
  });

  test("applyMemoryFactsToLastUser prefixes last user only (format B)", () => {
    const block = buildMemoryFactsBlock("en", mkFacts("I like tea"));
    const msgs = [
      { role: "system", content: "You are Kalsa." },
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "what is my drink?" },
    ];
    const out = applyMemoryFactsToLastUser(msgs, block);
    assert(out[0].content === "You are Kalsa.", "system unchanged");
    assert(out[1].content === "hi", "earlier user unchanged");
    assert(out[2].content === "hello", "assistant unchanged");
    assert(String(out[3].content).startsWith(block), "facts on last user");
    assert(String(out[3].content).endsWith("what is my drink?"), "user text kept");
    assert(msgs[3].content === "what is my drink?", "input not mutated");
  });

  test("applyMemoryFactsToLastUser prefixes first text part of multimodal user", () => {
    const block = "FACTS";
    const out = applyMemoryFactsToLastUser(
      [
        {
          role: "user",
          content: [
            { type: "text", text: "look" },
            { type: "image_url", image_url: { url: "x" } },
          ],
        },
      ],
      block,
    );
    const parts = out[0].content;
    assert(Array.isArray(parts), "parts");
    assert(parts[0].type === "text" && parts[0].text.startsWith("FACTS"), "prefixed text");
    assert(parts[0].text.endsWith("look"), "kept text");
    assert(parts[1].type === "image_url", "image stays");
  });

  test("applyMemoryFactsToLastUser no-op on empty block / no user", () => {
    const onlySys = [{ role: "system", content: "s" }];
    assert(applyMemoryFactsToLastUser(onlySys, "FACTS") === onlySys, "no user");
    const withUser = [{ role: "user", content: "q" }];
    assert(applyMemoryFactsToLastUser(withUser, "") === withUser, "empty block");
  });

  test("bake: stable facts keep previous user prefixed (prefix-match suffix)", () => {
    const facts = buildMemoryFactsBlock("en", mkFacts("I like tea"));
    const turn1 = applyMemoryFactsToLastUser(
      [
        { role: "system", content: "sys" },
        { role: "user", content: "hi" },
      ],
      facts,
    );
    let baked = commitBakedLastUser([], "hi", lastUserContent(turn1));
    const turn2Bare = [
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "drink?" },
    ];
    const applied = applyBakedUserTails(turn2Bare, baked);
    assert(applied.messages !== turn2Bare, "copied");
    assert(applied.messages[1].content === turn1[1].content, "user1 stays prefixed");
    assert(applied.messages[3].content === "drink?", "new last user still bare");
    assert(turn2Bare[1].content === "hi", "input not mutated");
    const turn2 = applyMemoryFactsToLastUser(applied.messages, facts);
    assert(String(turn2[3].content).startsWith(facts), "facts on new last user");
    assert(turn2[1].content === turn1[1].content, "stable facts: prior user unchanged");
    baked = commitBakedLastUser(applied.matched, "drink?", lastUserContent(turn2));
    assert(baked.length === 2, `len ${baked.length}`);
  });

  test("bake: changing facts keep OLD prefix on prior user", () => {
    const facts1 = buildMemoryFactsBlock("en", mkFacts("I like tea"));
    const facts2 = buildMemoryFactsBlock("en", mkFacts("I like coffee"));
    const turn1 = applyMemoryFactsToLastUser([{ role: "user", content: "hi" }], facts1);
    const baked = commitBakedLastUser([], "hi", lastUserContent(turn1));
    const applied = applyBakedUserTails(
      [
        { role: "user", content: "hi" },
        { role: "assistant", content: "ok" },
        { role: "user", content: "now?" },
      ],
      baked,
    );
    const turn2 = applyMemoryFactsToLastUser(applied.messages, facts2);
    assert(String(turn2[0].content).startsWith(facts1), "old facts on user1");
    assert(!String(turn2[0].content).includes("coffee"), "user1 not rewritten");
    assert(String(turn2[2].content).startsWith(facts2), "new facts on last user");
  });

  test("bake: compaction window aligns to baked suffix", () => {
    const facts = "F";
    let baked = [];
    let matched = [];
    for (const u of ["u1", "u2", "u3"]) {
      const msgs = [
        ...baked.map((b) => ({ role: "user", content: b.bare })),
        { role: "user", content: u },
      ];
      const applied = applyBakedUserTails(msgs, baked);
      matched = applied.matched;
      const prefixed = applyMemoryFactsToLastUser(applied.messages, facts);
      baked = commitBakedLastUser(matched, u, lastUserContent(prefixed));
    }
    // Drop u1 (compaction). Remaining previous users are u2,u3; new is u4.
    const window = [
      { role: "user", content: "u2" },
      { role: "assistant", content: "a" },
      { role: "user", content: "u3" },
      { role: "assistant", content: "a" },
      { role: "user", content: "u4" },
    ];
    const applied = applyBakedUserTails(window, baked);
    assert(String(applied.messages[0].content).startsWith("F"), "u2 prefixed");
    assert(String(applied.messages[2].content).startsWith("F"), "u3 prefixed");
    assert(applied.messages[4].content === "u4", "u4 bare");
    assert(realMatches(applied) === 2, `real matches ${realMatches(applied)} of ${applied.matched.length} turns`);
  });

  test("bake: edit mismatch stops; earlier prefix still applied", () => {
    const baked = [
      { bare: "u1", prefixed: "P1\nu1" },
      { bare: "u2", prefixed: "P2\nu2" },
    ];
    const applied = applyBakedUserTails(
      [
        { role: "user", content: "u1" },
        { role: "assistant", content: "a" },
        { role: "user", content: "u2-edited" },
        { role: "assistant", content: "a" },
        { role: "user", content: "u3" },
      ],
      baked,
    );
    assert(applied.messages[0].content === "P1\nu1", "u1 kept");
    assert(applied.messages[2].content === "u2-edited", "edited not forced");
    assert(realMatches(applied) === 1, `real matches ${realMatches(applied)} of ${applied.matched.length} turns`);
  });

  test("bake: chat-switch mismatch is a no-op", () => {
    const msgs = [
      { role: "user", content: "other" },
      { role: "assistant", content: "a" },
      { role: "user", content: "q" },
    ];
    const applied = applyBakedUserTails(msgs, [{ bare: "u1", prefixed: "P\nu1" }]);
    assert(applied.messages === msgs, "same ref");
    assert(realMatches(applied) === 0, "no match");
  });

  test("bake: regen last turn (drop last user, resend) keeps earlier tails", () => {
    const facts = "F";
    let baked = [];
    for (const u of ["u1", "u2", "u3"]) {
      const msgs = [
        ...baked.map((b) => ({ role: "user", content: b.bare })),
        { role: "user", content: u },
      ];
      const applied = applyBakedUserTails(msgs, baked);
      const prefixed = applyMemoryFactsToLastUser(applied.messages, facts);
      baked = commitBakedLastUser(applied.matched, u, lastUserContent(prefixed));
    }
    // Regen last assistant: history previous users are u1,u2; last is u3 resend.
    const regen = [
      { role: "user", content: "u1" },
      { role: "assistant", content: "a" },
      { role: "user", content: "u2" },
      { role: "assistant", content: "a" },
      { role: "user", content: "u3" },
    ];
    const applied = applyBakedUserTails(regen, baked);
    assert(String(applied.messages[0].content).startsWith("F"), "u1 prefixed");
    assert(String(applied.messages[2].content).startsWith("F"), "u2 prefixed");
    assert(applied.messages[4].content === "u3", "u3 bare resend");
    assert(realMatches(applied) === 2, `real matches ${realMatches(applied)} of ${applied.matched.length} turns`);
    const next = commitBakedLastUser(applied.matched, "u3", "F\n\nu3");
    assert(next.length === 3, `commit ${next.length}`);
    assert(next[0].bare === "u1" && next[1].bare === "u2" && next[2].bare === "u3", "no wipe");
  });

  test("bake: edit last user keeps earlier tails", () => {
    const baked = [
      { bare: "u1", prefixed: "P1\nu1" },
      { bare: "u2", prefixed: "P2\nu2" },
    ];
    const applied = applyBakedUserTails(
      [
        { role: "user", content: "u1" },
        { role: "assistant", content: "a" },
        { role: "user", content: "u2-edited" },
      ],
      baked,
    );
    assert(applied.messages[0].content === "P1\nu1", "u1 kept");
    assert(applied.messages[2].content === "u2-edited", "edited last stays bare");
    assert(realMatches(applied) === 1, `real matches ${realMatches(applied)} of ${applied.matched.length} turns`);
    const next = commitBakedLastUser(applied.matched, "u2-edited", "P3\nu2-edited");
    assert(next.length === 2, `commit ${next.length}`);
    assert(next[0].bare === "u1" && next[1].bare === "u2-edited", "u1 not wiped");
  });

  test("bake: commit does not wipe still-valid tails when aligned run is empty", () => {
    const baked = [
      { bare: "u1", prefixed: "P1\nu1" },
      { bare: "u2", prefixed: "P2\nu2" },
    ];
    const keepers = keepStillValidBakedTails(baked, ["u1", "u2"]);
    assert(keepers.length === 2, "both still valid");
    const next = commitBakedLastUser(keepers, "u3", "P3\nu3");
    assert(next.map((t) => t.bare).join(",") === "u1,u2,u3", "kept + last");
    assert(keepStillValidBakedTails(baked, ["other"]).length === 0, "chat switch");
  });

  test("bake: lastBare is persist text, not modelText", () => {
    const persist = "hello";
    const modelText = 'hello\n\n[document:1 name="x"]';
    const prefixed = `FACTS\n\n${modelText}`;
    const baked = commitBakedLastUser([], persist, prefixed);
    assert(baked[0].bare === persist, "bare is persist");
    assert(baked[0].prefixed === prefixed, "prefixed keeps model text");
    const applied = applyBakedUserTails(
      [
        { role: "user", content: persist },
        { role: "assistant", content: "a" },
        { role: "user", content: "next" },
      ],
      baked,
    );
    assert(applied.messages[0].content === prefixed, "rematch on persist");
    const miss = applyBakedUserTails(
      [
        { role: "user", content: persist },
        { role: "assistant", content: "a" },
        { role: "user", content: "next" },
      ],
      [{ bare: modelText, prefixed }],
    );
    assert(realMatches(miss) === 0, "modelText bare would miss persist history");
  });

  test("bake: multimodal last user persists text only (no image_url)", () => {
    const turn1 = applyMemoryFactsToLastUser(
      [
        {
          role: "user",
          content: [
            { type: "text", text: "look" },
            { type: "image_url", image_url: { url: "x" } },
          ],
        },
      ],
      "FACTS",
    );
    const baked = commitBakedLastUser([], "look", lastUserContent(turn1));
    assert(typeof baked[0].bare === "string", "bare string");
    assert(typeof baked[0].prefixed === "string", "prefixed string");
    assert(!JSON.stringify(baked).includes("image_url"), "no image in bake");
    assert(baked[0].prefixed.includes("FACTS") && baked[0].prefixed.includes("look"), "text kept");
    const applied = applyBakedUserTails(
      [
        { role: "user", content: "look" },
        { role: "assistant", content: "a" },
        { role: "user", content: "next" },
      ],
      baked,
    );
    assert(typeof applied.messages[0].content === "string", "applied string");
    assert(!JSON.stringify(applied.messages[0]).includes("image_url"), "no image rematch");
    assert(String(applied.messages[0].content).startsWith("FACTS"), "facts reapplied");
    assert(bakeTextContent(lastUserContent(turn1)).includes("look"), "extract text");
  });

  test("parseBakedUserTails fail-closed + cap", () => {
    assert(parseBakedUserTails(null).length === 0, "null");
    assert(parseBakedUserTails("x").length === 0, "string");
    assert(parseBakedUserTails([{ bare: "a" }]).length === 0, "missing prefixed");
    const one = parseBakedUserTails([{ bare: "a", prefixed: "P" }]);
    assert(one.length === 1 && one[0].bare === "a" && one[0].prefixed === "P", "ok");
    const many = Array.from({ length: MAX_BAKED_USER_TAILS + 5 }, (_, i) => ({
      bare: `u${i}`,
      prefixed: `P${i}`,
    }));
    assert(parseBakedUserTails(many).length === MAX_BAKED_USER_TAILS, "capped");
    const stripped = parseBakedUserTails([
      {
        bare: "hi",
        prefixed: [
          { type: "text", text: "F\nhi" },
          { type: "image_url", image_url: { url: "x" } },
        ],
      },
    ]);
    assert(stripped.length === 1 && stripped[0].prefixed === "F\nhi", "strip image_url");
  });

  const personaPath = resolvePersona();
  assert(personaPath, "compiled personaTail.js");
  const { applyPersonaTail } = await import(pathToFileURL(personaPath).href);

  // The compiled closure also carries the shared cap and the locale tables:
  // the extraction-side pins read PROMPT_FACT_CHARS from dnaBounding and the
  // extractPrompt strings from the compiled locales — no handwritten 120 in
  // this contract.
  function resolveOne(rels) {
    for (const rel of rels) {
      const c = path.join(outDir, rel);
      if (existsSync(c)) return c;
    }
    return null;
  }
  const { PROMPT_FACT_CHARS } = await import(
    pathToFileURL(
      resolveOne(["dnaBounding.js", "memory/dnaBounding.js", "src/memory/dnaBounding.js"]),
    ).href
  );
  const enLoc = (
    await import(pathToFileURL(resolveOne(["en.js", "i18n/en.js", "src/i18n/en.js"])).href)
  ).en;
  const itLoc = (
    await import(pathToFileURL(resolveOne(["it.js", "i18n/it.js", "src/i18n/it.js"])).href)
  ).it;
  assert(PROMPT_FACT_CHARS > 0, "PROMPT_FACT_CHARS exported by compiled dnaBounding");
  assert(
    enLoc?.memory?.extractPrompt && itLoc?.memory?.extractPrompt,
    "compiled locale extractPrompts",
  );

  test("bake: rematch key is persona'd history content", () => {
    const persist = "hello";
    const historyLanding = applyPersonaTail(persist, "Be terse.");
    assert(historyLanding !== persist, "persona frame applied");
    const prefixed = `FACTS\n\n${historyLanding}`;
    const baked = commitBakedLastUser([], bakeRematchKey(historyLanding), prefixed);
    assert(baked[0].bare === bakeRematchKey(historyLanding), "bare is persona'd key");
    const applied = applyBakedUserTails(
      [
        { role: "user", content: historyLanding },
        { role: "assistant", content: "a" },
        { role: "user", content: "next" },
      ],
      baked,
    );
    assert(realMatches(applied) === 1, "persona rematch hits");
    assert(applied.messages[0].content === prefixed, "prefixed reapplied");
    const miss = applyBakedUserTails(
      [
        { role: "user", content: persist },
        { role: "assistant", content: "a" },
        { role: "user", content: "next" },
      ],
      baked,
    );
    assert(realMatches(miss) === 0, "bare persist does not match persona'd key");
  });

  test("bake: rematch ignores trailing/leading whitespace", () => {
    const baked = commitBakedLastUser([], bakeRematchKey("hello  "), "P\nhello");
    assert(baked[0].bare === "hello", "commit trims");
    const applied = applyBakedUserTails(
      [
        { role: "user", content: "  hello" },
        { role: "assistant", content: "a" },
        { role: "user", content: "next" },
      ],
      baked,
    );
    assert(realMatches(applied) === 1, "whitespace rematch hits");
    assert(applied.messages[0].content === "P\nhello", "prefixed reapplied");
  });

  // Structural gates over the shipped source. The behavior tests above prove
  // what the tail path does; these pin the wiring that keeps it true. Same
  // technique as scripts/prefixPrewarmHarness.mjs: inside a pinned region
  // comments are stripped and whitespace is normalized, so reformatting there
  // is free — rewiring the facts back into the system prompt is not. The
  // region anchors are a different matter: indexOf matches literal text on
  // the raw source, so reformatting an anchor line can false-positive the
  // pin. If a reformat moves an anchor, update it and say why.
  const shapeOf = (text) =>
    text
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "")
      .replace(/\s+/g, " ")
      .trim();
  const llamaSrc = readFileSync(
    path.join(projectRoot, "src/engine/LlamaService.ts"),
    "utf8",
  );
  const llamaRegion = (from, to) => {
    const a = llamaSrc.indexOf(from);
    assert(a >= 0, `region start not found: ${from}`);
    const b = llamaSrc.indexOf(to, a);
    assert(b > a, `region end not found after ${from}`);
    return shapeOf(llamaSrc.slice(a, b + to.length));
  };

  test("MEMORY_FACTS_ON_USER_TAIL is true in ttftFlags.ts", () => {
    const src = shapeOf(
      readFileSync(path.join(projectRoot, "src/engine/ttftFlags.ts"), "utf8"),
    );
    const flag = src.match(/export const MEMORY_FACTS_ON_USER_TAIL = (true|false);/);
    assert(flag, "MEMORY_FACTS_ON_USER_TAIL declaration not found in ttftFlags.ts");
    assert(
      flag[1] === "true",
      "MEMORY_FACTS_ON_USER_TAIL must stay true: false restores facts-in-system-prompt, where every new fact invalidates the whole prefix",
    );
  });

  test("LlamaService.buildSystemPrompt keeps the facts block behind the legacy-only flag guard", () => {
    const fnShape = llamaRegion(
      "export function buildSystemPrompt(",
      "return prompt;\n}",
    );
    assert(
      fnShape ===
        "export function buildSystemPrompt( locale: Locale, withTools: boolean, " +
          "facts?: readonly MemoryFact[], ): string { const strings = getStrings(locale); " +
          "let prompt = withTools ? strings.systemPromptWithSearch : strings.systemPrompt; " +
          "if (!MEMORY_FACTS_ON_USER_TAIL) { const factBlock = buildMemoryFactsBlock(locale, facts); " +
          "if (factBlock) prompt += `\\n\\n${factBlock}`; } return prompt; }",
      `buildSystemPrompt changed shape: buildMemoryFactsBlock may appear only ` +
        `inside if (!MEMORY_FACTS_ON_USER_TAIL) — found: ${fnShape}`,
    );
  });

  test("AppShell's systemText is exactly one buildSystemPrompt call, nothing appended", () => {
    const shellSrc = readFileSync(
      path.join(projectRoot, "src/app/AppShell.tsx"),
      "utf8",
    );
    // "systemText" occurs once in the file today; the count assert keeps the
    // anchor honest if a second site ever appears.
    const anchor = "systemText: buildSystemPrompt(";
    const hits = shellSrc.split(anchor).length - 1;
    assert(hits === 1, `anchor expected exactly once, found ${hits}`);
    const start = shellSrc.indexOf(anchor);
    const eol = shellSrc.indexOf("\n", start);
    const lineShape = shapeOf(shellSrc.slice(start, eol));
    assert(
      lineShape ===
        "systemText: buildSystemPrompt(locale, withTools, promptFacts),",
      `systemText must be exactly one buildSystemPrompt call — appending facts ` +
        `here would rejoin them to the system prompt and double-count them in ` +
        `the ceiling guard — found: ${lineShape}`,
    );
  });

  test("parseMemoryExtract clamps adds to the shared cap, exact shape", () => {
    const shape = llamaRegion("const add = Array.isArray(obj.add)", ": [];");
    assert(
      shape ===
        'const add = Array.isArray(obj.add) ? obj.add .filter((item): item is string => typeof item === "string") .map((item) => item.replace(/\\s+/g, " ").trim().slice(0, PROMPT_FACT_CHARS)) .filter((item) => item.length > 0) .slice(0, 3) : [];',
      `the add clamp must sanitize to PROMPT_FACT_CHARS and cap at 3 — found: ${shape}`,
    );
  });

  test("parseMemoryExtract carries no handwritten 120 anywhere", () => {
    const region = llamaRegion(
      "function parseMemoryExtract(",
      "return { add, remove, parseOutcome: 1 };",
    );
    const hit = region.match(/.{0,30}\b120\b.{0,30}/);
    assert(!hit, `handwritten 120 survived in parseMemoryExtract — found: ${hit?.[0]}`);
  });

  test("extract prompt is built in one pass from the shared cap", () => {
    // Single pass + function replacer: substitutions cannot act on already
    // substituted text, and `$` patterns in the content stay literal. Three
    // chained .replace() calls lose both properties.
    const shape = llamaRegion("const extractValues", "?? placeholder,\n  );");
    assert(
      shape ===
        'const extractValues: Record<string, string> = { "{user}": userSlice, "{assistant}": assistantSlice, "{chars}": String(PROMPT_FACT_CHARS), }; const prompt = strings.memory.extractPrompt.replace( /\\{user\\}|\\{assistant\\}|\\{chars\\}/g, (placeholder) => extractValues[placeholder] ?? placeholder, );',
      `the extract prompt must be built in one pass from PROMPT_FACT_CHARS — found: ${shape}`,
    );
  });

  test("extract prompt interpolates the shared cap in both locales, no handwritten 120", () => {
    const cases = [
      ["en", enLoc, `≤ ${PROMPT_FACT_CHARS} chars`],
      ["it", itLoc, `≤ ${PROMPT_FACT_CHARS} caratteri`],
    ];
    for (const [name, loc, want] of cases) {
      const raw = loc.memory.extractPrompt;
      assert(raw.includes("{chars}"), `${name}: extractPrompt must carry the {chars} placeholder`);
      assert(!/\b120\b/.test(raw), `${name}: extractPrompt hardcodes 120`);
      const prompt = raw.replace(
        /\{user\}|\{assistant\}|\{chars\}/g,
        (placeholder) => ({ "{user}": "U", "{assistant}": "A", "{chars}": String(PROMPT_FACT_CHARS) })[placeholder] ?? placeholder,
      );
      assert(!prompt.includes("{chars}"), `${name}: {chars} left uninterpolated`);
      assert(prompt.includes(want), `${name}: interpolated cap missing, want "${want}"`);
    }
  });

  test("extract prompt keeps adversarial user text verbatim, all slots resolved", () => {
    // The user can put "{assistant}" or "$&" in a message. Whatever the
    // construction is, the built prompt must keep that text verbatim inside
    // the USER slot and resolve all three placeholders in their own slots —
    // never let user content capture the assistant slot or eat itself.
    const template = enLoc.memory.extractPrompt;
    const user = "ciao {assistant} come stai — ricordati $& e $'";
    const assistant = "RISPOSTA-DEL-MODELLO";
    const chars = String(PROMPT_FACT_CHARS);
    const values = { "{user}": user, "{assistant}": assistant, "{chars}": chars };
    // Mirror of the production construction (bound by the one-pass shape pin).
    const prompt = template.replace(
      /\{user\}|\{assistant\}|\{chars\}/g,
      (placeholder) => values[placeholder] ?? placeholder,
    );
    assert(
      prompt.includes(`USER: ${user}`),
      `user text must land verbatim in the USER slot — got: ${prompt.slice(prompt.indexOf("USER:"), prompt.indexOf("USER:") + 90)}`,
    );
    assert(
      prompt.includes(`ASSISTANT: ${assistant}`),
      "assistant slot must hold the assistant value",
    );
    assert(prompt.includes(`≤ ${chars} chars`), "chars slot must be resolved");
    // Verbatim user data may legitimately contain placeholder-looking text;
    // what must never survive is a placeholder in a SLOT position.
    assert(
      !prompt.includes("USER: {user}") &&
        !prompt.includes("ASSISTANT: {assistant}") &&
        !prompt.includes("≤ {chars} chars"),
      "template slots must all be resolved",
    );
  });

  test("the dead namesake system-prompt builder stays deleted", () => {
    // buildSystemPrompt lived twice: the namesake appended memory facts to the
    // system prompt — the exact behavior the tail flag exists to prevent — and
    // its only importer was its own test. The name is written out in full on
    // purpose: anyone searching for the deleted module lands on this pin, the
    // one place that says why it is gone.
    const deadNamesake = path.join(projectRoot, "src/engine/memoryPrompt.ts");
    assert(
      !existsSync(deadNamesake),
      "the dead namesake (facts-in-system-prompt builder) is back on disk — delete it again",
    );
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
