/**
 * The panel's send discipline, driven through the rendered tree: nothing sends
 * until the button press, the button is disabled while sending and after a
 * success (but re-arms after a failure), the id is shown, the failure copy is
 * picked by the mapped reason, a rejected send still lands on the failed copy,
 * and a success survives a remount through the session holder.
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

// The holder is mocked so each test starts from a fresh session; `state` is
// the reset handle (the real module keeps its id private).
jest.mock("../logReport/lastReportId", () => {
  const state = { id: null as string | null };
  return {
    state,
    rememberReportId: (next: string) => {
      state.id = next;
    },
    lastReportId: () => state.id,
  };
});

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
const holder = jest.requireMock("../logReport/lastReportId") as {
  state: { id: string | null };
};

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
  holder.state.id = null;
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

  it("keeps the sent state and stays disabled after a remount", async () => {
    sendLogMock.mockResolvedValue({ ok: true, id: "ABCD2345" });
    const first = await renderPanel();
    await act(async () => {
      sendButton(first).props.onPress();
    });
    await act(async () => first.unmount());

    const second = await renderPanel();
    expect(sendLogMock).toHaveBeenCalledTimes(1);
    expect(resultText(second).props.children).toBe("report.sentWithId#ABCD2345");
    expect(sendButton(second).props.disabled).toBe(true);
    await act(async () => {
      sendButton(second).props.onPress();
    });
    expect(sendLogMock).toHaveBeenCalledTimes(1);
    await act(async () => second.unmount());
  });

  it("maps a sendLog rejection to the failed copy instead of hanging on sending", async () => {
    sendLogMock.mockRejectedValue(new Error("reader threw"));
    const renderer = await renderPanel();

    await act(async () => {
      sendButton(renderer).props.onPress();
    });

    expect(resultText(renderer).props.children).toBe("report.errSend");
    expect(sendButton(renderer).props.disabled).toBe(false);
    await act(async () => renderer.unmount());
  });

  it("announces the report number through a polite live region with the text role", async () => {
    sendLogMock.mockResolvedValue({ ok: true, id: "ABCD2345" });
    const renderer = await renderPanel();

    await act(async () => {
      sendButton(renderer).props.onPress();
    });

    expect(resultText(renderer).props.accessibilityLiveRegion).toBe("polite");
    expect(resultText(renderer).props.accessibilityRole).toBe("text");
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
    expect(resultText(renderer).props.accessibilityLiveRegion).toBe("polite");
    await act(async () => renderer.unmount());
  });
});
