// webSearchTool loads secretStore transitively; keep this registry test Node-safe.
jest.mock("expo-secure-store", () => ({
  deleteItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));

import { assembleTools, ALL_TOOL_NAMES, TOOL_ENTRIES } from "./toolRegistry";
import { makeCreateMiniappExecutor, CREATE_MINIAPP_TOOL } from "./createMiniappTool";
import { buildMiniappV1 } from "../domain/miniappBuilders";
import { quickCalculatorRefusal } from "../domain/miniappQuickCalculator";
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
      formula: "a + b * r",
      fields: [
        { id: "a", label: "Principal", value: 1000 },
        { id: "b", label: "Rate", value: 5 },
        { id: "r", label: "Step", value: 0.1 },
      ],
    });
    expect(miniapp).not.toBeNull();
    // Fields given: nothing is lifted, the formula reads the fields as they are.
    expect(miniapp?.blocks[0]).toMatchObject({ type: "calculator", formula: "a + b * r" });
    expect((miniapp?.blocks[0] as any).fields).toEqual([
      { id: "a", label: "Principal", value: 1000 },
      { id: "b", label: "Rate", value: 5 },
      { id: "r", label: "Step", value: 0.1 },
    ]);
    // The initial values and result seed the envelope's state: the next
    // turn's wire carries them before anyone edits anything.
    expect(miniapp?.state).toEqual({ calculator: { fields: { a: 1000, b: 5, r: 0.1 }, result: 1000.5 } });
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

  test("an empty field list lifts like no fields at all", () => {
    const miniapp = buildMiniappV1("quick_calculator", { formula: "50 / 4", fields: [] });
    expect(miniapp?.blocks[0]).toMatchObject({ formula: "n1 / n2" });
  });

  test("a lifted id never shadows an identifier the formula already uses", () => {
    // With no fields, n1 is unknown to the evaluator, so the build is refused
    // rather than reading the model's n1 as the lifted literal.
    expect(buildMiniappV1("quick_calculator", { formula: "n1 + 5" })).toBeNull();
  });

  test("digits inside identifiers lift nothing", () => {
    // The 0 of f0 belongs to the identifier; a lifted 0 would need a field of 0.
    const identifier = buildMiniappV1("quick_calculator", {
      formula: "f0 + 1",
      fields: [
        { id: "f0", label: "F", value: 2 },
        { id: "one", label: "One", value: 1 },
      ],
    });
    expect(identifier?.blocks[0]).toMatchObject({ formula: "f0 + one" });
  });

  test("a field value may write its decimal with a comma, and a literal matches it", () => {
    const miniapp = buildMiniappV1("quick_calculator", {
      formula: "a * 2",
      fields: [
        { id: "a", label: "A", value: "1,5" },
        { id: "two", label: "Two", value: "2,0" },
      ],
    });
    expect(miniapp?.blocks[0]).toMatchObject({ formula: "a * two" });
    expect(miniapp?.state).toEqual({ calculator: { fields: { a: 1.5, two: 2 }, result: 3 } });
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
    // Every one of the 24 fields is used, so none is a dead input.
    const formula = fields.slice(0, 24).map((field) => field.id).join(" + ");
    expect(
      buildMiniappV1("quick_calculator", {
        formula,
        fields: fields.slice(0, 24),
      }),
    ).not.toBeNull();
  });

  test("a bare number that no field holds is refused, naming the rule (the owner's case)", () => {
    const slots = {
      formula: "50 / 4",
      fields: [
        { id: "start", label: "Valore iniziale", value: 60 },
        { id: "div", label: "Divisore", value: 4 },
      ],
    };
    expect(buildMiniappV1("quick_calculator", slots)).toBeNull();
    expect(quickCalculatorRefusal(slots)).toBe(
      "create_miniapp: the formula contains the bare number 50 while fields were given. Write the formula from the field ids (for example a / b), or send no fields and the numbers become editable automatically.",
    );
  });

  test("a bare number equal to a field's value is written as that field's id", () => {
    const miniapp = buildMiniappV1("quick_calculator", {
      formula: "50 / b",
      fields: [
        { id: "a", label: "A", value: 50 },
        { id: "b", label: "B", value: 4 },
      ],
    });
    expect(miniapp?.blocks[0]).toMatchObject({ formula: "a / b" });
    expect(miniapp?.state).toEqual({ calculator: { fields: { a: 50, b: 4 }, result: 12.5 } });
  });

  test("a literal does not match a field the formula already names by id", () => {
    // `a` is 1 and the literal is 1, but the formula names `a`: the 1 is refused
    // rather than silently read as `a + a`.
    const slots = {
      formula: "a + 1",
      fields: [
        { id: "a", label: "A", value: 1 },
        { id: "b", label: "B", value: 5 },
      ],
    };
    expect(buildMiniappV1("quick_calculator", slots)).toBeNull();
    expect(quickCalculatorRefusal(slots)).toContain("the formula contains the bare number 1");
  });

  test("an unknown identifier is refused, naming it", () => {
    const slots = {
      formula: "a / c",
      fields: [
        { id: "a", label: "A", value: 1 },
        { id: "b", label: "B", value: 2 },
      ],
    };
    expect(buildMiniappV1("quick_calculator", slots)).toBeNull();
    expect(quickCalculatorRefusal(slots)).toBe(
      "create_miniapp: the formula references c, which is not one of the fields. Write the formula from the field ids you gave.",
    );
  });

  test("a field the formula never uses is refused as a dead input, naming it", () => {
    const slots = {
      formula: "a + 2",
      fields: [
        { id: "a", label: "A", value: 1 },
        { id: "b", label: "B", value: 2 },
        { id: "c", label: "C", value: 3 },
      ],
    };
    expect(buildMiniappV1("quick_calculator", slots)).toBeNull();
    expect(quickCalculatorRefusal(slots)).toBe(
      "create_miniapp: the field c is not used in the formula. Every field must appear in it; drop the ones that do not.",
    );
  });

  test("a formula that is merely malformed keeps the generic refusal", () => {
    expect(quickCalculatorRefusal({ formula: "a + ", fields: [{ id: "a", value: 1 }] })).toBeNull();
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

  test("a refused quick_calculator returns its rule to the model, no onMiniapp", async () => {
    const onMiniapp = jest.fn();
    const execute = makeCreateMiniappExecutor("en", { onMiniapp });

    const result = await execute("create_miniapp", {
      template: "quick_calculator",
      slots: {
        formula: "50 / 4",
        fields: [
          { id: "start", label: "Valore iniziale", value: 60 },
          { id: "div", label: "Divisore", value: 4 },
        ],
      },
    });

    expect(onMiniapp).not.toHaveBeenCalled();
    expect(result.error).toBe("invalid_slots");
    expect(result.text).toContain("the formula contains the bare number 50");
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
    // And the rule that keeps the ids in this description off the screen.
    expect(fn.description).toContain("Never show the tool's or a template's name");
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