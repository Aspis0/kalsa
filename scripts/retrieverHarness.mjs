/**
 * Harness for src/context/retriever.ts — probes, privacy gate, perf, contracts.
 * Compiles with tsc, runs all PASS criteria, exit 0 only if everything passes.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

function compile() {
  const r = spawnSync(
    "npx",
    [
      "tsc",
      "src/context/retriever.ts",
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

function resolveBuiltModule() {
  const candidates = [
    path.join(projectRoot, "scripts/.build/retriever.js"),
    path.join(projectRoot, "scripts/.build/context/retriever.js"),
    path.join(projectRoot, "scripts/.build/src/context/retriever.js"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  console.error("Could not find compiled retriever.js. Tried:\n", candidates.join("\n"));
  process.exit(1);
}

function buildHistory() {
  /** @type {{ turnIndex: number; role: "user" | "assistant"; text: string }[]} */
  const history = [];
  let i = 0;
  const push = (role, text) => {
    history.push({ turnIndex: i++, role, text });
  };

  push("user", "Ciao, come stai oggi? Il tempo sembra un po' nuvoloso.");
  push("assistant", "Sto bene grazie. Anche qui c'è un po' di nuvolo ma non piove.");
  push("user", "Hai preso un caffè stamattina? Io ne ho già fatti due.");
  push("assistant", "Sì, un espresso. Poi ho controllato le email di routine.");
  // FACT 1
  push("user", "A proposito di animali: Il gatto di Marco si chiama Leopoldo.");
  push("assistant", "Che bel nome per un gatto. Leopoldo suona regale.");
  push("user", "Sì, ed è molto pigro. Passa le giornate sul divano.");
  push("assistant", "Classico. Intanto aggiorno lo status del task in corso.");
  // FACT 2
  push("user", "Remember for planning: The project deadline is March 14.");
  push("assistant", "Noted, March 14 is on the calendar. I will set a reminder.");
  push("user", "Ok, e per il weekend? Forse una passeggiata se smette di piovere.");
  push("assistant", "Buona idea. Nel frattempo resto disponibile per le revisioni.");
  // FACT 3
  push("user", "Tra le preferenze di viaggio: Preferisco viaggiare in treno.");
  push("assistant", "Il treno è comodo per lavorare e guardare il paesaggio.");
  push("user", "Esatto. L'aereo mi stanca di più ultimamente.");
  push("assistant", "Capito. Aggiorno anche le note di progetto generiche.");
  // FACT 4
  push("user", "Finanze del team: Il budget è 4500 euro.");
  push("assistant", "Quattromila cinquecento euro: lo segno come tetto massimo.");
  push("user", "Non superarlo senza approvazione. Grazie.");
  push("assistant", "Ricevuto. Procedo con le stime dentro quel limite.");
  // FACT 5
  push("user", "Calendario: La riunione è alle 15:30 in sala B.");
  push("assistant", "Sala B alle 15:30, confermo. Preparerò l'agenda.");
  push("user", "Porta anche i materiali della scorsa sprint review.");
  push("assistant", "Li allego al documento condiviso entro mezzogiorno.");
  // FACT 6
  push("assistant", "By the way for the record: My name is Sofia Rossi.");
  push("user", "Piacere Sofia. Io mi occupo del frontend principalmente.");
  push("assistant", "Ottimo, collaboreremo sui componenti UI.");
  // FACT 7
  push("user", "Promo: Il codice sconto è SAVE20.");
  push("assistant", "SAVE20 applicato nelle note commerciali. Grazie.");
  push("user", "Usalo solo per i clienti trial di questa settimana.");
  // FACT 8
  push("assistant", "Design decision: We decided on the blue color scheme.");
  push("user", "Perfetto, blue scheme. Aggiorno il design system.");
  push("assistant", "Se serve altro filler: il caffè della macchina è finito.");

  // PLANTED SECRET (privacy negative probes) — high salience (digits + fact form)
  push(
    "user",
    "Nota privata: La password del conto è 9314Xyz e non va mai condivisa con nessuno.",
  );
  push("assistant", "Non la ripeterò. Procediamo con altro.");

  // Short fact for MIN_SENTENCE_LEN / merge path
  push("user", "Si chiama Leo. Poi parliamo del resto del piano.");
  // Version + URL facts (dot-splitting protection)
  push(
    "assistant",
    "Release notes: the app version is v2.5.1 and docs live at https://example.com/docs/v2.",
  );
  push("user", "Grazie per il link e il numero di versione.");

  while (history.length < 30) {
    push(
      history.length % 2 === 0 ? "user" : "assistant",
      `Aggiornamento generico numero ${history.length}: tutto procede senza novità rilevanti.`,
    );
  }

  return history;
}

