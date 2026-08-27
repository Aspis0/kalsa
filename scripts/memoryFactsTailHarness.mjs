/**
 * Harness for src/engine/memoryFactsTail.ts (P1-1 format B).
 *
 * Facts must ride the last user message, stay sanitized, and keep the
 * untrusted-data framing. No llama.rn / React.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
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

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  console.log("Compiling memoryFactsTail.ts …");
  compile();
  const modPath = resolveBuilt();
  console.log("Loading", modPath);
  const {
    MAX_PROMPT_FACTS,
    MAX_PROMPT_FACT_CHARS,
    sanitizeFactForPrompt,
    selectPromptFacts,
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

  test("sanitize strips controls, collapses space, caps length", () => {
    const raw = `name\nis\tAlex${"\u0000"}!${"x".repeat(200)}`;
    const out = sanitizeFactForPrompt(raw);
    assert(!/[\u0000-\u001f]/.test(out), "no controls");
    assert(!out.includes("\n"), "no newline");
    assert(out.length <= MAX_PROMPT_FACT_CHARS, "capped");
    assert(out.startsWith("name is Alex"), `prefix: ${out.slice(0, 20)}`);
  });

  test("selectPromptFacts keeps last MAX_PROMPT_FACTS and drops empties", () => {
    const many = Array.from({ length: MAX_PROMPT_FACTS + 5 }, (_, i) => `fact ${i}`);
    const selected = selectPromptFacts(["", "   ", ...many, "\n"]);
    assert(selected.length === MAX_PROMPT_FACTS, `len ${selected.length}`);
    assert(selected[0] === "fact 5", selected[0]);
    assert(selected[selected.length - 1] === `fact ${MAX_PROMPT_FACTS + 4}`);
  });

  test("buildMemoryFactsBlock empty when no usable facts", () => {
    assert(buildMemoryFactsBlock("en", []) === "", "[]");
    assert(buildMemoryFactsBlock("en", null) === "", "null");
    assert(buildMemoryFactsBlock("en", ["  ", "\n"]) === "", "whitespace");
  });

  test("buildMemoryFactsBlock keeps untrusted framing + fact lines", () => {
    const block = buildMemoryFactsBlock("en", ["I like tea", "My name is Alex"]);
    assert(block.includes("untrusted"), "framing");
    assert(block.includes("- I like tea"), "fact 1");
    assert(block.includes("- My name is Alex"), "fact 2");
    assert(!block.includes("I like tea\nMy name"), "not raw-joined");
  });

  test("applyMemoryFactsToLastUser prefixes last user only (format B)", () => {
    const block = buildMemoryFactsBlock("en", ["I like tea"]);
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
    const facts = buildMemoryFactsBlock("en", ["I like tea"]);
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
    const facts1 = buildMemoryFactsBlock("en", ["I like tea"]);
    const facts2 = buildMemoryFactsBlock("en", ["I like coffee"]);
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
    assert(applied.matched.length === 2, `matched ${applied.matched.length}`);
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
    assert(applied.matched.length === 1, `matched ${applied.matched.length}`);
  });

  test("bake: chat-switch mismatch is a no-op", () => {
    const msgs = [
      { role: "user", content: "other" },
      { role: "assistant", content: "a" },
      { role: "user", content: "q" },
    ];
    const applied = applyBakedUserTails(msgs, [{ bare: "u1", prefixed: "P\nu1" }]);
    assert(applied.messages === msgs, "same ref");
    assert(applied.matched.length === 0, "no match");
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
    assert(applied.matched.length === 2, `matched ${applied.matched.length}`);
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
    assert(applied.matched.length === 1, `matched ${applied.matched.length}`);
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
    assert(miss.matched.length === 0, "modelText bare would miss persist history");
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
    assert(applied.matched.length === 1, "persona rematch hits");
    assert(applied.messages[0].content === prefixed, "prefixed reapplied");
    const miss = applyBakedUserTails(
      [
        { role: "user", content: persist },
        { role: "assistant", content: "a" },
        { role: "user", content: "next" },
      ],
      baked,
    );
    assert(miss.matched.length === 0, "bare persist does not match persona'd key");
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
    assert(applied.matched.length === 1, "whitespace rematch hits");
    assert(applied.messages[0].content === "P\nhello", "prefixed reapplied");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
