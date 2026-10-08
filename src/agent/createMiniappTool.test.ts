// webSearchTool loads secretStore transitively; keep this registry test Node-safe.
jest.mock("expo-secure-store", () => ({
  deleteItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));

import { assembleTools, ALL_TOOL_NAMES, TOOL_ENTRIES } from "./toolRegistry";
import { makeCreateMiniappExecutor, CREATE_MINIAPP_TOOL } from "./createMiniappTool";
import { getStrings } from "../i18n";
import type { EngineToolResult } from "../engine/LlamaService";

function expectMiniapp(result: EngineToolResult) {
  // Executor smoke: a successful call returns a non-error text result.
  expect(result.error).toBeUndefined();
  return result;
}

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
    expect(result.text).toContain("the field start is not used in the formula");
  });

  test("a calculator built without a title is named in the result the model reads", async () => {
    const execute = makeCreateMiniappExecutor("en");
    const result = await execute("create_miniapp", {
      template: "quick_calculator",
      slots: { formula: "2 * 3" },
    });
    expect(result.text).toBe(
      getStrings("en").errors.createMiniappCreated.replace("{title}", getStrings("en").renderer.calculator),
    );
  });

  test("a calculator built without a title is named in the interface's language in the result", async () => {
    const execute = makeCreateMiniappExecutor("it");
    const result = await execute("create_miniapp", {
      template: "quick_calculator",
      slots: { formula: "2 * 3" },
    });
    expect(result.text).toBe(
      getStrings("it").errors.createMiniappCreated.replace("{title}", getStrings("it").renderer.calculator),
    );
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