const PROBES = [
  { q: "come si chiama il gatto?", mustInclude: "Leopoldo" },
  { q: "quanto possiamo spendere?", mustInclude: "4500" },
  { q: "when is it due?", mustInclude: "March 14" },
  { q: "preferenze di viaggio?", mustInclude: "treno" },
  { q: "a che ora è la riunione?", mustInclude: "15:30" },
  { q: "what is your name?", mustInclude: "Sofia Rossi" },
  { q: "qual è il codice sconto?", mustInclude: "SAVE20" },
  { q: "which color did we pick?", mustInclude: "blue" },
  { q: "how much is the budget?", mustInclude: "4500" },
  { q: "nome del gatto di Marco", mustInclude: "Leopoldo" },
];

const SECRET_MARKER = "9314Xyz";
const NEGATIVE_QUERIES = [
  "quanto fa due più due?",
  "che tempo fa?",
  "???",
];

function findTargetRank(snippets, keyword) {
  const kw = keyword.toLowerCase();
  for (let r = 0; r < snippets.length; r++) {
    if (String(snippets[r].text).toLowerCase().includes(kw)) return r + 1;
  }
  return null;
}

function padSentence(i) {
  // ~300 char filler sentence with unique token
  const core = `Sentence number ${i} discusses routine status updates about weather coffee meetings and generic project notes without any durable secret facts embedded here deliberately. `;
  let s = core;
  while (s.length < 280) s += "more filler words ";
  return s.slice(0, 300);
}

function buildLargeCorpus(n = 200) {
  /** @type {{ turnIndex: number; role: "user" | "assistant"; text: string }[]} */
  const units = [];
  for (let i = 0; i < n; i++) {
    units.push({
      turnIndex: i,
      role: i % 2 === 0 ? "user" : "assistant",
      text: padSentence(i),
    });
  }
  // Plant one retrievable fact near the end so index path is non-empty
  units.push({
    turnIndex: n,
    role: "user",
    text: "Remember: The project deadline is March 14 and we must ship before then.",
  });
  return units;
}

function rssMb() {
  const mu = process.memoryUsage();
  return mu.rss / (1024 * 1024);
}

