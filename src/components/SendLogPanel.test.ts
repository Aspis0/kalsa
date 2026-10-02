/**
 * The panel's send discipline, driven through the rendered tree: nothing sends
 * until the button press, the button is disabled while sending and after a
 * success (but re-arms after a failure), the id is shown, the failure copy is
 * picked by the mapped reason, a rejected send still lands on the failed copy,
 * a panel that mounts during a pending send joins it instead of starting a
 * second one, and a send that settles after unmount never touches state again.
 * Every test loads a fresh module registry: the session holder keeps the id,
 * so one shared instance would make the tests order-dependent.
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

// React 19 drops a state update on an unmounted tree without a word, so the
// late-settle test below counts the setter calls through this wrapper.
const mockLateUpdates = { unmounted: false, count: 0 };
jest.mock("react", () => {
  const actual = jest.requireActual("react") as typeof import("react");
  return {
    ...actual,
    useState: (initial: unknown) => {
      const [value, set] = actual.useState(initial);
      return [
        value,
        (next: unknown) => {
          if (mockLateUpdates.unmounted) mockLateUpdates.count += 1;
          return set(next as never);
        },
      ];
    },
  };
});

import type { ReactTestInstance, ReactTestRenderer } from "react-test-renderer";
import type { SendLogResult } from "../logReport/sendLog";

type PanelModules = {
  React: typeof import("react");
  act: typeof import("react-test-renderer").act;
  create: typeof import("react-test-renderer").create;
  SendLogPanel: typeof import("./SendLogPanel").SendLogPanel;
  sendLog: jest.Mock;
};

/** The panel, the session holder and the sendLog mock from one fresh registry. */
function loadPanel(): PanelModules {
  jest.resetModules();
  return {
    React: require("react"),
    act: require("react-test-renderer").act,
    create: require("react-test-renderer").create,
    SendLogPanel: require("./SendLogPanel").SendLogPanel,
    sendLog: require("../logReport/sendLog").sendLog,
  };
}

let modules: PanelModules;

beforeEach(() => {
  modules = loadPanel();
  mockLateUpdates.unmounted = false;
  mockLateUpdates.count = 0;
});

