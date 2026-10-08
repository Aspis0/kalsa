jest.mock("react-native", () => ({
  Alert: { alert: jest.fn() },
  Platform: { OS: "ios", select: (spec: Record<string, unknown>) => spec.ios },
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
  useWindowDimensions: () => ({ width: 390, height: 844 }),
}));

jest.mock("@expo/vector-icons/Ionicons", () => "Ionicons");
jest.mock("expo-blur", () => ({ BlurView: "BlurView" }));
jest.mock("expo-linear-gradient", () => ({ LinearGradient: "LinearGradient" }));
jest.mock("react-native-view-shot", () => ({ captureRef: jest.fn() }));
jest.mock("expo-file-system/legacy", () => ({}));
jest.mock("expo-sharing", () => ({}));
jest.mock("react-native-webview", () => ({ WebView: "WebView" }));
jest.mock("./blocks/ChecklistBlock", () => ({ ChecklistBlockView: () => null }));
jest.mock("./blocks/QuizBlock", () => ({ QuizBlockView: () => null }));
jest.mock("./labTheme", () => ({ useLabTheme: () => ({}) }));
jest.mock("../i18n", () => ({ getStrings: () => ({}), useLocale: () => ({}) }));

import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { ASK_ASSISTANT_MINIAPP_BLOCK_REGISTRY } from "./AskAssistantMiniappRenderer";

type RenderArgs = Parameters<(typeof ASK_ASSISTANT_MINIAPP_BLOCK_REGISTRY)["calculator"]["render"]>[0];
type Locale = "en" | "it";

const STRINGS: Record<Locale, Record<string, string>> = {
  en: {
    "renderer.calculator": "Calculator",
    "renderer.formula": "Formula",
    "renderer.numberField": "Number {n}",
    "renderer.result": "Result",
  },
  it: {
    "renderer.calculator": "Calcolatrice",
    "renderer.formula": "Formula",
    "renderer.numberField": "Numero {n}",
    "renderer.result": "Risultato",
  },
};

function translator(locale: Locale) {
  return (key: string, params?: Record<string, number>): string =>
    (STRINGS[locale][key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ""));
}

/** The calculator block as the renderer mounts it, in the given interface language. */
function mount(
  block: Record<string, unknown>,
  locale: Locale,
  onStateChange: (state: Record<string, unknown>) => void = () => undefined,
): ReactTestRenderer {
  const args = {
    block,
    context: {
      blockKey: "0",
      colors: {},
      computed: {},
      index: 0,
      inputs: {},
      locale,
      onStateChange,
      runAction: () => undefined,
      setInput: () => undefined,
      state: {},
      styles: {},
      t: translator(locale),
    },
  } as unknown as RenderArgs;
  const element = ASK_ASSISTANT_MINIAPP_BLOCK_REGISTRY.calculator.render(args) as React.ReactElement;
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(element);
  });
  if (!renderer) throw new Error("the calculator block did not mount");
  return renderer;
}

/** Every string the mounted tree draws, in order. */
function drawn(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (Array.isArray(node)) return node.flatMap(drawn);
  if (node && typeof node === "object" && "children" in node) {
    return drawn((node as { children: unknown }).children);
  }
  return [];
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A formula name as the view draws it: bidi-isolated, so the operators around it keep their place. */
const token = (name: string) => `\u2068${name}\u2069`;

const lifted = [
  { id: "n1", value: 50 },
  { id: "n2", value: 4 },
];
const named = [
  { id: "start", label: "Valore iniziale", value: 60 },
  { id: "div", label: "Divisore", value: 4 },
];

describe("calculator block", () => {
  test("draws no title of its own: the envelope's header is the only one", () => {
    const texts = drawn(mount({ type: "calculator", formula: "n1 / n2", fields: lifted }, "it").toJSON());
    expect(texts).toContain(token("Numero 1"));
    expect(texts).not.toContain("Calcolatrice");
  });

  test("the formula reads with the fields' names as tokens, operators plain between them", () => {
    const texts = drawn(mount({ type: "calculator", formula: "start / div", fields: named }, "it").toJSON());
    expect(texts).toContain(token("Valore iniziale"));
    expect(texts).toContain(token("Divisore"));
    expect(texts).toContain(" / ");
    expect(texts).not.toContain("start / div");
  });

  test("lifted fields read as Numero n in Italian, and the result takes a decimal comma", () => {
    const texts = drawn(mount({ type: "calculator", formula: "n1 / n2", fields: lifted }, "it").toJSON());
    expect(texts).toContain("Numero 1");
    expect(texts).toContain(token("Numero 1"));
    expect(texts).toContain(token("Numero 2"));
    expect(texts).toContain("12,5");
    expect(texts).not.toContain("12.5");
  });

  test("English keeps the dot", () => {
    const texts = drawn(mount({ type: "calculator", formula: "n1 / n2", fields: lifted }, "en").toJSON());
    expect(texts).toContain(token("Number 1"));
    expect(texts).toContain("12.5");
  });

  test("an Italian input reads as Italian writes numbers: 12.500 is 12500", () => {
    const renderer = mount({ type: "calculator", formula: "n1", fields: [{ id: "n1", value: 1 }] }, "it");
    const input = renderer.root.find((node) => String(node.type) === "TextInput");
    act(() => {
      input.props.onChangeText("12.500");
    });
    expect(drawn(renderer.toJSON())).toContain("12.500");
  });

  test("an English input reads as English writes numbers: 12.500 is 12.5", () => {
    const renderer = mount({ type: "calculator", formula: "n1", fields: [{ id: "n1", value: 1 }] }, "en");
    const input = renderer.root.find((node) => String(node.type) === "TextInput");
    act(() => {
      input.props.onChangeText("12.500");
    });
    expect(drawn(renderer.toJSON())).toContain("12.5");
  });

  test("the raw text stays while typing, and the parsed number persists with a dot decimal", () => {
    const saved: Record<string, unknown>[] = [];
    const renderer = mount(
      { type: "calculator", formula: "n1", fields: [{ id: "n1", value: 1 }] },
      "it",
      (state) => saved.push(state),
    );
    const input = () => renderer.root.find((node) => String(node.type) === "TextInput");
    act(() => {
      input().props.onChangeText("1,");
    });
    expect(input().props.value).toBe("1,");
    act(() => {
      input().props.onChangeText("12,5");
    });
    expect(saved[saved.length - 1]).toEqual({ calculator: { fields: { n1: 12.5 }, result: 12.5 } });
  });

  test("the result groups thousands the way the language does", () => {
    // Italian groups from five digits up (1234,5 stays ungrouped).
    const texts = drawn(
      mount({ type: "calculator", formula: "n1", fields: [{ id: "n1", value: 12345.5 }] }, "it").toJSON(),
    );
    expect(texts).toContain("12.345,5");
  });

  test("an input takes a comma or a dot, and the result follows it", () => {
    const renderer = mount({ type: "calculator", formula: "n1 * 2", fields: [{ id: "n1", value: 1 }] }, "it");
    const input = renderer.root.find((node) => String(node.type) === "TextInput");
    act(() => {
      input.props.onChangeText("1,5");
    });
    expect(drawn(renderer.toJSON())).toContain("3");
  });
});
