/**
 * The crash prompt, driven through the rendered tree: it asks only after the
 * decision says the previous exit was unclean, "Not now" hides it for the run,
 * and Send goes through the panel's one-shot sender on the press — never on
 * mount, never twice. The decision, the native module and AsyncStorage are all
 * mocked away; nothing here touches Android or the network.
 */
const mockAsk = jest.fn();

jest.mock("../logReport/uncleanExit", () => ({
  consumeUncleanExitAsk: () => mockAsk(),
}));

jest.mock("../logReport/sendLogOnce", () => ({
  reportSession: () => ({ id: null, inFlight: null }),
  sendLogOnce: jest.fn(),
}));

jest.mock("react-native", () => {
  const react = require("react") as typeof import("react");
  const host = (name: string) => (props: Record<string, unknown>) =>
    react.createElement(name, props, props.children as React.ReactNode);
  return {
    Modal: host("Modal"),
    Pressable: host("Pressable"),
    Text: host("Text"),
    View: host("View"),
  };
});

jest.mock("../i18n", () => ({
  useLocale: () => ({ t: (key: string) => key }),
}));

jest.mock("../ui/labTheme", () => ({
  useLabTheme: () => ({
    colors: { ink: "#111", muted: "#666", panelSolid: "#ffffff" },
  }),
}));

jest.mock("../theme/typography", () => ({
  useTypography: () => ({ title: {}, bodySm: {} }),
  fontFamilies: { displayBold: "Inter_700Bold", bodySemi: "Inter_600SemiBold" },
}));

import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { UncleanExitPrompt } from "./UncleanExitPrompt";
import { sendLogOnce } from "../logReport/sendLogOnce";

const send = sendLogOnce as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

async function render(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(UncleanExitPrompt));
  });
  return renderer;
}

async function press(renderer: ReactTestRenderer, testID: string): Promise<void> {
  await act(async () => {
    renderer.root.find((node) => node.props.testID === testID).props.onPress();
  });
}

function texts(renderer: ReactTestRenderer): string[] {
  return renderer.root
    .findAll((node) => typeof node.props.children === "string")
    .map((node) => node.props.children as string);
}

describe("the unclean-exit prompt", () => {
  it("asks nothing when the previous exit was clean", async () => {
    mockAsk.mockResolvedValue(false);
    const renderer = await render();

    expect(mockAsk).toHaveBeenCalledTimes(1);
    expect(renderer.toJSON()).toBeNull();
  });

  it("shows the approved ask once after an unclean exit", async () => {
    mockAsk.mockResolvedValue(true);
    const renderer = await render();

    expect(mockAsk).toHaveBeenCalledTimes(1);
    expect(texts(renderer)).toEqual(
      expect.arrayContaining([
        "report.crashUncleanTitle",
        "report.crashUncleanBody",
        "report.privacy",
        "report.send",
        "report.notNow",
      ]),
    );
  });

  it("holds the ask back until the decision resolves", async () => {
    let release!: (ask: boolean) => void;
    mockAsk.mockReturnValue(
      new Promise<boolean>((resolve) => {
        release = resolve;
      }),
    );
    const renderer = await render();
    expect(renderer.toJSON()).toBeNull();

    await act(async () => {
      release(true);
    });
    expect(texts(renderer)).toContain("report.crashUncleanTitle");
  });

  it("hides the prompt on Not now without sending", async () => {
    mockAsk.mockResolvedValue(true);
    const renderer = await render();

    await press(renderer, "uncleanExit.notNow");

    expect(renderer.toJSON()).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it("never sends on mount and sends once on the Send press", async () => {
    mockAsk.mockResolvedValue(true);
    send.mockReturnValue(new Promise(() => undefined));
    const renderer = await render();
    expect(send).not.toHaveBeenCalled();

    await press(renderer, "sendlog.send");
    expect(send).toHaveBeenCalledTimes(1);

    await press(renderer, "sendlog.send");
    expect(send).toHaveBeenCalledTimes(1);
  });
});
