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
    // The literal rides along as its own editable field, like the desktop's.
    expect(miniapp?.blocks[0]).toMatchObject({ type: "calculator", formula: "a + b * n1" });
    expect((miniapp?.blocks[0] as any).fields).toEqual([
      { id: "a", label: "Principal", value: 1000 },
      { id: "b", label: "Rate", value: 5 },
      { id: "n1", value: 0.1 },
    ]);
    // The initial values and result seed the envelope's state: the next
    // turn's wire carries them before anyone edits anything.
    expect(miniapp?.state).toEqual({ calculator: { fields: { a: 1000, b: 5, n1: 0.1 }, result: 1000.5 } });
  });

  test("quick_calculator rejects a missing formula", () => {
    expect(buildMiniappV1("quick_calculator", { fields: [] })).toBeNull();
    expect(buildMiniappV1("quick_calculator", {})).toBeNull();
  });

  test("quick_calculator lifts every bare literal into an editable field", () => {
    const miniapp = buildMiniappV1("quick_calculator", { formula: "50 / 4" });
    expect(miniapp).not.toBeNull();
    expect(miniapp?.blocks[0]).toMatchObject({ type: "calculator", formula: "n1 / n2" });
    expect((miniapp?.blocks[0] as any).fields).toEqual([
      { id: "n1", value: 50 },
      { id: "n2", value: 4 },
    ]);
    expect(miniapp?.state).toEqual({ calculator: { fields: { n1: 50, n2: 4 }, result: 12.5 } });
  });

  test("lifted ids mint past the model's own, and digits inside identifiers lift nothing", () => {
    const past = buildMiniappV1("quick_calculator", {
      formula: "n1 + 5",
      fields: [{ id: "n1", label: "Seed", value: 1 }],
    });
    expect(past?.blocks[0]).toMatchObject({ formula: "n1 + n2" });
    expect((past?.blocks[0] as any).fields[1]).toEqual({ id: "n2", value: 5 });

    // The 0 of f0 belongs to the identifier, not to the literals.
    const identifier = buildMiniappV1("quick_calculator", {
      formula: "f0 + 1",
      fields: [{ id: "f0", label: "F", value: 2 }],
    });
    expect(identifier?.blocks[0]).toMatchObject({ formula: "f0 + n1" });
  });

  test("a field value may write its decimal with a comma", () => {
    const miniapp = buildMiniappV1("quick_calculator", {
      formula: "a * 2",
      fields: [{ id: "a", label: "A", value: "1,5" }],
    });
    expect(miniapp?.blocks[0]).toMatchObject({ formula: "a * n1" });
    expect(miniapp?.state).toEqual({ calculator: { fields: { a: 1.5, n1: 2 }, result: 3 } });
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

  test("quick_calculator rejects unsafe or over-cap field ids (F4)", () => {
    for (const id of ["__proto__", "constructor", "x".repeat(65)]) {
      expect(
        buildMiniappV1("quick_calculator", {
          formula: "f + 1",
          fields: [{ id, label: "F", value: 1 }],
        }),
      ).toBeNull();
    }
  });

  test("quick_calculator rejects a field list past the renderer's cap", () => {
    const fields = Array.from({ length: 25 }, (_, i) => ({
      id: `f${i}`,
      label: `F${i}`,
      value: i,
    }));
    expect(buildMiniappV1("quick_calculator", { formula: "f0", fields })).toBeNull();
    expect(
      buildMiniappV1("quick_calculator", {
        formula: "f0",
        fields: fields.slice(0, 24),
      }),
    ).not.toBeNull();
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

  test("checklist → tickable items with minted ids", () => {
    const miniapp = buildMiniappV1("checklist", {
      title: "Setup",
      steps: ["Install", "Configure", "Launch"],
    });
    expect(miniapp).not.toBeNull();
    expect(miniapp?.kind).toBe("checklist");
    expect(miniapp?.blocks[0]).toMatchObject({ type: "checklist", title: "Setup" });
    expect((miniapp?.blocks[0] as any).items).toEqual([
      { id: "item-1", title: "Install" },
      { id: "item-2", title: "Configure" },
      { id: "item-3", title: "Launch" },
    ]);
  });

  test("checklist keeps provided ids and mints the rest", () => {
    const miniapp = buildMiniappV1("checklist", {
      items: [{ id: "milk", title: "Buy milk" }, { title: "No id" }, "plain step"],
    });
    expect((miniapp?.blocks[0] as any).items).toEqual([
      { id: "milk", title: "Buy milk" },
      { id: "item-1", title: "No id" },
      { id: "item-2", title: "plain step" },
    ]);
  });

  test("checklist mints over a colliding, unsafe or over-cap id", () => {
    const colliding = buildMiniappV1("checklist", {
      items: [{ id: "item-1", title: "A" }, { id: "item-1", title: "B" }],
    });
    expect((colliding?.blocks[0] as any).items.map((item: any) => item.id)).toEqual(["item-1", "item-2"]);
    const unsafe = buildMiniappV1("checklist", {
      items: [
        { id: "__proto__", title: "A" },
        { id: "constructor", title: "B" },
        { id: "x".repeat(65), title: "C" },
      ],
    });
    expect((unsafe?.blocks[0] as any).items.map((item: any) => item.id)).toEqual([
      "item-1",
      "item-2",
      "item-3",
    ]);
  });

  test("checklist promotes body to the visible title and drops it (F-3)", () => {
    const miniapp = buildMiniappV1("checklist", {
      items: [
        { title: "Step 1", body: "do it" },
        { body: "Only body" },
        "plain step",
      ],
    });
    expect((miniapp?.blocks[0] as any).items.map((item: any) => item.title)).toEqual([
      "Step 1",
      "Only body",
      "plain step",
    ]);
    expect(((miniapp?.blocks[0] as any).items[0] as any).body).toBeUndefined();
    expect(buildMiniappV1("checklist", { steps: [] })).toBeNull();
    expect(buildMiniappV1("checklist", { steps: [{}] })).toBeNull(); // no title/body
    expect(buildMiniappV1("checklist", {})).toBeNull();
  });

  test("checklist rejects more than 12 steps", () => {
    const steps = Array.from({ length: 13 }, (_, i) => `S${i}`);
    expect(buildMiniappV1("checklist", { steps })).toBeNull();
  });

  test("unknown template → null", () => {
    expect(buildMiniappV1("not_a_template", {})).toBeNull();
  });

  test("the removed templates are rejected, not silently rebuilt", () => {
    expect(buildMiniappV1("kpi_strip", { metrics: [{ label: "L", value: 1 }] })).toBeNull();
    expect(buildMiniappV1("pros_cons", { rows: [{ pro: "fast" }] })).toBeNull();
  });

  // ── F-5: per-field string cap + per-block 64 KiB serialized guard ──

  test("F-5: a single oversized required field rejects the whole build", () => {
    const overCap = "x".repeat(5000); // > MAX_SLOT_CHARS (4000)
    // required scalar field (quiz question) rejected per-field
    expect(
      buildMiniappV1("reading_quiz", {
        questions: [{ question: overCap, options: ["A", "B"] }],
      }),
    ).toBeNull();
    // oversized plain-string checklist step rejected per-field
    expect(buildMiniappV1("checklist", { steps: [overCap] })).toBeNull();
    // a normal step (under the cap) still builds
    expect(
      buildMiniappV1("checklist", { steps: ["Install", "Configure"] }),
    ).not.toBeNull();
  });

  test("F-5: a single block exceeding 64 KiB is rejected, not silently degraded", () => {
    // compare_data passes rows through; ~12 rows of 4000-char cells total
    // > 64 KiB in that single data_table block, so the serialized guard
    // rejects the whole miniapp instead of rendering a degraded one.
    const big = "x".repeat(4000);
    const rows = Array.from({ length: 12 }, () => ({ a: big, b: big }));
    expect(buildMiniappV1("compare_data", { columns: ["a", "b"], rows })).toBeNull();
  });

  test("F-5: a normal-sized checklist still builds", () => {
    const miniapp = buildMiniappV1("checklist", {
      steps: ["One", "Two", "Three"],
    });
    expect(miniapp).not.toBeNull();
    expect(miniapp?.blocks[0].type).toBe("checklist");
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
  test("definition advertises the four templates and requires template", () => {
    const fn = CREATE_MINIAPP_TOOL.function;
    expect(fn.name).toBe("create_miniapp");
    // The quick_calculator rule the model must follow: labelled fields first.
    expect(fn.description).toContain("labelled field");
    expect(fn.description).toContain("split into editable Number fields");
    const enumValues = (fn.parameters as { properties: { template: { enum: string[] } } })
      .properties.template.enum;
    expect(enumValues).toEqual([
      "compare_data",
      "quick_calculator",
      "reading_quiz",
      "checklist",
    ]);
    expect(enumValues).not.toContain("kpi_strip");
    expect(enumValues).not.toContain("pros_cons");
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

  test("en prompts steer the tool and name all four templates", () => {
    const hay = promptText("en");
    expect(hay).toContain("create_miniapp");
    expect(hay).toContain("compare_data");
    expect(hay).toContain("quick_calculator");
    expect(hay).toContain("reading_quiz");
    expect(hay).toContain("checklist");
    expect(hay).not.toContain("kpi_strip");
    expect(hay).not.toContain("pros_cons");
    // Prose JSON is framed as a fallback, not the primary instruction.
    expect(hay.toLowerCase()).toContain("fallback");
  });

  test("it prompts steer the tool", () => {
    const hay = promptText("it");
    expect(hay).toContain("create_miniapp");
    expect(hay).toContain("compare_data");
    expect(hay).toContain("quick_calculator");
    expect(hay).toContain("reading_quiz");
    expect(hay).toContain("checklist");
    expect(hay).not.toContain("kpi_strip");
    expect(hay).not.toContain("pros_cons");
  });
});