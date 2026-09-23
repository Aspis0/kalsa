/**
 * Privacy disclosure: choosing an address here is also the act that uploads
 * conversation content to it, so the panel must say WHAT is sent before the
 * "Use my computer" button can be pressed.
 *
 * Renders the real component (RN primitives mocked as host tags; `t` resolves
 * the real English strings) and asserts the owner-approved line is on screen
 * and sits above the button, in render order.
 */
jest.mock("react-native", () => {
  const react = require("react") as typeof import("react");
  const host = (name: string) => (props: Record<string, unknown>) =>
    react.createElement(name, props, props.children as React.ReactNode);
  return {
    ActivityIndicator: host("ActivityIndicator"),
    Pressable: host("Pressable"),
    Text: host("Text"),
    TextInput: host("TextInput"),
    View: host("View"),
  };
});

jest.mock("../i18n", () => {
  const en = (require("../i18n/en") as typeof import("../i18n/en")).en;
  // Resolve dotted keys against the real English catalog so the test pins the
  // exact shipped wording, not an internal key.
  const t = (key: string) => {
    let node: unknown = en;
    for (const part of key.split(".")) {
      if (typeof node !== "object" || node === null) return key;
      node = (node as Record<string, unknown>)[part];
    }
    return typeof node === "string" ? node : key;
  };
  return { useLocale: () => ({ t }) };
});

jest.mock("../theme/components", () => ({
  GlassPanel2: (props: Record<string, unknown>) =>
    require("react").createElement(
      "GlassPanel2",
      null,
      props.children as React.ReactNode,
    ),
}));

jest.mock("../theme/tokens", () => ({
  radius: { md: 8 },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16 },
}));

jest.mock("../theme/typography", () => ({
  fontFamilies: { bodySemi: "semi" },
  useTypography: () => ({ bodySm: {}, bodyXs: {} }),
}));

jest.mock("../ui/labTheme", () => ({
  useLabTheme: () => ({
    colors: {
      accent: "#0af",
      bad: "#f00",
      ink: "#111",
      line: "#ccc",
      muted: "#777",
      primaryText: "#fff",
    },
  }),
}));

jest.mock("../engine/engineBackend", () => ({
  testRemoteConnection: jest.fn(),
}));

jest.mock("../engine/remote/remoteSettings", () => ({
  DEFAULT_REMOTE_MAX_TOKENS: 4096,
  hydrateRemoteBrainSettings: jest.fn(),
  isHydrationCurrent: () => true,
  isRemoteEngineBackend: () => false,
  setRemoteBrainUrl: jest.fn(),
  setRemoteMaxTokens: jest.fn(),
  setRemoteServerModelId: jest.fn(),
}));

jest.mock("../engine/remote/remoteSecret", () => ({
  getRemoteBrainToken: jest.fn(),
  setRemoteBrainToken: jest.fn(),
}));

import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { en } from "../i18n/en";
import { it as itLocale } from "../i18n/it";
import { RemoteBrainSettings } from "./RemoteBrainSettings";

const previousActEnvironment = (
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// react-test-renderer logs a deprecation notice on every create(); keep the
// suite output readable.
beforeAll(() => {
  const realError = console.error;
  jest.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (
      typeof args[0] === "string" &&
      args[0].includes("react-test-renderer is deprecated")
    ) {
      return;
    }
    realError(...args);
  });
});

afterAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  jest.restoreAllMocks();
});

beforeEach(() => {
  jest.clearAllMocks();
  const settingsMock = jest.requireMock(
    "../engine/remote/remoteSettings",
  ) as Record<string, jest.Mock>;
  const secretMock = jest.requireMock(
    "../engine/remote/remoteSecret",
  ) as Record<string, jest.Mock>;
  (settingsMock.hydrateRemoteBrainSettings as jest.Mock).mockResolvedValue({
    backend: "local",
    url: "",
    urlNeverSet: true,
    hydrationOk: true,
    urlParseError: null,
    serverModelId: "",
    maxTokens: 4096,
    temperature: 0.7,
    ctx: 32768,
  });
  (secretMock.getRemoteBrainToken as jest.Mock).mockResolvedValue(null);
});

// Owner wording (Marco, fix round 1) — pinned as literals so a copy regression
// fails here, not in review.
const DISCLOSURE =
  "To answer, your computer receives the conversation: messages, notes you attach, memory, summaries and document names.";
const SELECT_LABEL = en.settings.remoteSelect;

test("the shipped disclosure and its Italian mirror are the owner's exact texts", () => {
  expect(en.settings.remoteBrainDisclosure).toBe(DISCLOSURE);
  expect(itLocale.settings.remoteBrainDisclosure).toBe(
    "Per rispondere, il tuo computer riceve la conversazione: messaggi, note che alleghi, memoria, riassunti e nomi dei documenti.",
  );
});

test("the hint no longer claims voice is off in remote mode", () => {
  // Dictation runs on local whisper and needs no local chat LLM (traced in
  // STEP2.md fix round 1), so the promise would be false.
  expect(en.settings.remoteBrainHint).not.toMatch(/voice/);
  expect(itLocale.settings.remoteBrainHint).not.toMatch(/voce/);
});

it("shows what is sent, above the Use my computer button", async () => {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      React.createElement(RemoteBrainSettings, {
        currentModelId: "qwen4b",
        busy: false,
        onSelectModel: jest.fn(),
      }),
    );
  });

  // Document order: react-test-renderer walks depth-first, so index order is
  // render order — the disclosure must be reachable before the button label.
  const textNodes = renderer.root.findAll(
    (node) => (node.type as unknown as string) === "Text",
  );
  const labels = textNodes.map((node) => node.props.children);
  const disclosureIndex = labels.indexOf(DISCLOSURE);
  const buttonIndex = labels.indexOf(SELECT_LABEL);

  expect(disclosureIndex).toBeGreaterThanOrEqual(0);
  expect(buttonIndex).toBeGreaterThanOrEqual(0);
  expect(disclosureIndex).toBeLessThan(buttonIndex);
});
