/**
 * The panel's send discipline, driven through the rendered tree: nothing sends
 * until the button press, the button is disabled while sending and after a
 * success (but re-arms after a failure), the id is shown, and the failure copy
 * is picked by the mapped reason.
 */

jest.mock("react-native", () => {
  const react = require("react") as typeof import("react");
  const host = (name: string) => (props: Record<string, unknown>) =>
    react.createElement(name, props, props.children as React.ReactNode);
  return {
    Pressable: host("Pressable"),
    Text: host("Text"),
    View: host("View"),
  };
});

jest.mock("../i18n", () => ({
  useLocale: () => ({
    t: (key: string, params?: Record<string, string | number>) =>
      params && "id" in params ? `${key}#${params.id}` : key,
  }),
}));

jest.mock("../logReport/sendLog", () => ({
  sendLog: jest.fn(),
}));

jest.mock("../ui/labTheme", () => ({
  useLabTheme: () => ({
    colors: { ink: "#111", muted: "#666", accent: "#1f5f4e", primaryText: "#fff" },
  }),
}));

jest.mock("../theme/typography", () => ({
  useTypography: () => ({ title: {}, bodySm: {} }),
  fontFamilies: { displayBold: "Inter_700Bold" },
}));

import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { SendLogPanel } from "./SendLogPanel";
import { sendLog } from "../logReport/sendLog";

const sendLogMock = sendLog as jest.Mock;

async function renderPanel(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(SendLogPanel));
  });
  return renderer;
}

function sendButton(renderer: ReactTestRenderer): ReactTestInstance {
  return renderer.root.find((node) => node.props.testID === "sendlog.send");
}

/** findByProps is shallow here, so this is the panel's own Text, not its host twin. */
function resultText(renderer: ReactTestRenderer): ReactTestInstance {
  return renderer.root.findByProps({ testID: "sendlog.result" });
}

beforeEach(() => {
  sendLogMock.mockReset();
});

describe("the SendLogPanel", () => {
  it("sends nothing on mount and only on press", async () => {
    sendLogMock.mockReturnValue(new Promise(() => undefined));
    const renderer = await renderPanel();

    expect(sendLogMock).not.toHaveBeenCalled();
    await act(async () => {
      sendButton(renderer).props.onPress();
    });
    expect(sendLogMock).toHaveBeenCalledTimes(1);
    await act(async () => renderer.unmount());
  });

  it("renders the privacy sentence above the send button", async () => {
    const renderer = await renderPanel();
    const all = renderer.root.findAll(() => true);
    const privacyIndex = all.findIndex((node) => node.props.children === "report.privacy");
    const buttonIndex = all.indexOf(
      renderer.root.find((node) => node.props.testID === "sendlog.send"),
    );
    expect(privacyIndex).toBeGreaterThanOrEqual(0);
    expect(privacyIndex).toBeLessThan(buttonIndex);
    await act(async () => renderer.unmount());
  });

  it("is disabled while sending and a second press does not re-send", async () => {
    sendLogMock.mockReturnValue(new Promise(() => undefined));
    const renderer = await renderPanel();

    await act(async () => {
      sendButton(renderer).props.onPress();
    });
    expect(sendButton(renderer).props.disabled).toBe(true);
    await act(async () => {
      sendButton(renderer).props.onPress();
    });
    expect(sendLogMock).toHaveBeenCalledTimes(1);
    await act(async () => renderer.unmount());
  });

  it("shows the sentWithId sentence with the id and stays disabled after success", async () => {
    sendLogMock.mockResolvedValue({ ok: true, id: "ABCD2345" });
    const renderer = await renderPanel();

    await act(async () => {
      sendButton(renderer).props.onPress();
    });

    expect(resultText(renderer).props.children).toBe("report.sentWithId#ABCD2345");
    expect(resultText(renderer).props.selectable).toBe(true);
    expect(sendButton(renderer).props.disabled).toBe(true);
    await act(async () => {
      sendButton(renderer).props.onPress();
    });
    expect(sendLogMock).toHaveBeenCalledTimes(1);
    await act(async () => renderer.unmount());
  });

  it("re-arms after a failure so the tester can press again", async () => {
    sendLogMock.mockResolvedValue({ ok: false, reason: "failed" });
    const renderer = await renderPanel();

    await act(async () => {
      sendButton(renderer).props.onPress();
    });
    expect(sendButton(renderer).props.disabled).toBe(false);

    await act(async () => {
      sendButton(renderer).props.onPress();
    });
    expect(sendLogMock).toHaveBeenCalledTimes(2);
    await act(async () => renderer.unmount());
  });

  it.each([
    ["empty", "report.errEmpty"],
    ["rate_limited", "report.errRateLimited"],
    ["daily_limit", "report.errTryTomorrow"],
    ["failed", "report.errSend"],
  ])("shows the %s copy for reason %s", async (reason, expectedKey) => {
    sendLogMock.mockResolvedValue({ ok: false, reason });
    const renderer = await renderPanel();

    await act(async () => {
      sendButton(renderer).props.onPress();
    });

    expect(resultText(renderer).props.children).toBe(expectedKey);
    await act(async () => renderer.unmount());
  });
});