async function renderPanel(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await modules.act(async () => {
    renderer = modules.create(modules.React.createElement(modules.SendLogPanel));
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

async function press(renderer: ReactTestRenderer): Promise<void> {
  await modules.act(async () => {
    sendButton(renderer).props.onPress();
  });
}

async function unmount(renderer: ReactTestRenderer): Promise<void> {
  await modules.act(async () => {
    renderer.unmount();
  });
}

function pendingSend(): { attempt: Promise<SendLogResult>; release: (r: SendLogResult) => void } {
  let release!: (result: SendLogResult) => void;
  const attempt = new Promise<SendLogResult>((resolve) => {
    release = resolve;
  });
  return { attempt, release };
}

describe("the SendLogPanel", () => {
  it("sends nothing on mount and only on press", async () => {
    modules.sendLog.mockReturnValue(new Promise(() => undefined));
    const renderer = await renderPanel();

    expect(modules.sendLog).not.toHaveBeenCalled();
    await press(renderer);
    expect(modules.sendLog).toHaveBeenCalledTimes(1);
    await unmount(renderer);
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
    await unmount(renderer);
  });

  it("is disabled while sending and a second press does not re-send", async () => {
    modules.sendLog.mockReturnValue(new Promise(() => undefined));
    const renderer = await renderPanel();

    await press(renderer);
    expect(sendButton(renderer).props.disabled).toBe(true);
    await press(renderer);
    expect(modules.sendLog).toHaveBeenCalledTimes(1);
    await unmount(renderer);
  });

  it("shows the sentWithId sentence with the id and stays disabled after success", async () => {
    modules.sendLog.mockResolvedValue({ ok: true, id: "ABCD2345" });
    const renderer = await renderPanel();

    await press(renderer);

    expect(resultText(renderer).props.children).toBe("report.sentWithId#ABCD2345");
    expect(resultText(renderer).props.selectable).toBe(true);
    expect(sendButton(renderer).props.disabled).toBe(true);
    await press(renderer);
    expect(modules.sendLog).toHaveBeenCalledTimes(1);
    await unmount(renderer);
  });

  it("keeps the sent state and stays disabled after a remount", async () => {
    modules.sendLog.mockResolvedValue({ ok: true, id: "ABCD2345" });
    const first = await renderPanel();
    await press(first);
    await unmount(first);

    const second = await renderPanel();
    expect(modules.sendLog).toHaveBeenCalledTimes(1);
    expect(resultText(second).props.children).toBe("report.sentWithId#ABCD2345");
    expect(sendButton(second).props.disabled).toBe(true);
    await press(second);
    expect(modules.sendLog).toHaveBeenCalledTimes(1);
    await unmount(second);
  });

  it("joins a pending send when it remounts and never starts a second one", async () => {
    const { attempt, release } = pendingSend();
    modules.sendLog.mockReturnValue(attempt);

    const first = await renderPanel();
    await press(first);
    expect(modules.sendLog).toHaveBeenCalledTimes(1);
    await unmount(first);

    // The send is still in flight: the remounted panel shows sending, attaches
    // to that same request, and a press adds no upload.
    const second = await renderPanel();
    expect(sendButton(second).props.disabled).toBe(true);
    expect(sendButton(second).props.accessibilityLabel).toBe("report.sending");
    await press(second);
    expect(modules.sendLog).toHaveBeenCalledTimes(1);

    await modules.act(async () => {
      release({ ok: true, id: "ABCD2345" });
    });
    expect(resultText(second).props.children).toBe("report.sentWithId#ABCD2345");
    expect(sendButton(second).props.disabled).toBe(true);
    await unmount(second);
  });

  it("maps a sendLog rejection to the failed copy instead of hanging on sending", async () => {
    modules.sendLog.mockRejectedValue(new Error("reader threw"));
    const renderer = await renderPanel();

    await press(renderer);

    expect(resultText(renderer).props.children).toBe("report.errSend");
    expect(sendButton(renderer).props.disabled).toBe(false);
    await unmount(renderer);
  });

  it("announces the report number through a polite live region with the text role", async () => {
    modules.sendLog.mockResolvedValue({ ok: true, id: "ABCD2345" });
    const renderer = await renderPanel();

    await press(renderer);

    expect(resultText(renderer).props.accessibilityLiveRegion).toBe("polite");
    expect(resultText(renderer).props.accessibilityRole).toBe("text");
    await unmount(renderer);
  });

  it("re-arms after a failure so the tester can press again", async () => {
    modules.sendLog.mockResolvedValue({ ok: false, reason: "failed" });
    const renderer = await renderPanel();

    await press(renderer);
    expect(sendButton(renderer).props.disabled).toBe(false);

    await press(renderer);
    expect(modules.sendLog).toHaveBeenCalledTimes(2);
    await unmount(renderer);
  });

  it("never touches state when its send settles after unmount", async () => {
    const { attempt, release } = pendingSend();
    modules.sendLog.mockReturnValue(attempt);

    const renderer = await renderPanel();
    await press(renderer);
    await unmount(renderer);

    mockLateUpdates.unmounted = true;
    release({ ok: false, reason: "failed" });
    // A macrotask drains every queued microtask, the panel's handler included.
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockLateUpdates.count).toBe(0);
  });

  it.each([
    ["empty", "report.errEmpty"],
    ["rate_limited", "report.errRateLimited"],
    ["daily_limit", "report.errTryTomorrow"],
    ["failed", "report.errSend"],
  ])("shows the %s copy for reason %s", async (reason, expectedKey) => {
    modules.sendLog.mockResolvedValue({ ok: false, reason });
    const renderer = await renderPanel();

    await press(renderer);

    expect(resultText(renderer).props.children).toBe(expectedKey);
    expect(resultText(renderer).props.accessibilityLiveRegion).toBe("polite");
    await unmount(renderer);
  });
});
