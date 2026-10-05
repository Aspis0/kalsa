// The ported miniapp domain: the six builders, the no-eval calculator and the
// miniapp_v1 normalizer, against the phone's own cases. Pure: no server, no
// browser, no network. The real TypeScript is compiled by lib/app-bundle.mjs,
// never copied (a JavaScript copy would test the copy).
//
// Run: node scripts/miniapp-domain.mjs   (from chat/)

import { rm } from "node:fs/promises";
import { loadApp } from "./lib/app-bundle.mjs";

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}
function equal(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`);
}

const { app, dir } = await loadApp();
try {
  const { buildMiniappV1, evaluateCalculatorFormula, normalizeMiniapp, MINIAPP_TEMPLATE_IDS, runCreateMiniapp } = app;

  // ── compare_data ──────────────────────────────────────────────────────────
  {
    const miniapp = buildMiniappV1("compare_data", {
      title: "Plan comparison",
      columns: ["Free", "Pro"],
      rows: [
        { storage: "5 GB", price: "$0" },
        { storage: "100 GB", price: "$10" },
      ],
    });
    check("compare_data builds a data_table", miniapp !== null);
    equal("compare_data keeps schema/kind/title", [miniapp?.schema, miniapp?.kind, miniapp?.title], ["miniapp_v1", "compare_data", "Plan comparison"]);
    equal("compare_data columns survive", miniapp?.blocks[0].columns, ["Free", "Pro"]);
    equal("compare_data rows survive", miniapp?.blocks[0].rows, [{ storage: "5 GB", price: "$0" }, { storage: "100 GB", price: "$10" }]);
    equal("compare_data rejects missing/empty columns", [
      buildMiniappV1("compare_data", { rows: [] }),
      buildMiniappV1("compare_data", { columns: [] }),
      buildMiniappV1("compare_data", { columns: "nope" }),
    ], [null, null, null]);
    equal("compare_data rejects non-array rows", buildMiniappV1("compare_data", { columns: ["a"], rows: {} }), null);
    const noRows = buildMiniappV1("compare_data", { columns: ["a"] });
    check("compare_data without rows omits the rows field", noRows !== null && !("rows" in noRows.blocks[0]));
  }

  // ── quick_calculator ──────────────────────────────────────────────────────
  {
    const miniapp = buildMiniappV1("quick_calculator", {
      formula: "a + b * 0.1",
      fields: [
        { id: "a", label: "Principal", value: 1000 },
        { id: "b", label: "Rate", value: 5 },
      ],
    });
    check("quick_calculator builds a calculator", miniapp !== null && miniapp.blocks[0].type === "calculator");
    check("quick_calculator keeps its fields", Array.isArray(miniapp?.blocks[0].fields));
    check("quick_calculator accepts a bare arithmetic formula", buildMiniappV1("quick_calculator", { formula: "2 + 3 * 4" }) !== null);
    equal("quick_calculator rejects missing formula", [
      buildMiniappV1("quick_calculator", { fields: [] }),
      buildMiniappV1("quick_calculator", {}),
    ], [null, null]);
    equal("quick_calculator rejects invalid formulas", [
      buildMiniappV1("quick_calculator", { formula: "a + " }),
      buildMiniappV1("quick_calculator", { formula: "a @ b" }),
      buildMiniappV1("quick_calculator", { formula: "x + 1", fields: [{ id: "a", label: "A", value: 1 }] }),
    ], [null, null, null]);
    equal("quick_calculator rejects empty or duplicate field ids", [
      buildMiniappV1("quick_calculator", { formula: "a + b", fields: [{ label: "A", value: 1 }] }),
      buildMiniappV1("quick_calculator", {
        formula: "a + b",
        fields: [{ id: "a", label: "A", value: 1 }, { id: "a", label: "A2", value: 2 }],
      }),
    ], [null, null]);
    const fields24 = Array.from({ length: 24 }, (_, i) => ({ id: `f${i}`, label: `F${i}`, value: i }));
    const fields25 = Array.from({ length: 25 }, (_, i) => ({ id: `f${i}`, label: `F${i}`, value: i }));
    check("quick_calculator accepts the 24-field cap", buildMiniappV1("quick_calculator", { formula: "f0 + f23", fields: fields24 }) !== null);
    equal("quick_calculator rejects a field past the renderer's cap", buildMiniappV1("quick_calculator", { formula: "f0 + f24", fields: fields25 }), null);
  }

  // ── reading_quiz ──────────────────────────────────────────────────────────
  {
    const miniapp = buildMiniappV1("reading_quiz", {
      title: "Geo quiz",
      questions: [
        { question: "Capital of France?", options: ["Berlin", "Paris", "Rome"], answerIndex: 1 },
        { question: "2+2?", options: ["3", "4"], answerIndex: 1 },
      ],
    });
    equal("reading_quiz emits one quiz block per question", [miniapp?.blocks.length, miniapp?.blocks[0].type, miniapp?.blocks[0].question, miniapp?.blocks[0].options, miniapp?.blocks[0].answerIndex], [2, "quiz", "Capital of France?", ["Berlin", "Paris", "Rome"], 1]);
    const eight = Array.from({ length: 8 }, (_, i) => ({ question: `Q${i}`, options: ["A", "B"] }));
    check("reading_quiz accepts the 8-question cap", buildMiniappV1("reading_quiz", { questions: eight })?.blocks.length === 8);
    const nine = Array.from({ length: 9 }, (_, i) => ({ question: `Q${i}`, options: ["A", "B"] }));
    equal("reading_quiz rejects 0 questions", buildMiniappV1("reading_quiz", { questions: [] }), null);
    equal("reading_quiz rejects 9 questions", buildMiniappV1("reading_quiz", { questions: nine }), null);
    equal("reading_quiz rejects fewer than 2 options", buildMiniappV1("reading_quiz", { questions: [{ question: "Q?", options: ["A"] }] }), null);
    equal("reading_quiz rejects more than 4 options", buildMiniappV1("reading_quiz", { questions: [{ question: "Q?", options: ["A", "B", "C", "D", "E"], answerIndex: 4 }] }), null);
    equal("reading_quiz rejects a question missing its text", buildMiniappV1("reading_quiz", { questions: [{ options: ["A", "B"] }] }), null);
    equal("reading_quiz rejects a non-array questions value", buildMiniappV1("reading_quiz", { questions: "nope" }), null);
    const outOfRange = buildMiniappV1("reading_quiz", {
      questions: [
        { question: "Q1?", options: ["A", "B"], answerIndex: 5 },
        { question: "Q2?", options: ["A", "B"], answerIndex: 0 },
      ],
    });
    equal("reading_quiz disables grading per out-of-range question", [outOfRange?.blocks[0].answerIndex, outOfRange?.blocks[1].answerIndex], [null, 0]);
  }

  // ── kpi_strip ─────────────────────────────────────────────────────────────
  {
    const miniapp = buildMiniappV1("kpi_strip", {
      title: "Q3 metrics",
      metrics: [
        { label: "Revenue", value: 12000, unit: "€" },
        { label: "Growth", value: "12%", tone: "positive" },
      ],
    });
    equal("kpi_strip builds a metric_strip", [miniapp?.kind, miniapp?.blocks[0].type], ["kpi_strip", "metric_strip"]);
    equal("kpi_strip keeps metrics whole", miniapp?.blocks[0].metrics, [{ label: "Revenue", value: 12000, unit: "€" }, { label: "Growth", value: "12%", tone: "positive" }]);
    const nine = Array.from({ length: 9 }, (_, i) => ({ label: `L${i}`, value: i }));
    equal("kpi_strip rejects 0/>8 metrics and missing label or value", [
      buildMiniappV1("kpi_strip", { metrics: [] }),
      buildMiniappV1("kpi_strip", { metrics: [{ value: "x" }] }),
      buildMiniappV1("kpi_strip", { metrics: [{ label: "L" }] }),
      buildMiniappV1("kpi_strip", { metrics: nine }),
    ], [null, null, null, null]);
  }

  // ── checklist ─────────────────────────────────────────────────────────────
  {
    const miniapp = buildMiniappV1("checklist", { title: "Setup", steps: ["Install", "Configure", "Launch"] });
    equal("checklist builds timeline steps from string[]", [miniapp?.kind, miniapp?.blocks[0].type, miniapp?.blocks[0].steps], ["checklist", "timeline", [{ title: "Install" }, { title: "Configure" }, { title: "Launch" }]]);
    const promoted = buildMiniappV1("checklist", {
      items: [{ title: "Step 1", body: "do it" }, { body: "Only body" }, "plain step"],
    });
    equal("checklist promotes body and drops it", promoted?.blocks[0].steps, [{ title: "Step 1" }, { title: "Only body" }, { title: "plain step" }]);
    const thirteen = Array.from({ length: 13 }, (_, i) => `S${i}`);
    equal("checklist rejects more than 12 steps", buildMiniappV1("checklist", { steps: thirteen }), null);
    equal("checklist rejects empty and title-less steps", [
      buildMiniappV1("checklist", { steps: [] }),
      buildMiniappV1("checklist", { steps: [{}] }),
      buildMiniappV1("checklist", {}),
    ], [null, null, null]);
  }

  // ── pros_cons ─────────────────────────────────────────────────────────────
  {
    const miniapp = buildMiniappV1("pros_cons", {
      title: "Choice",
      rows: [{ pro: "Fast", con: "Expensive" }, { pro: "Simple" }],
    });
    equal("pros_cons builds a data_table with english headers", [miniapp?.kind, miniapp?.blocks[0].columns], ["pros_cons", [{ key: "pro", label: "Pro" }, { key: "con", label: "Con" }]]);
    equal("pros_cons keeps an empty con cell", miniapp?.blocks[0].rows, [{ pro: "Fast", con: "Expensive" }, { pro: "Simple", con: "" }]);
    equal("pros_cons rejects empty rows and non-array input", [
      buildMiniappV1("pros_cons", { rows: [] }),
      buildMiniappV1("pros_cons", { rows: [{ pro: "" }, { con: "" }, {}] }),
      buildMiniappV1("pros_cons", { rows: "nope" }),
    ], [null, null, null]);
    equal("pros_cons reads rows[], not top-level pro/con", buildMiniappV1("pros_cons", { pro: "a", con: "b" }), null);
  }

  // ── the shared bounds ─────────────────────────────────────────────────────
  {
    equal("an unknown template is null", buildMiniappV1("not_a_template", {}), null);
    const overCap = "x".repeat(5000); // > MAX_SLOT_CHARS (4000)
    equal("an oversized required field rejects the build", [
      buildMiniappV1("reading_quiz", { questions: [{ question: overCap, options: ["A", "B"] }] }),
      buildMiniappV1("checklist", { steps: [overCap] }),
    ], [null, null]);
    check("a normal checklist still builds", buildMiniappV1("checklist", { steps: ["One", "Two", "Three"] }) !== null);
    const big = "x".repeat(4000);
    const twelve = Array.from({ length: 12 }, () => ({ pro: big, con: big }));
    check("a block past 64 KiB rejects the whole build", buildMiniappV1("pros_cons", { rows: twelve }) === null);
    equal("the schema enum names the six templates", MINIAPP_TEMPLATE_IDS, ["compare_data", "quick_calculator", "reading_quiz", "kpi_strip", "checklist", "pros_cons"]);
  }

  // ── the calculator (no eval, no Function) ─────────────────────────────────
  {
    equal("precedence and parentheses", [evaluateCalculatorFormula("2+3*4", {}), evaluateCalculatorFormula("(2+3)*4", {})], [{ ok: true, value: 14 }, { ok: true, value: 20 }]);
    equal("field ids substitute from vars", evaluateCalculatorFormula("a+b", { a: 2, b: 3 }), { ok: true, value: 5 });
    equal("negative variables and subtraction", [evaluateCalculatorFormula("a-2", { a: -3 }), evaluateCalculatorFormula("a+b", { a: -3, b: 1 })], [{ ok: true, value: -5 }, { ok: true, value: -2 }]);
    equal("division by zero is refused", evaluateCalculatorFormula("1/0", {}), { ok: false, reason: "divzero" });
    equal("a non-finite result is refused", evaluateCalculatorFormula("9e999", {}), { ok: false, reason: "unsupported" });
    equal("unsupported characters and length are refused", [
      evaluateCalculatorFormula("abs(2)", {}),
      evaluateCalculatorFormula("x^2", {}),
      evaluateCalculatorFormula("9".repeat(201), {}),
    ], [{ ok: false, reason: "unsupported" }, { ok: false, reason: "unsupported" }, { ok: false, reason: "unsupported" }]);
    equal("an unsubstituted identifier is refused", evaluateCalculatorFormula("total + 1", {}), { ok: false, reason: "unsupported" });
    equal("a member expression is refused", evaluateCalculatorFormula("a.constructor", { a: 1 }), { ok: false, reason: "unsupported" });
    check("nesting past the depth cap is refused", evaluateCalculatorFormula("(".repeat(21) + "1" + ")".repeat(21), {}).ok === false);
    check("nesting at the depth cap is accepted", evaluateCalculatorFormula("(".repeat(20) + "1" + ")".repeat(20), {}).ok === true);
  }

  // ── the normalizer ────────────────────────────────────────────────────────
  {
    const envelope = (blocks) => ({ schema: "miniapp_v1", kind: "miniapp", title: "T", blocks });
    const capped = normalizeMiniapp(envelope(Array.from({ length: 40 }, (_, i) => ({ type: "table", id: String(i) }))));
    equal("a valid envelope is kept and blocks cap at 24", [capped?.schema, capped?.blocks.length], ["miniapp_v1", 24]);
    equal("a missing kind/title/blocks is null", [
      normalizeMiniapp({ schema: "miniapp_v1", blocks: [{ type: "table" }] }),
      normalizeMiniapp({ kind: "miniapp" }),
      normalizeMiniapp("not an object"),
      normalizeMiniapp(null),
    ], [null, null, null, null]);
    const quiz = normalizeMiniapp(envelope([{ type: "quiz", question: "Q?", options: ["A", "B"], answerIndex: 5 }]));
    equal("an out-of-range answerIndex never defaults to 0", quiz?.blocks[0].answerIndex, null);
    const notQuiz = normalizeMiniapp(envelope([{ type: "quiz", question: "Q?", options: ["A"] }]));
    equal("a single-option quiz is not gradable", notQuiz?.blocks[0].answerIndex, null);
    equal("question and kind are clipped", [
      normalizeMiniapp(envelope([{ type: "quiz", question: "q".repeat(600), options: ["A", "B"] }]))?.blocks[0].question.length,
      normalizeMiniapp({ schema: "miniapp_v1", kind: "k".repeat(200), title: "T", blocks: [] })?.kind.length,
    ], [500, 100]);
    const oversized = normalizeMiniapp(envelope([{ type: "data_table", blob: "x".repeat(65 * 1024) }]));
    equal("a block past 64 KiB degrades to unknown", oversized?.blocks[0], { type: "unknown" });
    const legacy = normalizeMiniapp({ schema: "aspis_miniapp_v1", kind: "miniapp", title: "T", blocks: [] });
    check("the legacy schema name is accepted", legacy !== null && legacy.schema === "miniapp_v1");
  }

  // ── the tool executor ─────────────────────────────────────────────────────
  {
    const ok = runCreateMiniapp({
      template: "reading_quiz",
      slots: { title: "My Quiz", questions: [{ question: "Q?", options: ["A", "B"], answerIndex: 0 }] },
    });
    check("a good call is ok and carries the miniapp", ok.ok === true && ok.miniapp?.kind === "reading_quiz" && ok.miniapp?.blocks[0].type === "quiz");
    equal("a good call answers with the phone's created text", ok.text, "Miniapp created: My Quiz");
    const badSlots = runCreateMiniapp({ template: "compare_data", slots: { columns: [] } });
    check("bad slots are not ok and carry no miniapp", badSlots.ok === false && badSlots.miniapp === undefined);
    equal("bad slots answer with the phone's text", badSlots.text, "create_miniapp could not build the miniapp from the slots you provided.");
    const badTemplate = runCreateMiniapp({ template: "bogus" });
    check("an unknown template is refused by name", badTemplate.ok === false && badTemplate.text.includes('"bogus"') && badTemplate.text.includes("compare_data"));
    const missing = runCreateMiniapp({});
    check("a missing template is refused with a dash", missing.text.includes('"—"'), missing.text);
    const pros = runCreateMiniapp({ template: "pros_cons", slots: { rows: [{ pro: "fast", con: "costoso" }] } });
    equal("the desktop keeps the phone's english headers", pros.miniapp?.blocks[0].columns, [{ key: "pro", label: "Pro" }, { key: "con", label: "Con" }]);
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}
console.log(failures === 0 ? "ALL MINIAPP DOMAIN CHECKS PASS" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
