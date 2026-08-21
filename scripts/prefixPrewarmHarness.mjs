/**
 * Harness for prefixPrewarm helpers (V2-2).
 * Hash stability + system-only messages builder. No llama.rn / device.
 * Compile-from-disk. Exit 1 on fail.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const outDir = path.join(projectRoot, "scripts/.build/prefixPrewarmHarness");

function compile() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const r = spawnSync(
    "npx",
    [
      "tsc",
      "src/engine/prefixPrewarm.ts",
      "src/engine/ttftFlags.ts",
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

function resolveBuilt(file) {
  const candidates = [
    path.join(outDir, file),
    path.join(outDir, "engine", file),
    path.join(outDir, "src/engine", file),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  console.error(`Could not find compiled ${file}. Tried:\n`, candidates.join("\n"));
  process.exit(1);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function tool(name, extra = {}) {
  return {
    type: "function",
    function: {
      name,
      description: extra.description ?? `${name} desc`,
      parameters: extra.parameters ?? {
        type: "object",
        properties: { q: { type: "string" } },
        required: ["q"],
      },
    },
  };
}

async function main() {
  console.log("Compiling prefixPrewarm.ts + ttftFlags.ts …");
  compile();
  const prewarmMod = await import(pathToFileURL(resolveBuilt("prefixPrewarm.js")).href);
  const flagsMod = await import(pathToFileURL(resolveBuilt("ttftFlags.js")).href);

  const {
    djb2,
    toolsForPrewarmHash,
    computePrewarmPrefixHash,
    buildStaticPrefixMessages,
    assembleStaticPrefix,
    shouldSkipPrewarmAfterRestore,
    shouldSkipStaticPrefixPrewarm,
  } = prewarmMod;

  assert(flagsMod.EAGER_PREFIX_PREWARM === true, "EAGER_PREFIX_PREWARM must default true");

  const sys = "You are Kalsa.";
  const tools = [tool("document_chat"), tool("web_search")];

  const msgs = buildStaticPrefixMessages(sys);
  assert(Array.isArray(msgs) && msgs.length === 1, "system-only messages length");
  assert(msgs[0].role === "system", "only system role");
  assert(msgs[0].content === sys, "system content byte-identical");
  assert(
    msgs.every((m) => m.role === "system"),
    "no user/assistant/tool roles",
  );
  assert(
    !JSON.stringify(msgs).includes('"user"'),
    "serialized messages must not include a user role",
  );

  const emptyMsgs = buildStaticPrefixMessages("");
  assert(emptyMsgs[0].role === "system" && emptyMsgs[0].content === "", "empty system still system-only");

  const a = computePrewarmPrefixHash("en", sys, tools);
  const b = computePrewarmPrefixHash("en", sys, tools);
  assert(a === b, "hash is stable");
  assert(typeof a === "string" && /^\d+$/.test(a), "hash is unsigned decimal");

  assert(
    computePrewarmPrefixHash("it", sys, tools) !== a,
    "locale changes hash",
  );
  assert(
    computePrewarmPrefixHash("en", sys + "!", tools) !== a,
    "systemText changes hash",
  );
  assert(
    computePrewarmPrefixHash("en", sys, [tool("document_chat")]) !== a,
    "tool count changes hash",
  );
  assert(
    computePrewarmPrefixHash("en", sys, [tool("web_search"), tool("document_chat")]) !== a,
    "tool order changes hash",
  );
  assert(
    computePrewarmPrefixHash(
      "en",
      sys,
      [tool("document_chat", { description: "other" }), tool("web_search")],
    ) !== a,
    "tool description changes hash",
  );
  assert(
    computePrewarmPrefixHash(
      "en",
      sys,
      [
        tool("document_chat", {
          parameters: { type: "object", properties: { q: { type: "number" } } },
        }),
        tool("web_search"),
      ],
    ) !== a,
    "tool schema changes hash",
  );

  const none = computePrewarmPrefixHash("en", sys, undefined);
  const empty = computePrewarmPrefixHash("en", sys, []);
  assert(none === empty, "undefined tools hash-equal empty list");

  const rows = toolsForPrewarmHash(tools);
  assert(rows.length === 2, "toolsForPrewarmHash length");
  assert(rows[0].name === "document_chat", "first tool name");
  assert(rows[0].schema && typeof rows[0].schema === "object", "schema object");

  const assembled = assembleStaticPrefix({ locale: "en", systemText: sys, tools });
  assert(assembled.hash === a, "assemble hash matches compute");
  assert(assembled.messages.length === 1 && assembled.messages[0].role === "system", "assemble system-only");
  assert(assembled.hasTools === true, "hasTools when tools present");
  assert(assembled.toolCount === 2, "toolCount");
  assert(assembled.systemChars === sys.length, "systemChars");
  assert(
    assembled.messages.every((m) => m.role === "system"),
    "assemble never injects user/facts/persona",
  );

  const noTools = assembleStaticPrefix({ locale: "en", systemText: sys });
  assert(noTools.hasTools === false && noTools.toolCount === 0, "no tools");
  assert(noTools.hash === none, "assemble without tools matches empty hash");

  assert(djb2("abc") === djb2("abc"), "djb2 stable");
  assert(djb2("abc") !== djb2("abd"), "djb2 sensitive");

  // V2-2: skip only on same-process hash match. After hybrid restore the
  // hash is null (even if kvHoldsChatSession would be true) → do not skip.
  assert(
    shouldSkipStaticPrefixPrewarm(null, assembled.hash) === false,
    "after restore (hash null) prewarm must run",
  );
  assert(
    shouldSkipStaticPrefixPrewarm(undefined, assembled.hash) === false,
    "undefined hash does not skip",
  );
  assert(
    shouldSkipStaticPrefixPrewarm(assembled.hash, assembled.hash) === true,
    "already-prewarmed / post-turn mark skips",
  );
  assert(
    shouldSkipStaticPrefixPrewarm("other", assembled.hash) === false,
    "different hash does not skip",
  );

  // Dense restore (Gemma): real KV — prewarm would seq_rm the chat tail.
  assert(
    shouldSkipPrewarmAfterRestore(true, false) === true,
    "dense restore + kv held → skip prewarm",
  );
  // Hybrid restore is not real (n_past=0) — prewarm must still run.
  assert(
    shouldSkipPrewarmAfterRestore(true, true) === false,
    "hybrid restore + kv held → do not skip",
  );
  assert(
    shouldSkipPrewarmAfterRestore(false, false) === false,
    "dense + no chat KV → prewarm",
  );
  assert(
    shouldSkipPrewarmAfterRestore(false, true) === false,
    "hybrid + no chat KV → prewarm",
  );

  console.log("prefixPrewarmHarness OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
