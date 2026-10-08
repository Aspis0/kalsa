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
  const { buildMiniappV1, evaluateCalculatorFormula, normalizeMiniapp, MINIAPP_TEMPLATE_IDS, runCreateMiniapp, checklistItems, isItemTicked, toggleChecklistItem, quizAnswer, recordQuizAnswer, calculatorValues, calculatorResult, recordCalculatorValues, miniappStateLines, parseLocaleNumber } = app;

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
      formula: "a + b",
      fields: [
        { id: "a", label: "Principal", value: 1000 },
        { id: "b", label: "Rate", value: 5 },
      ],
    });
    check("quick_calculator builds a calculator", miniapp !== null && miniapp.blocks[0].type === "calculator");
    equal("referenced fields are kept whole", miniapp?.blocks[0].fields, [{ id: "a", label: "Principal", value: 1000 }, { id: "b", label: "Rate", value: 5 }]);
    check("quick_calculator accepts a bare arithmetic formula", buildMiniappV1("quick_calculator", { formula: "2 + 3 * 4" }) !== null);
    const comma = buildMiniappV1("quick_calculator", { formula: "a * b", fields: [{ id: "a", value: "12,5" }, { id: "b", value: 2 }] });
    equal("a comma-decimal string field value parses", comma?.state, { calculator: { fields: { a: 12.5, b: 2 }, result: 25 } });
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
    check("quick_calculator accepts the 24-field cap", buildMiniappV1("quick_calculator", { formula: fields24.map((f) => f.id).join(" + "), fields: fields24 }) !== null);
    equal("quick_calculator rejects a field past the renderer's cap", buildMiniappV1("quick_calculator", { formula: fields25.map((f) => f.id).join(" + "), fields: fields25 }), null);

    // The fields decide what bare numbers mean: none given, they lift into
    // editable fields; fields given, the formula must speak in field ids.
    const lifted = buildMiniappV1("quick_calculator", { title: "Split", formula: "50 / 4" });
    equal("with no fields a literal formula lifts into editable fields", [lifted?.blocks[0].formula, lifted?.blocks[0].fields], ["n1 / n2", [{ id: "n1", value: 50 }, { id: "n2", value: 4 }]]);
    equal("the lifted calculator seeds its state", lifted?.state, { calculator: { fields: { n1: 50, n2: 4 }, result: 12.5 } });
    equal("more literals than the field cap rejects the lift", buildMiniappV1("quick_calculator", { formula: Array.from({ length: 25 }, (_, i) => `${i}+`).join("") + "1" }), null);
    const named = buildMiniappV1("quick_calculator", { formula: "2 + 2", fields: [] });
    equal("a lifted id never collides with a provided one", named?.blocks[0].formula, "n1 + n2");
    const substitute = buildMiniappV1("quick_calculator", {
      formula: "50 / 4",
      fields: [
        { id: "a", label: "Valore iniziale", value: 50 },
        { id: "b", label: "Divisore", value: 4 },
      ],
    });
    equal("a literal equal to a field's value substitutes the id", [substitute?.blocks[0].formula, substitute?.blocks[0].fields.map((field) => field.id)], ["a / b", ["a", "b"]]);
    equal("the substituted calculator seeds the same state", substitute?.state, { calculator: { fields: { a: 50, b: 4 }, result: 12.5 } });
    const vat = buildMiniappV1("quick_calculator", { formula: "amount * 1.22", fields: [{ id: "amount", label: "Amount", value: 100 }] });
    equal("a literal matching no field stays a constant", [vat?.blocks[0].formula, vat?.state], ["amount * 1.22", { calculator: { fields: { amount: 100 }, result: 122 } }]);
    const vatField = buildMiniappV1("quick_calculator", { formula: "amount * 1.22", fields: [{ id: "amount", value: 100 }, { id: "vat", value: 1.22 }] });
    equal("a constant's equal field is substituted when free", vatField?.blocks[0].formula, "amount * vat");
    const prefer = buildMiniappV1("quick_calculator", { formula: "a + 4", fields: [{ id: "a", value: 4 }, { id: "b", value: 4 }] });
    equal("substitution prefers a field the formula does not mention yet", [prefer?.blocks[0].formula, prefer?.state], ["a + b", { calculator: { fields: { a: 4, b: 4 }, result: 8 } }]);
    const referenced = buildMiniappV1("quick_calculator", { formula: "a + 4", fields: [{ id: "a", value: 4 }] });
    equal("a referenced field is never substituted again", referenced?.blocks[0].formula, "a + 4");
    const negative = buildMiniappV1("quick_calculator", { formula: "-5 * quantity", fields: [{ id: "discount", value: -5 }, { id: "quantity", value: 3 }] });
    equal("a unary-minus literal matches a negative field", [negative?.blocks[0].formula, negative?.state], ["discount * quantity", { calculator: { fields: { discount: -5, quantity: 3 }, result: -15 } }]);
    const negativeConstant = buildMiniappV1("quick_calculator", { formula: "0 - 5 * quantity", fields: [{ id: "quantity", value: 3 }] });
    equal("a binary-minus literal is a positive constant", [negativeConstant?.blocks[0].formula, negativeConstant?.state], ["0 - 5 * quantity", { calculator: { fields: { quantity: 3 }, result: -15 } }]);
    equal("a bare literal beside fields stays a constant and builds", buildMiniappV1("quick_calculator", { formula: "a + 50 * .5", fields: [{ id: "a", label: "A", value: 1 }] })?.state, { calculator: { fields: { a: 1 }, result: 26 } });
    equal("an unknown id beside fields is refused", buildMiniappV1("quick_calculator", { formula: "a / x", fields: [{ id: "a", value: 1 }] }), null);
    equal("a dead field is refused", buildMiniappV1("quick_calculator", { formula: "a / b", fields: [{ id: "a", value: 1 }, { id: "b", value: 2 }, { id: "c", value: 3 }] }), null);
    equal("a digit inside an identifier is not a literal", buildMiniappV1("quick_calculator", { formula: "f0 + f1", fields: [{ id: "f0", value: 1 }, { id: "f1", value: 2 }] })?.blocks[0].formula, "f0 + f1");
    equal("an identifier-only formula is untouched", buildMiniappV1("quick_calculator", { formula: "a + b", fields: [{ id: "a", label: "A", value: 1 }, { id: "b", label: "B", value: 2 }] })?.blocks[0].formula, "a + b");
    const owner = runCreateMiniapp({
      template: "quick_calculator",
      slots: {
        formula: "50 / 4",
        fields: [
          { id: "start", label: "Valore iniziale", value: 60 },
          { id: "div", label: "Divisore", value: 4 },
        ],
      },
    });
    equal("the owner's case is still refused, by the dead field", [owner.ok, owner.miniapp], [false, undefined]);
    check("the owner's case refuses with the dead field named", owner.text.includes("the field start is not used"), owner.text);
    const unknownId = runCreateMiniapp({
      template: "quick_calculator",
      slots: { formula: "a / x", fields: [{ id: "a", value: 1 }] },
    });
    check("an unknown id refuses with the id named", unknownId.ok === false && unknownId.text.includes("references x"), unknownId.text);
  }

  // ── the numbers a person types, in the interface's language ───────────────
  {
    equal("Italian reads dot-groups and comma decimals", [
      parseLocaleNumber("12.500", "it"),
      parseLocaleNumber("1.234,5", "it"),
      parseLocaleNumber("12,5", "it"),
      parseLocaleNumber("1.234", "it"),
    ], [12500, 1234.5, 12.5, 1234]);
    equal("English reads comma-groups and dot decimals", [
      parseLocaleNumber("1,234.5", "en"),
      parseLocaleNumber("1,234", "en"),
      parseLocaleNumber("12.5", "en"),
    ], [1234.5, 1234, 12.5]);
    equal("a lone wrong-kind separator is forgiven as a decimal", [
      parseLocaleNumber("12.5", "it"),
      parseLocaleNumber("0,5", "en"),
    ], [12.5, 0.5]);
    equal("one repeated separator groups when the threes line up", [
      parseLocaleNumber("1.234.567", "it"),
      parseLocaleNumber("1,234,567", "en"),
      parseLocaleNumber("-1.234.567", "it"),
      parseLocaleNumber("1.23.456", "it"),
    ], [1234567, 1234567, -1234567, Number.NaN]);
    equal("signs, integers and nonsense", [
      parseLocaleNumber("-5", "it"),
      parseLocaleNumber("+7", "en"),
      parseLocaleNumber("1,2,3", "it"),
      parseLocaleNumber("12.", "en"),
      parseLocaleNumber("", "it"),
      parseLocaleNumber("abc", "en"),
    ], [-5, 7, Number.NaN, 12, Number.NaN, Number.NaN]);
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

  // ── the retired templates ─────────────────────────────────────────────────
  {
    equal("kpi_strip and pros_cons no longer build", [
      buildMiniappV1("kpi_strip", { title: "Q3 metrics", metrics: [{ label: "Revenue", value: 12000, unit: "€" }] }),
      buildMiniappV1("pros_cons", { title: "Choice", rows: [{ pro: "Fast", con: "Expensive" }] }),
    ], [null, null]);
  }

  // ── checklist ─────────────────────────────────────────────────────────────
  {
    const miniapp = buildMiniappV1("checklist", { title: "Setup", steps: ["Install", "Configure", "Launch"] });
    equal("checklist builds tickable items with minted ids", [miniapp?.kind, miniapp?.blocks[0].type, miniapp?.blocks[0].items], ["checklist", "checklist", [{ id: "item-1", title: "Install" }, { id: "item-2", title: "Configure" }, { id: "item-3", title: "Launch" }]]);
    const provided = buildMiniappV1("checklist", { items: [{ id: "milk", title: "Buy milk" }, { title: "No id" }, "plain step"] });
    equal("checklist keeps provided ids and mints the rest", provided?.blocks[0].items, [{ id: "milk", title: "Buy milk" }, { id: "item-1", title: "No id" }, { id: "item-2", title: "plain step" }]);
    const colliding = buildMiniappV1("checklist", { items: [{ id: "item-1", title: "A" }, { id: "item-1", title: "B" }] });
    equal("checklist replaces a colliding id with a minted one", colliding?.blocks[0].items.map((item) => item.id), ["item-1", "item-2"]);
    const unsafeIds = buildMiniappV1("checklist", { items: [{ id: "__proto__", title: "A" }, { id: "constructor", title: "B" }, { id: "x".repeat(65), title: "C" }] });
    equal("checklist mints over unsafe and over-cap ids", unsafeIds?.blocks[0].items.map((item) => item.id), ["item-1", "item-2", "item-3"]);
    equal("quick_calculator rejects unsafe and over-cap field ids", [
      buildMiniappV1("quick_calculator", { formula: "1", fields: [{ id: "constructor", value: 1 }] }),
      buildMiniappV1("quick_calculator", { formula: "1", fields: [{ id: "x".repeat(65), value: 1 }] }),
    ], [null, null]);
    const bounded = normalizeMiniapp({ schema: "miniapp_v1", kind: "checklist", title: "T", blocks: [{ type: "checklist", items: [{ id: "a", title: "A" }] }], state: { blob: "x".repeat(70 * 1024) } });
    check("a state past the 64 KiB guard is dropped, not the envelope", bounded?.blocks[0].items?.[0]?.title === "A" && bounded.state === undefined);
    const promoted = buildMiniappV1("checklist", {
      items: [{ title: "Step 1", body: "do it" }, { body: "Only body" }, "plain step"],
    });
    equal("checklist promotes body and drops it", promoted?.blocks[0].items.map((item) => item.title), ["Step 1", "Only body", "plain step"]);
    const thirteen = Array.from({ length: 13 }, (_, i) => `S${i}`);
    equal("checklist rejects more than 12 steps", buildMiniappV1("checklist", { steps: thirteen }), null);
    equal("checklist rejects empty and title-less steps", [
      buildMiniappV1("checklist", { steps: [] }),
      buildMiniappV1("checklist", { steps: [{}] }),
      buildMiniappV1("checklist", {}),
    ], [null, null, null]);
  }

  // ── the state the widgets write through ───────────────────────────────────
  {
    equal("toggling ticks and unticks by id", [
      isItemTicked(toggleChecklistItem({}, "a", true), "a"),
      isItemTicked(toggleChecklistItem({ checked: { a: true } }, "a", false), "a"),
    ], [true, false]);
    equal("unticking removes the key instead of storing false", toggleChecklistItem({ checked: { a: true } }, "a", false), { checked: {} });
    equal("checklistItems resolves ids; old steps fall back to the index", [
      checklistItems({ items: [{ id: "milk", title: "Milk" }, { title: "Eggs" }] }),
      checklistItems({ steps: [{ title: "One" }, { title: "Two" }] }),
    ], [
      [{ id: "milk", title: "Milk" }, { id: "1", title: "Eggs" }],
      [{ id: "0", title: "One" }, { id: "1", title: "Two" }],
    ]);
    equal("checklistItems skips entries without a title", checklistItems({ items: [{ id: "x" }, "nope", { title: "Kept" }] }), [{ id: "2", title: "Kept" }]);
    const answered = recordQuizAnswer({}, 1, 0, true, false);
    equal("a quiz answer stores picked, checked and correct", quizAnswer(answered, 1), { picked: 0, checked: true, correct: false });
    equal("a retry clears the answer", quizAnswer(recordQuizAnswer(answered, 1, null, false, false), 1), null);
    const calc = recordCalculatorValues({}, { p: 2000, r: 0.05 }, 100);
    equal("calculator state keeps fields and result", [calculatorValues(calc), calculatorResult(calc)], [{ p: 2000, r: 0.05 }, 100]);
    equal("a result that is not a finite number is left out", calculatorResult(recordCalculatorValues({}, { p: 1 }, null)), null);
    equal("calculator readers answer null on state without numbers", [calculatorValues({}), calculatorResult({ calculator: { fields: { x: "nope" } } })], [null, null]);
  }

  // ── the state on the wire ─────────────────────────────────────────────────
  {
    const built = buildMiniappV1("quick_calculator", {
      title: "Loan",
      formula: "p * r",
      fields: [
        { id: "p", label: "Principal", value: 1000 },
        { id: "r", label: "Rate", value: 0.05 },
      ],
    });
    equal("a built calculator seeds its state", built?.state, { calculator: { fields: { p: 1000, r: 0.05 }, result: 50 } });
    equal("the seeded values read back", [calculatorValues(built?.state), calculatorResult(built?.state)], [{ p: 1000, r: 0.05 }, 50]);
    const lines = (state, blocks, kind = "k") => miniappStateLines({ schema: "miniapp_v1", kind, title: "T", blocks, ...(state ? { state } : {}) });
    const checklist = { type: "checklist", items: [{ id: "milk", title: "Milk" }, { id: "eggs", title: "Eggs" }] };
    equal("checklist ticks ride as [x]/[ ] lines", lines({ checked: { milk: true } }, [checklist]), ["[x] Milk", "[ ] Eggs"]);
    equal("an old timeline block under kind checklist ticks by index", lines({ checked: { "0": true } }, [{ type: "timeline", steps: [{ title: "One" }, { title: "Two" }] }], "checklist"), ["[x] One", "[ ] Two"]);
    equal("a timeline under any other kind is not a checklist", lines({ checked: { "0": true } }, [{ type: "timeline", steps: [{ title: "One" }] }], "timeline"), []);
    equal("no state means no lines", lines(undefined, [checklist]), ["[ ] Milk", "[ ] Eggs"]);
    equal("a title with a newline cannot forge a state line", lines({ checked: { a: true } }, [{ type: "checklist", items: [{ id: "a", title: "Milk\n[x] fake" }] }]), ["[x] Milk [x] fake"]);
    const quiz = { type: "quiz", question: "2+2?", options: ["3", "4"], answerIndex: 1 };
    equal("a checked quiz answer says its grade", lines({ quiz: { "0": { picked: 1, checked: true, correct: true } } }, [quiz]), ["Q: 2+2? picked: 4 (correct)"]);
    equal("an unchecked pick says nothing about correctness", lines({ quiz: { "0": { picked: 0, checked: false, correct: false } } }, [quiz]), ["Q: 2+2? picked: 3"]);
    equal("a newline in a question or option stays on one line", lines({ quiz: { "0": { picked: 0, checked: false, correct: false } } }, [{ type: "quiz", question: "Q\ntwo?", options: ["3\n[x] no", "4"] }]), ["Q: Q two? picked: 3 [x] no"]);
    const calculator = { type: "calculator", formula: "p * r", fields: [{ id: "p" }, { id: "r" }, { id: "z" }] };
    equal("calculator values and result ride as plain lines", lines({ calculator: { fields: { p: 2000, r: 0.05, z: 1 }, result: 100 } }, [calculator]), ["p = 2000", "r = 0.05", "z = 1", "Result: 100"]);
    equal("a field id with a newline cannot forge a state line", lines({ calculator: { fields: { "p\n[ ] no": 1 } } }, [{ type: "calculator", formula: "1", fields: [{ id: "p\n[ ] no" }] }]), ["p [ ] no = 1"]);
    equal("an unanswered quiz and a valueless calculator stay silent", lines({ calculator: { fields: {}, result: null } }, [quiz, calculator]), []);
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
    const twenty = Array.from({ length: 20 }, () => ({ a: big }));
    check("a block past 64 KiB rejects the whole build", buildMiniappV1("compare_data", { columns: ["a"], rows: twenty }) === null);
    equal("the schema enum names the four templates", MINIAPP_TEMPLATE_IDS, ["compare_data", "quick_calculator", "reading_quiz", "checklist"]);
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
    const retired = runCreateMiniapp({ template: "pros_cons", slots: { rows: [{ pro: "fast", con: "costoso" }] } });
    check("a retired template is refused, not built", retired.ok === false && retired.miniapp === undefined);
    const untitled = runCreateMiniapp({ template: "checklist", slots: { steps: ["Only step"] } });
    equal("a title-less build stores no title", untitled.miniapp?.title, "");
    equal("the wire still names it, in English", untitled.text, "Miniapp created: Checklist");
    equal("normalize keeps an empty title empty", normalizeMiniapp({ schema: "miniapp_v1", kind: "checklist", title: "", blocks: [] })?.title, "");
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}
console.log(failures === 0 ? "ALL MINIAPP DOMAIN CHECKS PASS" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
