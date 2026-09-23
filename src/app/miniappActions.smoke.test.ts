// Smoke tests for the C6 miniapp critical path: prompt parsing/normalization,
// calculator evaluation, and the action handler (export_csv / generate_report /
// unknown). Kept Node-safe by mocking the expo native transitive dependencies.

jest.mock("expo-file-system/legacy", () => ({
  documentDirectory: "/tmp/",
  cacheDirectory: "/tmp/",
  writeAsStringAsync: jest.fn(async () => ""),
}));

jest.mock("expo-sharing", () => ({
  isAvailableAsync: jest.fn(async () => false),
  shareAsync: jest.fn(async () => undefined),
}));

import { getStrings, translate } from "../i18n";
import { normalizeMiniapp, parseMiniappFromText, type AskAssistantMiniapp } from "../domain/askAssistant";
import { evaluateCalculatorFormula } from "../domain/miniappCalculator";
import { handleAskAssistantMiniappAction, type MiniappActionCallbacks } from "./miniappActions";

function fakeCallbacks(): MiniappActionCallbacks {
  return {
    setAskAssistantDraft: jest.fn(),
    setFeedback: jest.fn(),
    setMobileError: jest.fn(),
    locale: "en",
  };
}

function envelope(blocks: Array<Record<string, unknown>>): AskAssistantMiniapp {
  return { schema: "miniapp_v1", kind: "miniapp", title: "T", blocks };
}

describe("parseMiniappFromText", () => {
  test("extracts a miniapp from a ```json fence", () => {
    const text = 'Here you go:\n```json\n' + JSON.stringify(envelope([{ type: "table" }])) + '\n```';
    const { miniapp, text: rest } = parseMiniappFromText(text);
    expect(miniapp).not.toBeNull();
    expect(miniapp?.kind).toBe("miniapp");
    expect(miniapp?.blocks).toHaveLength(1);
    expect(rest).not.toContain("```");
  });

  test("extracts a raw (unfenced) balanced JSON object", () => {
    const text = `before ${JSON.stringify(envelope([{ type: "chart" }]))} after`;
    const { miniapp } = parseMiniappFromText(text);
    expect(miniapp?.blocks).toHaveLength(1);
  });

  test("returns null miniapp for text-only input", () => {
    const { miniapp, text } = parseMiniappFromText("just some prose, no json");
    expect(miniapp).toBeNull();
    expect(text).toBe("just some prose, no json");
  });

  test("returns null for empty input", () => {
    const { miniapp, text } = parseMiniappFromText("   \n  ");
    expect(miniapp).toBeNull();
    expect(text).toBe("   \n  ");
  });
});

describe("normalizeMiniapp", () => {
  test("keeps a valid envelope and truncates blocks to the cap", () => {
    const blocks = Array.from({ length: 40 }, (_, i) => ({ type: "table", id: String(i) }));
    const miniapp = normalizeMiniapp(envelope(blocks));
    expect(miniapp).not.toBeNull();
    expect(miniapp?.blocks).toHaveLength(24);
    expect(miniapp?.schema).toBe("miniapp_v1");
  });

  test("returns null when envelope is missing kind/title/blocks", () => {
    expect(normalizeMiniapp({ schema: "miniapp_v1", blocks: [{ type: "table" }] })).toBeNull();
    expect(normalizeMiniapp({ kind: "miniapp" })).toBeNull();
    expect(normalizeMiniapp("not an object")).toBeNull();
    expect(normalizeMiniapp(null)).toBeNull();
  });
});

describe("evaluateCalculatorFormula", () => {
  test("basic arithmetic with precedence", () => {
    expect(evaluateCalculatorFormula("2+3*4", {})).toEqual({ ok: true, value: 14 });
    expect(evaluateCalculatorFormula("(2+3)*4", {})).toEqual({ ok: true, value: 20 });
  });

  test("substitutes field ids from vars", () => {
    expect(evaluateCalculatorFormula("a+b", { a: 2, b: 3 })).toEqual({ ok: true, value: 5 });
  });

  test("handles negative variables and subtraction", () => {
    expect(evaluateCalculatorFormula("a-2", { a: -3 })).toEqual({ ok: true, value: -5 });
    expect(evaluateCalculatorFormula("a+b", { a: -3, b: 1 })).toEqual({ ok: true, value: -2 });
  });

  test("division by zero is rejected", () => {
    expect(evaluateCalculatorFormula("1/0", {})).toEqual({ ok: false, reason: "divzero" });
  });

  test("overflow (non-finite) is rejected", () => {
    expect(evaluateCalculatorFormula("9e999", {})).toEqual({ ok: false, reason: "unsupported" });
  });

  test("unsupported characters / length are rejected", () => {
    expect(evaluateCalculatorFormula("abs(2)", {})).toEqual({ ok: false, reason: "unsupported" });
    expect(evaluateCalculatorFormula("x^2", {})).toEqual({ ok: false, reason: "unsupported" });
    expect(evaluateCalculatorFormula("9".repeat(201), {})).toEqual({ ok: false, reason: "unsupported" });
  });
});