async function main() {
  console.log("Compiling retriever.ts …");
  compile();
  const modPath = resolveBuiltModule();
  console.log("Loading", modPath);
  const mod = await import(pathToFileURL(modPath).href);
  const { retrieveRelevant, RetrieverIndex } = mod;
  if (typeof retrieveRelevant !== "function") {
    console.error("retrieveRelevant not exported");
    process.exit(1);
  }
  if (typeof RetrieverIndex !== "function") {
    console.error("RetrieverIndex not exported");
    process.exit(1);
  }

  const history = buildHistory();
  console.log(`History turns: ${history.length}\n`);

  const results = [];
  const record = (name, pass, detail = "") => {
    results.push({ name, pass, detail });
    console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  };

  // --- Original 10 probes ---
  let hits = 0;
  console.log("\n=== Probe results ===");
  console.log(
    "query".padEnd(32),
    "target".padEnd(14),
    "rank".padEnd(6),
    "result",
  );
  for (const p of PROBES) {
    const snips = retrieveRelevant(history, p.q, { topN: 4 });
    const rank = findTargetRank(snips, p.mustInclude);
    const ok = rank !== null;
    if (ok) hits++;
    console.log(
      p.q.slice(0, 30).padEnd(32),
      p.mustInclude.slice(0, 12).padEnd(14),
      (ok ? String(rank) : "MISS").padEnd(6),
      ok ? "PASS" : "FAIL",
    );
  }
  console.log(`\nHits: ${hits}/${PROBES.length} (need ≥ 9)`);
  record("probes ≥9/10", hits >= 9, `${hits}/10`);

  // --- Determinism ---
  const q = "come si chiama il gatto?";
  const a = retrieveRelevant(history, q, { topN: 4 });
  const b = retrieveRelevant(history, q, { topN: 4 });
  const detOk = JSON.stringify(a) === JSON.stringify(b);
  record("determinism (two runs)", detOk);

  // --- F1 privacy / negative probes ---
  let negOk = true;
  for (const nq of NEGATIVE_QUERIES) {
    const snips = retrieveRelevant(history, nq, { topN: 4 });
    const leak = snips.some((s) =>
      String(s.text).toLowerCase().includes(SECRET_MARKER.toLowerCase()),
    );
    if (leak) {
      negOk = false;
      console.log(`  LEAK on "${nq}":`, snips.map((s) => s.text.slice(0, 80)));
    }
  }
  record("F1 privacy gate (no secret on unrelated queries)", negOk);

  // --- Spec-scale perf (INDEX path gates; one-shot reported) ---
  const large = buildLargeCorpus(200);
  const index = new RetrieverIndex();
  const tBuild0 = performance.now();
  index.append(large);
  const buildMs = performance.now() - tBuild0;
  const perfQ = "when is the project deadline March?";
  for (let i = 0; i < 5; i++) index.retrieve(perfQ, { topN: 4 });
  const runs = 30;
  const times = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    index.retrieve(perfQ, { topN: 4 });
    times.push(performance.now() - t0);
  }
  times.sort((x, y) => x - y);
  const avg = times.reduce((s, x) => s + x, 0) / times.length;
  const p95 = times[Math.min(times.length - 1, Math.floor(times.length * 0.95))];
  const indexPerfOk = avg < 20;
  record(
    "F3 index perf avg < 20ms @ 200×~300",
    indexPerfOk,
    `avg ${avg.toFixed(3)} ms, p95 ${p95.toFixed(3)} ms, build ${buildMs.toFixed(1)} ms`,
  );

  // One-shot reference (non-gating)
  const tOne0 = performance.now();
  retrieveRelevant(large, perfQ, { topN: 4 });
  const oneShot = performance.now() - tOne0;
  console.log(`  (ref) one-shot build+retrieve: ${oneShot.toFixed(3)} ms — non-gating`);

  // --- maxChars contract ---
  const maxChars = 80;
  const snMax = retrieveRelevant(history, "come si chiama il gatto?", {
    topN: 4,
    maxCharsPerSnippet: maxChars,
  });
  const maxOk =
    snMax.length > 0 && snMax.every((s) => s.text.length <= maxChars);
  // also default path: no snippet may exceed DEFAULT 240 after F2 (long sentences truncated)
  const snDef = retrieveRelevant(history, "preferenze di viaggio?", { topN: 4 });
  const defOk = snDef.every((s) => s.text.length <= 240);
  // maxChars <= 0 uses default
  const snZero = retrieveRelevant(history, "preferenze di viaggio?", {
    topN: 4,
    maxCharsPerSnippet: 0,
  });
  const zeroOk = snZero.every((s) => s.text.length <= 240);
  record(
    "F2 maxCharsPerSnippet enforced",
    maxOk && defOk && zeroOk,
    `max80 all≤80=${maxOk}, default≤240=${defOk}, zero→default=${zeroOk}`,
  );

  // --- Short fact ---
  const shortSnips = retrieveRelevant(history, "come si chiama?", { topN: 6 });
  const shortOk = shortSnips.some((s) =>
    /leo/i.test(s.text),
  );
  record("F5 short fact 'Si chiama Leo.' retrievable", shortOk, `top texts: ${shortSnips.map((s) => s.text.slice(0, 40)).join(" | ")}`);

  // --- Version + URL survive ---
  const verSnips = retrieveRelevant(history, "what app version is it?", {
    topN: 6,
  });
  const verOk = verSnips.some((s) => s.text.includes("2.5.1"));
  const urlSnips = retrieveRelevant(history, "where are the docs link example.com?", {
    topN: 6,
  });
  const urlOk = urlSnips.some((s) => /example\.com/i.test(s.text));
  record("F6 version v2.5.1 retrievable intact", verOk);
  record("F6 URL example.com retrievable intact", urlOk);

  // --- Duplicate turnIndex determinism ---
  const dupHistory = [
    { turnIndex: 0, role: "user", text: "Alpha fact: the gatto is named Whiskers and lives upstairs." },
    { turnIndex: 0, role: "assistant", text: "Beta fact: the budget is exactly 1200 euro for tools." },
    { turnIndex: 0, role: "user", text: "Gamma filler about the weather and coffee again today." },
  ];
  const d1 = retrieveRelevant(dupHistory, "what is the budget euro?", { topN: 3 });
  const d2 = retrieveRelevant(dupHistory, "what is the budget euro?", { topN: 3 });
  const dupOk = JSON.stringify(d1) === JSON.stringify(d2);
  record("F7 duplicate turnIndex → deterministic", dupOk);

  // --- 100 sequential retrieve on one index: stable + RSS not unbounded ---
  const idx2 = new RetrieverIndex();
  idx2.append(history);
  const rss0 = rssMb();
  const tSeq = [];
  for (let i = 0; i < 100; i++) {
    const t0 = performance.now();
    idx2.retrieve("come si chiama il gatto?", { topN: 4 });
    tSeq.push(performance.now() - t0);
  }
  const rss1 = rssMb();
  const avgSeq = tSeq.reduce((s, x) => s + x, 0) / tSeq.length;
  // Rough: RSS growth under 30MB for 100 identical retrieves (should be ~flat)
  const rssGrowth = rss1 - rss0;
  const memOk = rssGrowth < 30;
  const seqTimingOk = avgSeq < 20;
  record(
    "100× retrieve on one index (timing+RSS)",
    memOk && seqTimingOk,
    `avg ${avgSeq.toFixed(3)} ms, RSS ${rss0.toFixed(1)}→${rss1.toFixed(1)} MB (Δ ${rssGrowth.toFixed(1)})`,
  );

  // --- Edge cases smoke ---
  const edges = [
    retrieveRelevant([], "hello"),
    retrieveRelevant(history, ""),
    retrieveRelevant(history, "   "),
    retrieveRelevant(null, "x"),
    retrieveRelevant(history, null),
  ];
  const edgeOk = edges.every((e) => Array.isArray(e) && e.length === 0);
  record("edge cases → []", edgeOk);

  const allPass = results.every((r) => r.pass);
  console.log("\n=== Summary ===");
  for (const r of results) {
    console.log(`  ${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.detail ? " — " + r.detail : ""}`);
  }
  console.log(`\n=== OVERALL: ${allPass ? "PASS" : "FAIL"} ===`);
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
