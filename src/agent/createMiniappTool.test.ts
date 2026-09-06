// webSearchTool loads secretStore transitively; keep this registry test Node-safe.
jest.mock("expo-secure-store", () => ({
  deleteItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));

import { assembleTools, ALL_TOOL_NAMES, TOOL_ENTRIES } from "./toolRegistry";
import { makeCreateMiniappExecutor, CREATE_MINIAPP_TOOL } from "./createMiniappTool";
import { buildMiniappV1 } from "../domain/miniappBuilders";
import { getStrings } from "../i18n";
import type { EngineToolResult } from "../engine/LlamaService";

function expectMiniapp(result: EngineToolResult) {
  // Executor smoke: a successful call returns a non-error text result.
  expect(result.error).toBeUndefined();
  return result;
}

describe("create_miniapp builder (buildMiniappV1)", () => {
  test("compare_data → data_table with columns", () => {
    const miniapp = buildMiniappV1("compare_data", {
      title: "Plan comparison",
      columns: ["Free", "Pro"],
      rows: [
        { storage: "5 GB", "price": "$0" },
        { storage: "100 GB", "price": "$10" },
      ],
    });
    expect(miniapp).not.toBeNull();
    expect(miniapp?.schema).toBe("miniapp_v1");
    expect(miniapp?.title).toBe("Plan comparison");
    expect(miniapp?.blocks[0]).toMatchObject({
      type: "data_table",
      columns: ["Free", "Pro"],
    });
  });

  test("compare_data rejects missing/empty columns", () => {
    expect(buildMiniappV1("compare_data", { rows: [] })).toBeNull();
    expect(buildMiniappV1("compare_data", { columns: [] })).toBeNull();
    expect(buildMiniappV1("compare_data", { columns: "nope" })).toBeNull();
  });

  test("compare_data rejects a non-array rows value", () => {
    expect(buildMiniappV1("compare_data", { columns: ["a"], rows: {} })).toBeNull();
  });

  test("quick_calculator → calculator with formula", () => {
    const miniapp = buildMiniappV1("quick_calculator", {
      formula: "a + b * 0.1",
      fields: [
        { id: "a", label: "Principal", value: 1000 },
        { id: "b", label: "Rate", value: 5 },
      ],
    });
    expect(miniapp).not.toBeNull();
    expect(miniapp?.blocks[0]).toMatchObject({ type: "calculator", formula: "a + b * 0.1" });
    expect(Array.isArray(miniapp?.blocks[0]?.fields)).toBe(true);
  });

  test("quick_calculator rejects a missing formula", () => {
    expect(buildMiniappV1("quick_calculator", { fields: [] })).toBeNull();
    expect(buildMiniappV1("quick_calculator", {})).toBeNull();
  });

  test("quick_calculator accepts a bare arithmetic formula (no fields)", () => {
    const miniapp = buildMiniappV1("quick_calculator", { formula: "2 + 3 * 4" });
    expect(miniapp).not.toBeNull();
    expect(miniapp?.blocks[0]).toMatchObject({ type: "calculator", formula: "2 + 3 * 4" });
  });

  test("quick_calculator rejects an invalid formula (F3)", () => {
    // Unbalanced parens / bad charset / referencing an unknown field id.
    expect(buildMiniappV1("quick_calculator", { formula: "a + " })).toBeNull();
    expect(buildMiniappV1("quick_calculator", { formula: "a @ b" })).toBeNull();
    expect(
      buildMiniappV1("quick_calculator", {
        formula: "x + 1",
        fields: [{ id: "a", label: "A", value: 1 }],
      }),
    ).toBeNull();
  });

  test("quick_calculator rejects empty or duplicate field ids (F4)", () => {
    expect(
      buildMiniappV1("quick_calculator", {
        formula: "a + b",
        fields: [{ label: "A", value: 1 }], // no id
      }),
    ).toBeNull();
    expect(
      buildMiniappV1("quick_calculator", {
        formula: "a + b",
        fields: [
          { id: "a", label: "A", value: 1 },
          { id: "a", label: "A2", value: 2 },
        ],
      }),
    ).toBeNull();
  });

  test("reading_quiz → one quiz block per question (N questions)", () => {
    const miniapp = buildMiniappV1("reading_quiz", {
      title: "Geo quiz",
      questions: [
        { question: "Capital of France?", options: ["Berlin", "Paris", "Rome"], answerIndex: 1 },
        { question: "2+2?", options: ["3", "4"], answerIndex: 1 },
      ],
    });
    expect(miniapp).not.toBeNull();
    expect(miniapp?.blocks).toHaveLength(2);
    expect(miniapp?.blocks[0]).toMatchObject({
      type: "quiz",
      question: "Capital of France?",
      options: ["Berlin", "Paris", "Rome"],
      answerIndex: 1,
    });
    expect(miniapp?.blocks[1]).toMatchObject({ type: "quiz", question: "2+2?" });
  });

  test("reading_quiz emits 8 quiz blocks at the cap", () => {
    const questions = Array.from({ length: 8 }, (_, i) => ({
      question: `Q${i}`,
      options: ["A", "B"],
    }));
    const miniapp = buildMiniappV1("reading_quiz", { questions });
    expect(miniapp?.blocks).toHaveLength(8);
    expect(miniapp?.blocks[7]).toMatchObject({ type: "quiz", question: "Q7" });
  });

  test("reading_quiz rejects 0 questions", () => {
    expect(buildMiniappV1("reading_quiz", { questions: [] })).toBeNull();
  });

  test("reading_quiz rejects 9 questions (over the 1..8 cap)", () => {
    const questions = Array.from({ length: 9 }, (_, i) => ({
      question: `Q${i}`,
      options: ["A", "B"],
    }));
    expect(buildMiniappV1("reading_quiz", { questions })).toBeNull();
  });

  test("reading_quiz rejects a question with fewer than 2 options", () => {
    expect(
      buildMiniappV1("reading_quiz", { questions: [{ question: "Q?", options: ["A"] }] }),
    ).toBeNull();
  });

  test("reading_quiz rejects a question with more than 4 options (F2)", () => {
    // >4 options would truncate to 4 and invalidate a safe answerIndex, so the
    // builder rejects the slots outright instead of producing a broken quiz.
    expect(
      buildMiniappV1("reading_quiz", {
        questions: [{ question: "Q?", options: ["A", "B", "C", "D", "E"], answerIndex: 4 }],
      }),
    ).toBeNull();
  });

  test("reading_quiz disables grading per-question when answerIndex is out of range", () => {
    const miniapp = buildMiniappV1("reading_quiz", {
      questions: [
        { question: "Q1?", options: ["A", "B"], answerIndex: 5 },
        { question: "Q2?", options: ["A", "B"], answerIndex: 0 },
      ],
    });
    // First question's index 5 addresses no option → grading disabled (null);
    // second question's index 0 is valid.
    expect(miniapp?.blocks[0].answerIndex).toBeNull();
    expect(miniapp?.blocks[1].answerIndex).toBe(0);
  });

  test("reading_quiz rejects a question missing its text", () => {
    expect(
      buildMiniappV1("reading_quiz", { questions: [{ options: ["A", "B"] }] }),
    ).toBeNull();
  });

  test("reading_quiz rejects a non-array questions value", () => {
    expect(buildMiniappV1("reading_quiz", { questions: "nope" })).toBeNull();
  });

  test("kpi_strip → metric_strip with metrics", () => {
    const miniapp = buildMiniappV1("kpi_strip", {
      title: "Q3 metrics",
      metrics: [
        { label: "Revenue", value: 12000, unit: "€" },
        { label: "Growth", value: "12%", tone: "positive" },
      ],
    });
    expect(miniapp).not.toBeNull();
    expect(miniapp?.kind).toBe("kpi_strip");
    expect(miniapp?.blocks[0]).toMatchObject({ type: "metric_strip" });
    expect((miniapp?.blocks[0] as any).metrics[0]).toMatchObject({ label: "Revenue", value: 12000, unit: "€" });
    expect((miniapp?.blocks[0] as any).metrics[1]).toMatchObject({ label: "Growth", value: "12%", tone: "positive" });
  });

  test("kpi_strip rejects 0/>8 metrics and missing label or value", () => {
    expect(buildMiniappV1("kpi_strip", { metrics: [] })).toBeNull();
    expect(buildMiniappV1("kpi_strip", { metrics: [{ value: "x" }] })).toBeNull(); // no label
    expect(buildMiniappV1("kpi_strip", { metrics: [{ label: "L" }] })).toBeNull(); // no value
    const nine = Array.from({ length: 9 }, (_, i) => ({ label: `L${i}`, value: i }));
    expect(buildMiniappV1("kpi_strip", { metrics: nine })).toBeNull();
  });

  test("checklist → timeline steps from string[]", () => {
    const miniapp = buildMiniappV1("checklist", {
      title: "Setup",
      steps: ["Install", "Configure", "Launch"],
    });
    expect(miniapp).not.toBeNull();
    expect(miniapp?.kind).toBe("checklist");
    expect(miniapp?.blocks[0]).toMatchObject({ type: "timeline" });
    expect(miniapp?.blocks[0].steps).toHaveLength(3);
    expect((miniapp?.blocks[0] as any).steps[0]).toMatchObject({ title: "Install" });
  });

  test("checklist promotes body to the visible title and drops it (F-3)", () => {
    const miniapp = buildMiniappV1("checklist", {
      items: [
        { title: "Step 1", body: "do it" },
        { body: "Only body" },
        "plain step",
      ],
    });
    expect(miniapp?.blocks[0].steps).toHaveLength(3);
    // titled item: title kept, body ignored and never stored
    expect((miniapp?.blocks[0] as any).steps[0]).toMatchObject({ title: "Step 1" });
    expect((miniapp?.blocks[0] as any).steps[0].body).toBeUndefined();
    // body-only item: body promoted to the visible title, then dropped
    expect((miniapp?.blocks[0] as any).steps[1]).toMatchObject({ title: "Only body" });
    expect((miniapp?.blocks[0] as any).steps[1].body).toBeUndefined();
    expect((miniapp?.blocks[0] as any).steps[2]).toMatchObject({ title: "plain step" });
    expect(buildMiniappV1("checklist", { steps: [] })).toBeNull();
    expect(buildMiniappV1("checklist", { steps: [{}] })).toBeNull(); // no title/body
    expect(buildMiniappV1("checklist", {})).toBeNull();
  });

  test("checklist rejects more than 12 steps", () => {
    const steps = Array.from({ length: 13 }, (_, i) => `S${i}`);
    expect(buildMiniappV1("checklist", { steps })).toBeNull();
  });

  test("pros_cons → data_table with pro/con columns", () => {
    const miniapp = buildMiniappV1("pros_cons", {
      title: "Choice",
      rows: [{ pro: "Fast", con: "Expensive" }, { pro: "Simple" }],
    });
    expect(miniapp).not.toBeNull();
    expect(miniapp?.kind).toBe("pros_cons");
    expect(miniapp?.blocks[0]).toMatchObject({
      type: "data_table",
      columns: [
        { key: "pro", label: "Pro" },
        { key: "con", label: "Con" },
      ],
    });
    expect(miniapp?.blocks[0].rows).toHaveLength(2);
    expect((miniapp?.blocks[0] as any).rows[0]).toMatchObject({ pro: "Fast", con: "Expensive" });
    // a row with only a pro keeps an empty con cell
    expect((miniapp?.blocks[0] as any).rows[1]).toMatchObject({ pro: "Simple", con: "" });
  });

  test("pros_cons rejects empty rows and non-array input", () => {
    expect(buildMiniappV1("pros_cons", { rows: [] })).toBeNull();
    expect(buildMiniappV1("pros_cons", { rows: [{ pro: "" }, { con: "" }, {}] })).toBeNull();
    expect(buildMiniappV1("pros_cons", { rows: "nope" })).toBeNull();
  });

  test("pros_cons localizes column headers via labels (F-4)", () => {
    const miniapp = buildMiniappV1(
      "pros_cons",
      { rows: [{ pro: "fast", con: "costoso" }] },
      { pro: "Pro / No", con: "Contro" },
    );
    expect(miniapp?.blocks[0]).toMatchObject({
      type: "data_table",
      columns: [
        { key: "pro", label: "Pro / No" },
        { key: "con", label: "Contro" },
      ],
    });
    // key stays stable so row lookup still works
    expect((miniapp?.blocks[0] as any).rows[0]).toMatchObject({ pro: "fast", con: "costoso" });
  });

  test("F-1: pros_cons reads rows[], not top-level pro/con", () => {
    // The tool description no longer advertises top-level pro/con; sending
    // them without rows[] is rejected (invalid_slots), not silently ignored.
    expect(buildMiniappV1("pros_cons", { pro: "a", con: "b" })).toBeNull();
  });

  test("unknown template → null", () => {
    expect(buildMiniappV1("not_a_template", {})).toBeNull();
  });
});

describe("create_miniapp executor", () => {
  test("success calls onMiniapp and returns a clean result", async () => {
    const onMiniapp = jest.fn();
    const execute = makeCreateMiniappExecutor("en", { onMiniapp });

    const result = await execute("create_miniapp", {
      template: "reading_quiz",
      slots: { questions: [{ question: "Q?", options: ["A", "B"], answerIndex: 0 }] },
    });

    expectMiniapp(result);
    expect(onMiniapp).toHaveBeenCalledTimes(1);
    const opened = onMiniapp.mock.calls[0][0] as { kind: string; blocks: unknown[] };
    expect(opened.kind).toBe("reading_quiz");
    expect(opened.blocks[0]).toMatchObject({ type: "quiz" });
  });

  test("executor localizes headers by locale (F-4)", async () => {
    const onMiniapp = jest.fn();
    const execute = makeCreateMiniappExecutor("it", { onMiniapp });
    await execute("create_miniapp", {
      template: "pros_cons",
      slots: { rows: [{ pro: "fast", con: "costoso" }] },
    });
    const opened = onMiniapp.mock.calls[0][0] as {
      kind: string;
      blocks: Array<{ columns: Array<{ key: string; label: string }> }>;
    };
    expect(opened.kind).toBe("pros_cons");
    expect(opened.blocks[0].columns).toEqual([
      { key: "pro", label: getStrings("it").miniapp.pro },
      { key: "con", label: getStrings("it").miniapp.con },
    ]);
  });

  test("success text is 'Miniapp created: {title}'", async () => {
    const execute = makeCreateMiniappExecutor("en");
    const result = await execute("create_miniapp", {
      template: "reading_quiz",
      slots: {
        title: "My Quiz",
        questions: [{ question: "Q?", options: ["A", "B"], answerIndex: 0 }],
      },
    });
    expect(result.text).toBe(
      getStrings("en").errors.createMiniappCreated.replace("{title}", "My Quiz"),
    );
  });

  test("invalid slots: no onMiniapp call, error tagged", async () => {
    const onMiniapp = jest.fn();
    const execute = makeCreateMiniappExecutor("en", { onMiniapp });

    const result = await execute("create_miniapp", {
      template: "compare_data",
      slots: { columns: [] },
    });

    expect(onMiniapp).not.toHaveBeenCalled();
    expect(result.error).toBe("invalid_slots");
    expect(result.kind).toBe("create_miniapp");
    expect(result.text).toBe(getStrings("en").errors.createMiniappInvalidSlots);
  });

  test("unknown template: no onMiniapp call, error tagged", async () => {
    const onMiniapp = jest.fn();
    const execute = makeCreateMiniappExecutor("en", { onMiniapp });

    const result = await execute("create_miniapp", { template: "bogus" });

    expect(onMiniapp).not.toHaveBeenCalled();
    expect(result.error).toBe("invalid_template");
  });

  test("wrong tool name → unknownTool, no onMiniapp", async () => {
    const onMiniapp = jest.fn();
    const execute = makeCreateMiniappExecutor("en", { onMiniapp });

    const result = await execute("other_tool", { template: "reading_quiz" });

    expect(onMiniapp).not.toHaveBeenCalled();
    expect(result.text).toBe(
      getStrings("en").errors.unknownTool.replace("{name}", "other_tool"),
    );
  });

  test("localized error text (it)", async () => {
    const execute = makeCreateMiniappExecutor("it");
    const result = await execute("create_miniapp", { template: "compare_data", slots: {} });
    expect(result.error).toBe("invalid_slots");
    expect(result.text).toBe(getStrings("it").errors.createMiniappInvalidSlots);
  });
});

describe("create_miniapp tool definition + registry", () => {
  test("definition advertises the six templates and requires template", () => {
    const fn = CREATE_MINIAPP_TOOL.function;
    expect(fn.name).toBe("create_miniapp");
    const enumValues = (fn.parameters as { properties: { template: { enum: string[] } } })
      .properties.template.enum;
    expect(enumValues).toEqual([
      "compare_data",
      "quick_calculator",
      "reading_quiz",
      "kpi_strip",
      "checklist",
      "pros_cons",
    ]);
    expect((fn.parameters as { required: string[] }).required).toEqual(["template"]);
  });

  test("registry lists create_miniapp, default on, ungated", () => {
    expect(ALL_TOOL_NAMES).toContain("create_miniapp");
    const entry = TOOL_ENTRIES.find((e) => e.name === "create_miniapp");
    expect(entry).toBeDefined();
    expect(entry?.defaultOn).toBe(true);
    expect(entry?.toggleKey).toBeNull();
    expect(entry?.gateTable).toBeNull();
    expect(entry?.def.function.name).toBe("create_miniapp");
  });

  test("assembleTools exposes create_miniapp by default", () => {
    const names = assembleTools({ web: true, device: true, calendar: true }).map(
      (t) => t.function.name,
    );
    expect(names).toContain("create_miniapp");
  });
});

describe("system prompts mention create_miniapp (F1)", () => {
  function promptText(locale: "en" | "it"): string {
    const s = getStrings(locale);
    return [
      s.systemPrompt ?? "",
      s.systemPromptWithSearch ?? "",
      s.operativeBlock.miniapp ?? "",
    ].join("\n");
  }

  test("en prompts steer the tool and name all six templates", () => {
    const hay = promptText("en");
    expect(hay).toContain("create_miniapp");
    expect(hay).toContain("compare_data");
    expect(hay).toContain("quick_calculator");
    expect(hay).toContain("reading_quiz");
    expect(hay).toContain("kpi_strip");
    expect(hay).toContain("checklist");
    expect(hay).toContain("pros_cons");
    // Prose JSON is framed as a fallback, not the primary instruction.
    expect(hay.toLowerCase()).toContain("fallback");
  });

  test("it prompts steer the tool", () => {
    const hay = promptText("it");
    expect(hay).toContain("create_miniapp");
    expect(hay).toContain("compare_data");
    expect(hay).toContain("quick_calculator");
    expect(hay).toContain("reading_quiz");
    expect(hay).toContain("kpi_strip");
    expect(hay).toContain("checklist");
    expect(hay).toContain("pros_cons");
  });
});