describe("handleAskAssistantMiniappAction", () => {
  test("generate_report surfaces the hint", async () => {
    const cb = fakeCallbacks();
    await handleAskAssistantMiniappAction({ id: "generate_report" }, envelope([]), cb);
    expect(cb.setFeedback).toHaveBeenCalledTimes(1);
    expect(cb.setMobileError).not.toHaveBeenCalled();
  });

  test("export_csv writes and reports success", async () => {
    const cb = fakeCallbacks();
    await handleAskAssistantMiniappAction({ id: "export_csv" }, envelope([]), cb);
    expect(cb.setFeedback).toHaveBeenCalledTimes(1);
    expect(cb.setMobileError).not.toHaveBeenCalled();
  });

  test("unknown action id surfaces an error", async () => {
    const cb = fakeCallbacks();
    await handleAskAssistantMiniappAction({ id: "does_not_exist" }, envelope([]), cb);
    expect(cb.setMobileError).toHaveBeenCalledTimes(1);
    expect(cb.setFeedback).not.toHaveBeenCalled();
  });

  test("string ids are matched case-insensitively", async () => {
    const cb = fakeCallbacks();
    await handleAskAssistantMiniappAction({ id: "GENERATE_REPORT" }, envelope([]), cb);
    expect(cb.setFeedback).toHaveBeenCalledTimes(1);
  });
});

describe("i18n parity for new keys", () => {
  test("every non-empty EN catalog path exists in IT and vice versa", () => {
    const en = getStrings("en") as Record<string, any>;
    const it = getStrings("it") as Record<string, any>;

    const flatten = (value: unknown, prefix = "", out: Record<string, string> = {}): Record<string, string> => {
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (typeof entry === "string") out[path] = entry;
        else if (entry && typeof entry === "object") flatten(entry, path, out);
      }
      return out;
    };
    const enStrings = flatten(en);
    const itStrings = flatten(it);
    const missingInItalian = Object.keys(enStrings).filter((path) => !(path in itStrings));
    const missingInEnglish = Object.keys(itStrings).filter((path) => !(path in enStrings));
    if (missingInItalian.length || missingInEnglish.length) {
      throw new Error([
        missingInItalian.length ? `Missing from Italian catalog: ${missingInItalian.join(", ")}` : "",
        missingInEnglish.length ? `Missing from English catalog: ${missingInEnglish.join(", ")}` : "",
      ].filter(Boolean).join("\n"));
    }
    const emptyEnglish = Object.entries(enStrings).filter(([, value]) => value.trim().length === 0).map(([path]) => path);
    const emptyItalian = Object.entries(itStrings).filter(([, value]) => value.trim().length === 0).map(([path]) => path);
    if (emptyEnglish.length || emptyItalian.length) {
      throw new Error([
        emptyEnglish.length ? `Empty English translations: ${emptyEnglish.join(", ")}` : "",
        emptyItalian.length ? `Empty Italian translations: ${emptyItalian.join(", ")}` : "",
      ].filter(Boolean).join("\n"));
    }

    // Identical values are valid for names and formatting tokens; only paths and non-empty values matter.
    const enQuickActionKeys = Object.keys(en.quickActions);
    const itQuickActionKeys = Object.keys(it.quickActions);
    for (const key of enQuickActionKeys) expect(itQuickActionKeys).toContain(key);
    for (const key of itQuickActionKeys) expect(enQuickActionKeys).toContain(key);
    // Every template key referenced by miniappTemplates.ts must resolve in both languages.
    for (const key of [
      "quickActions.compareData", "quickActions.compareDataSub", "quickActions.compareDataPrompt",
      "quickActions.quickCalculator", "quickActions.quickCalculatorSub", "quickActions.quickCalculatorPrompt",
      "quickActions.readingQuiz", "quickActions.readingQuizSub", "quickActions.readingQuizPrompt",
    ]) {
      expect(enStrings[key]).toBeTruthy();
      expect(itStrings[key]).toBeTruthy();
    }
    expect(enStrings["miniapp.actionRequiresAi"]).toBeTruthy();
    expect(itStrings["miniapp.actionRequiresAi"]).toBeTruthy();
  });

  // F-04 regression guard: unit_converter renders density/mass/volume via t() keys.
  // If those keys were deleted while still referenced, t() would leak the raw key.
  test("renderer density and empty-state keys resolve to real translations (not raw keys)", () => {
    for (const key of [
      "renderer.massFromDensity", "renderer.volumeMl", "renderer.densityGml",
      "renderer.condition", "renderer.conditionN", "renderer.noMatrixRowsYet",
      "renderer.noTimelineStepsConfigured", "renderer.noDecisionNodesYet", "renderer.noRisksIdentified",
    ]) {
      expect(translate("en", key as any)).not.toBe(key);
      expect(translate("it", key as any)).not.toBe(key);
    }
  });
});
