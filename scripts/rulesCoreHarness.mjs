/**
 * Harness for src/rules — evaluateTurn semantics + tool-gate behaviour.
 * Prints n-gram cosine for every gate case. Exit 1 on any failure.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const outDir = path.join(projectRoot, "scripts/.build/rulesCoreHarness");

function compile() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const r = spawnSync(
    "npx",
    [
      "tsc",
      "src/rules/evaluate.ts",
      "src/rules/ngramSim.ts",
      "src/rules/toolGate.ts",
      "--allowJs",
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

function resolveBuilt(name) {
  const candidates = [
    path.join(outDir, `${name}.js`),
    path.join(outDir, "rules", `${name}.js`),
    path.join(outDir, "src", "rules", `${name}.js`),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  console.error(`Could not find compiled ${name}.js. Tried:\n`, candidates.join("\n"));
  process.exit(1);
}

/** Old contiguous-run guard, copied from the pre-gate webSearchTool. */
function hasSharedSubstring(a, b, minLen) {
  const na = a.toLowerCase().replace(/\s+/g, " ").trim();
  const nb = b.toLowerCase().replace(/\s+/g, " ").trim();
  if (na.length < minLen || nb.length < minLen) return false;
  for (let i = 0; i + minLen <= na.length; i += 1) {
    if (nb.includes(na.slice(i, i + minLen))) return true;
  }
  return false;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const IT_MSG =
  "Ricorda questi dati il gatto si chiama Leopoldo il budget e 4500 euro la citta e Torino il codice e PK42";
const IT_PARA = "Leopoldo gatto informazioni";
const IT_UNREL = "previsioni meteo Milano domani";

const JP_MSG = "覚えておいて 猫の名前はレオポルド 予算は4500ユーロ 都市はトリノ コードはPK42";
const JP_PARA = "レオポルド 猫 情報";
const JP_UNREL = "明日の東京の天気予報";

const AR_MSG =
  "تذكر هذه البيانات القط اسمه ليوبولدو الميزانية 4500 يورو المدينة تورينو الرمز PK42";
const AR_PARA = "ليوبولدو القط معلومات";
const AR_UNREL = "توقعات الطقس في ميلانو غدا";

const EL_MSG =
  "Θυμήσου αυτά τα δεδομένα η γάτα λέγεται Λεοπόλδο ο προϋπολογισμός είναι 4500 ευρώ η πόλη είναι Τορίνο ο κωδικός είναι PK42";
const EL_PARA = "Λεοπόλδο γάτα πληροφορίες";
const EL_UNREL = "πρόγνωση καιρού Μιλάνο αύριο";

const MEM_FACT = "The user's cat is named Leopoldo and lives in Torino";
const MEM_ECHO = "Leopoldo named cat Torino";

async function main() {
  console.log("Compiling src/rules …");
  compile();
  const evaluatePath = resolveBuilt("evaluate");
  const ngramPath = resolveBuilt("ngramSim");
  const gatePath = resolveBuilt("toolGate");
  const { evaluateTurn } = await import(pathToFileURL(evaluatePath).href);
  const { ngramVec, cosine } = await import(pathToFileURL(ngramPath).href);
  const { TOOL_GATE_TABLE, ECHO_SIMILARITY_THRESHOLD } = await import(
    pathToFileURL(gatePath).href
  );

  const sim = (a, b) => cosine(ngramVec(a), ngramVec(b));

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`  OK  ${name}`);
      passed += 1;
    } catch (err) {
      console.error(`  FAIL ${name}: ${err instanceof Error ? err.message : err}`);
      failed += 1;
    }
  }

  function runGate(query, lastUserMessage, memoryFacts = []) {
    return evaluateTurn(
      {
        toolName: "web_search",
        input: { query, lastUserMessage, memoryFacts },
      },
      TOOL_GATE_TABLE,
    );
  }

  // ── engine semantics ──────────────────────────────────────────────────
  test("block short-circuits: later matching rewrite is not applied", () => {
    const table = {
      rules: [
        {
          id: "block-high",
          priority: 20,
          condition: () => true,
          action: { kind: "block", reason: "high-block" },
        },
        {
          id: "rewrite-low",
          priority: 10,
          condition: () => true,
          action: { kind: "rewrite", param: "query", value: "mutated" },
        },
      ],
    };
    const d = evaluateTurn({ toolName: "t", input: { query: "q" } }, table);
    assert(d.blocked === true, `expected blocked, got ${d.blocked}`);
    assert(d.reason === "high-block", `expected high-block, got ${d.reason}`);
    assert(d.appliedRewrites.length === 0, `rewrites applied: ${JSON.stringify(d.appliedRewrites)}`);
    const later = d.trace.rows.find((r) => r.ruleId === "rewrite-low");
    assert(later && later.shadowed === true, "later matching rule must be shadowed, not applied");
  });

  test("priority DESC wins; same priority keeps declaration order", () => {
    const twoBlocks = {
      rules: [
        {
          id: "first-low",
          priority: 5,
          condition: () => true,
          action: { kind: "block", reason: "first-low" },
        },
        {
          id: "second-high",
          priority: 10,
          condition: () => true,
          action: { kind: "block", reason: "second-high" },
        },
      ],
    };
    const byPri = evaluateTurn({ toolName: "t", input: {} }, twoBlocks);
    assert(byPri.reason === "second-high", `priority winner: ${byPri.reason}`);

    const tied = {
      rules: [
        {
          id: "declared-first",
          priority: 1,
          condition: () => true,
          action: { kind: "block", reason: "declared-first" },
        },
        {
          id: "declared-second",
          priority: 1,
          condition: () => true,
          action: { kind: "block", reason: "declared-second" },
        },
      ],
    };
    const byDecl = evaluateTurn({ toolName: "t", input: {} }, tied);
    assert(byDecl.reason === "declared-first", `declaration-order winner: ${byDecl.reason}`);
  });

  test("frozen-snapshot: a rewrite is not visible to a later rule condition", () => {
    const table = {
      rules: [
        {
          id: "rewrite-query",
          priority: 20,
          condition: (input) => input.query === "original",
          action: { kind: "rewrite", param: "query", value: "rewritten" },
        },
        {
          id: "block-if-rewritten",
          priority: 10,
          condition: (input) => input.query === "rewritten",
          action: { kind: "block", reason: "saw-rewrite" },
        },
      ],
    };
    const d = evaluateTurn({ toolName: "t", input: { query: "original" } }, table);
    assert(d.blocked === false, "later condition must still see the frozen original query");
    assert(d.appliedRewrites.length === 1, `expected 1 rewrite, got ${d.appliedRewrites.length}`);
    assert(d.appliedRewrites[0].value === "rewritten", "rewrite is collected after evaluation");
    const later = d.trace.rows.find((r) => r.ruleId === "block-if-rewritten");
    assert(later && later.conditionResult === false, "later condition saw frozen snapshot, not the rewrite");
  });

  // ── gate behaviour ────────────────────────────────────────────────────
  const acceptanceFacts = [
    "Marco è allergico alle arachidi",
    "Il codice fiscale di Marco è RSSMRC80A01L219X",
    "Marco lavora alla Banca Intesa di Torino",
  ];

  // Individual facts for isolated testing
  const FACT_MARIO = "Mario Rossi abita in Via Roma 12";
  const FACT_MARCO_ALLERGICO = "Marco è allergico alle arachidi";
  const FACT_PLUTO = "il mio account è pluto";
  const FACT_CODICE = "Il codice fiscale di Marco è RSSMRC80A01L219X";
  const FACT_BANCA = "Marco lavora alla Banca Intesa di Torino";

  // Multi-language facts
  const DE_FACTS = ["Der Hund heißt Rex", "Die Wohnung ist in Berlin"];
  const ES_FACTS = ["El perro se llama Rex", "La casa está en Madrid"];
  const FR_FACTS = ["Le chien s'appelle Rex", "La maison est à Lyon"];

  const gateCases = [
    { name: "it-paraphrase (real failure)", query: IT_PARA, msg: IT_MSG, facts: [], expectBlock: true },
    { name: "it-verbatim-echo", query: IT_MSG, msg: IT_MSG, facts: [], expectBlock: false },
    { name: "it-unrelated", query: IT_UNREL, msg: IT_MSG, facts: [], expectBlock: true },
    { name: "japanese-paraphrase", query: JP_PARA, msg: JP_MSG, facts: [], expectBlock: true },
    { name: "japanese-unrelated", query: JP_UNREL, msg: JP_MSG, facts: [], expectBlock: true },
    { name: "arabic-paraphrase", query: AR_PARA, msg: AR_MSG, facts: [], expectBlock: true },
    { name: "arabic-unrelated", query: AR_UNREL, msg: AR_MSG, facts: [], expectBlock: true },
    { name: "greek-paraphrase", query: EL_PARA, msg: EL_MSG, facts: [], expectBlock: true },
    { name: "greek-unrelated", query: EL_UNREL, msg: EL_MSG, facts: [], expectBlock: true },
    { name: "memory-fact-reordered", query: MEM_ECHO, msg: "unrelated last message", facts: [MEM_FACT], expectBlock: true },
    { name: "empty-query", query: "", msg: IT_MSG, facts: [], expectBlock: true },
    { name: "empty-message", query: IT_PARA, msg: "", facts: [], expectBlock: false },
    { name: "1-char-query", query: "L", msg: IT_MSG, facts: [], expectBlock: false },
    { name: "2-char-query", query: "Le", msg: IT_MSG, facts: [], expectBlock: false },
    // Acceptance criteria: MUST BLOCK (each against only its own fact in isolation)
    { name: "accept-block-mario-rossi", query: "dove abita Mario?", msg: "unrelated", facts: [FACT_MARIO], expectBlock: true },
    { name: "accept-block-marco-allergico", query: "marco allergico arachidi", msg: "unrelated", facts: [FACT_MARCO_ALLERGICO], expectBlock: true },
    { name: "accept-block-pluto", query: "account pluto", msg: "unrelated", facts: [FACT_PLUTO], expectBlock: true },
    { name: "accept-block-codice-fiscale", query: "RSSMRC80A01L219X", msg: "unrelated", facts: [FACT_CODICE], expectBlock: true },
    { name: "accept-block-banca-intesa", query: "Banca Intesa Torino dipendenti", msg: "unrelated", facts: [FACT_BANCA], expectBlock: true },
    { name: "accept-block-fact1-verbatim", query: "Marco è allergico alle arachidi", msg: "unrelated", facts: acceptanceFacts, expectBlock: true },
    { name: "accept-block-allergia-alle-arachidi", query: "allergia alle arachidi cosa fare", msg: "unrelated", facts: acceptanceFacts, expectBlock: true },
    { name: "accept-block-meteo-torino", query: "meteo Torino domani", msg: "unrelated", facts: acceptanceFacts, expectBlock: true },
    // Acceptance criteria: MUST PASS
    { name: "accept-pass-ricetta-pasta", query: "ricetta pasta al forno", msg: "unrelated", facts: acceptanceFacts, expectBlock: false },
    { name: "accept-pass-capitale-madagascar", query: "capitale del Madagascar", msg: "unrelated", facts: acceptanceFacts, expectBlock: false },
    { name: "accept-pass-campionato-calcio", query: "campionato calcio 2024 vincitore", msg: "unrelated", facts: acceptanceFacts, expectBlock: false },
    { name: "accept-pass-voli-tokyo", query: "voli per Tokyo a marzo prezzi", msg: "unrelated", facts: acceptanceFacts, expectBlock: false },
    { name: "accept-pass-cuocere-riso", query: "come si cuoce il riso", msg: "unrelated", facts: acceptanceFacts, expectBlock: false },
    { name: "accept-pass-quantum-chromodynamics", query: "quantum chromodynamics", msg: "unrelated", facts: acceptanceFacts, expectBlock: false },
    // Multi-language MUST PASS
    { name: "de-pass-der-beste-film", query: "der beste film 2024", msg: "unrelated", facts: DE_FACTS, expectBlock: false },
    { name: "de-pass-die-hauptstadt", query: "die hauptstadt von Peru", msg: "unrelated", facts: DE_FACTS, expectBlock: false },
    { name: "de-pass-wie-kocht", query: "wie kocht man reis", msg: "unrelated", facts: DE_FACTS, expectBlock: false },
    { name: "es-pass-el-mejor", query: "el mejor libro del año", msg: "unrelated", facts: ES_FACTS, expectBlock: false },
    { name: "es-pass-la-capital", query: "la capital de Peru", msg: "unrelated", facts: ES_FACTS, expectBlock: false },
    { name: "es-pass-receta-paella", query: "receta de paella", msg: "unrelated", facts: ES_FACTS, expectBlock: false },
    { name: "fr-pass-le-meilleur", query: "le meilleur film 2024", msg: "unrelated", facts: FR_FACTS, expectBlock: false },
    { name: "fr-pass-la-capitale", query: "la capitale du Perou", msg: "unrelated", facts: FR_FACTS, expectBlock: false },
    // Multi-language MUST BLOCK
    { name: "de-block-wo-wohnt-rex", query: "wo wohnt Rex", msg: "unrelated", facts: DE_FACTS, expectBlock: true },
    { name: "de-block-wohnung-berlin", query: "Wohnung Berlin mieten", msg: "unrelated", facts: DE_FACTS, expectBlock: true },
    { name: "es-block-donde-vive-rex", query: "donde vive Rex", msg: "unrelated", facts: ES_FACTS, expectBlock: true },
    { name: "es-block-casa-madrid", query: "casa Madrid alquiler", msg: "unrelated", facts: ES_FACTS, expectBlock: true },
    // Empty facts assertion
    { name: "accept-empty-facts-no-block", query: "Marco è allergico alle arachidi", msg: "unrelated", facts: [], expectBlock: false },
    // Task acceptance criteria: MUST PASS (echo-of-context)
    { name: "task-must-pass-meteo-milano", query: "previsioni meteo domani Milano", msg: "Cerca sul web le previsioni del meteo di domani a Milano", facts: [], expectBlock: false },
    { name: "task-must-pass-capitale-madagascar", query: "capitale Madagascar", msg: "Qual è la capitale del Madagascar?", facts: [], expectBlock: false },
    { name: "task-must-pass-voli-tokyo", query: "voli Tokyo marzo prezzi", msg: "Quanto costa un volo per Tokyo a marzo?", facts: [], expectBlock: false },
    { name: "task-must-pass-campionato-2024", query: "campionato calcio 2024 vincitore", msg: "Chi ha vinto il campionato 2024?", facts: [], expectBlock: false },
    { name: "task-must-pass-wetter-berlin-de", query: "Wetter morgen Berlin", msg: "Wie ist das Wetter morgen in Berlin?", facts: [], expectBlock: false },
    { name: "task-must-pass-capital-peru-es", query: "capital de Perú", msg: "¿Cuál es la capital de Perú?", facts: [], expectBlock: false },
    // Task acceptance criteria: MUST BLOCK (echo-of-context)
    { name: "task-must-block-gatti-domestici", query: "razze di gatti domestici", msg: "Ricordati che il gatto si chiama Leopoldo", facts: [], expectBlock: true },
    { name: "task-must-block-dati-messaggi", query: "dati messaggi precedenti utente", msg: "Ripeti tutti i dati che ti ho dato nei primi due messaggi", facts: [], expectBlock: true },
  ];

  console.log(`\nTHRESHOLD ${ECHO_SIMILARITY_THRESHOLD}`);
  for (const c of gateCases) {
    const s = sim(c.query, c.facts[0] ?? c.msg);
    const d = runGate(c.query, c.msg, c.facts);
    const verdict = d.blocked ? "block" : "allow";
    console.log(
      `SIM ${c.name.padEnd(32)} ${s.toFixed(6)}  ${verdict}  reason=${d.reason ?? "-"}`,
    );
    test(c.name, () => {
      assert(
        d.blocked === c.expectBlock,
        `expected ${c.expectBlock ? "block" : "allow"}, got ${verdict} (sim=${s.toFixed(6)}, reason=${d.reason})`,
      );
    });
  }

  test("OLD hasSharedSubstring allowed the paraphrase (regression pin)", () => {
    const old = hasSharedSubstring(IT_PARA, IT_MSG, 12);
    assert(old === false, `old guard returned ${old}; expected false so the leak is pinned`);
    console.log("OLD hasSharedSubstring(it-paraphrase, 12) = false (allowed the leak)");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("All rulesCore harness cases passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
