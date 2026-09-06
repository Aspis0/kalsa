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

  test("reading_quiz → quiz with >= 2 options", () => {
    const miniapp = buildMiniappV1("reading_quiz", {
      question: "Capital of France?",
      options: ["Berlin", "Paris", "Rome"],
      answerIndex: 1,
    });
    expect(miniapp).not.toBeNull();
    expect(miniapp?.blocks[0]).toMatchObject({
      type: "quiz",
      question: "Capital of France?",
      options: ["Berlin", "Paris", "Rome"],
      answerIndex: 1,
    });
  });

  test("reading_quiz disables grading when answerIndex is out of range", () => {
    const miniapp = buildMiniappV1("reading_quiz", {
      question: "Q?",
      options: ["A", "B"],
      answerIndex: 5,
    });
    // normalizeQuizBlock always sets answerIndex; null disables grading.
    expect(miniapp?.blocks[0].answerIndex).toBeNull();
  });

  test("reading_quiz rejects fewer than 2 options", () => {
    expect(buildMiniappV1("reading_quiz", { question: "Q?", options: ["A"] })).toBeNull();
  });

  test("reading_quiz rejects more than 4 options (F2)", () => {
    // >4 options would truncate to 4 and invalidate a safe answerIndex, so the
    // builder rejects the slots outright instead of producing a broken quiz.
    expect(
      buildMiniappV1("reading_quiz", {
        question: "Q?",
        options: ["A", "B", "C", "D", "E"],
        answerIndex: 4,
      }),
    ).toBeNull();
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
      slots: { question: "Q?", options: ["A", "B"], answerIndex: 0 },
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
        question: "Q?",
        options: ["A", "B"],
        answerIndex: 0,
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
  test("definition advertises the three templates and requires template", () => {
    const fn = CREATE_MINIAPP_TOOL.function;
    expect(fn.name).toBe("create_miniapp");
    const enumValues = (fn.parameters as { properties: { template: { enum: string[] } } })
      .properties.template.enum;
    expect(enumValues).toEqual([
      "compare_data",
      "quick_calculator",
      "reading_quiz",
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

  test("en prompts steer the tool and name all three templates", () => {
    const hay = promptText("en");
    expect(hay).toContain("create_miniapp");
    expect(hay).toContain("compare_data");
    expect(hay).toContain("quick_calculator");
    expect(hay).toContain("reading_quiz");
    // Prose JSON is framed as a fallback, not the primary instruction.
    expect(hay.toLowerCase()).toContain("fallback");
  });

  test("it prompts steer the tool", () => {
    const hay = promptText("it");
    expect(hay).toContain("create_miniapp");
    expect(hay).toContain("compare_data");
    expect(hay).toContain("quick_calculator");
    expect(hay).toContain("reading_quiz");
  });
});