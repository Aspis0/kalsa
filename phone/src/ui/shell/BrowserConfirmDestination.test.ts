/**
 * The destination the computer sent, as the card names it (PHONE-CHAT-PROTOCOL §3.1):
 * the host as it arrives, a port only when there is one, a plain connection said so, and
 * no host and no Send at all when there is no destination.
 */
const mockAnswer = jest.fn();
const mockSpent = jest.fn();

// The card asks through the context, so this suite mocks the CONTEXT: the card
// itself must never be able to reach the network client (see browserActions).
jest.mock("./browserActions", () => ({
  useBrowserActions: () => ({
    answerCard: (...args: unknown[]) => mockAnswer(...args),
    spentBrowserCard: mockSpent,
  }),
}));

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

jest.mock("../../i18n", () => ({
  useLocale: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params === undefined ? key : `${key}:${JSON.stringify(params)}`,
  }),
}));

import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

import { BrowserConfirmCard } from "./BrowserConfirmCard";
import { SECRET_DOTS, stripCardValues, type BrowserCardEntry } from "../../domain/browserCardPayload";
import { modes } from "../../theme/design";

const CARD_ID = "3f9c1a77e2b04d5681aa90c3b7e4412d";
/** The card's budget is on this phone's clock, so the test drives that one:
 *  `performance.now()` where the runtime has it, `Date.now()` where it has
 *  not (`monotonicNowMs`). An absolute wall-clock stamp would be a day out. */
const NOW = 1_000;
const BY = NOW + 300_000;

function entry(over: Partial<BrowserCardEntry> = {}): BrowserCardEntry {
  return {
    card: {
      cardId: CARD_ID,
      method: "POST",
      url: "https://shop.example/checkout?size=L&passphrase_2=hunter2",
      destination: { host: "shop.example", port: null, secure: true },
      fields: [
        { name: "size", label: "Taglia", value: "L", secret: false },
        { name: "passphrase_2", label: null, value: "hunter2", secret: true },
      ],
      deadlineAtMs: BY,
      ...(over.card ?? {}),
    },
    ...(over.outcome ? { outcome: over.outcome } : {}),
  };
}

/** One renderer at a time, always unmounted: a card left mounted keeps its
 *  one-second budget tick alive past the suite, and a jest run that logs after
 *  its tests are done exits non-zero on suites that all passed. */
let mounted: ReactTestRenderer | null = null;

async function render(value: BrowserCardEntry): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      React.createElement(BrowserConfirmCard, { entry: value, colors: modes.light }),
    );
  });
  mounted = renderer;
  return renderer;
}

async function press(renderer: ReactTestRenderer, testID: string): Promise<void> {
  await act(async () => {
    renderer.root.find((node) => node.props.testID === testID).props.onPress();
  });
}

function textOf(renderer: ReactTestRenderer, testID: string): string {
  return renderer.root.find((node) => node.props.testID === testID).props.children as string;
}

function texts(renderer: ReactTestRenderer): string[] {
  return renderer.root
    .findAll((node) => typeof node.props.children === "string")
    .map((node) => node.props.children as string);
}

function has(renderer: ReactTestRenderer, testID: string): boolean {
  return renderer.root.findAll((node) => node.props.testID === testID).length > 0;
}

describe("where the request goes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAnswer.mockResolvedValue({ ok: true, outcome: { code: "sent", host: "shop.example" } });
    jest.spyOn(performance, "now").mockReturnValue(NOW);
  });

  afterEach(async () => {
    // Unmounted before the clock goes back: a card left drawn would keep its
    // deadline timer alive past the test and tick into the next one.
    if (mounted) await act(async () => mounted?.unmount());
    mounted = null;
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockAnswer.mockResolvedValue({ ok: true, outcome: { code: "sent", host: "shop.example" } });
    jest.spyOn(performance, "now").mockReturnValue(NOW);
  });

  afterEach(async () => {
    // Unmounted before the clock goes back: a card left drawn would keep its
    // deadline timer alive past the test and tick into the next one.
    if (mounted) await act(async () => mounted?.unmount());
    mounted = null;
    jest.restoreAllMocks();
  });

  it("a host is shown with its port only when the computer named one, and a plain connection says so", async () => {
    const plain = entry();
    plain.card.destination = { host: "shop.example", port: 8080, secure: false };
    const renderer = await render(plain);
    expect(textOf(renderer, "transcript.browserCard.title")).toBe('chat.browser.wantsToSend:{"host":"shop.example:8080"}');
    expect(textOf(renderer, "transcript.browserCard.insecure")).toBe("chat.browser.insecure");
  });

  it("a card with no destination names no host, says why in one line, and cannot be sent", async () => {
    const nowhere = entry();
    nowhere.card.destination = null;
    const renderer = await render(nowhere);
    expect(textOf(renderer, "transcript.browserCard.title")).toBe("chat.browser.noDestination");
    expect(has(renderer, "transcript.browserCard.send")).toBe(false);
    // It can still be declined, which needs no destination at all.
    await press(renderer, "transcript.browserCard.decline");
    expect(mockAnswer).toHaveBeenCalledWith(CARD_ID, "decline");
  });

  it("the host is still named while the answer is on the road", async () => {
    // The answer does not come back straight away.
    mockAnswer.mockReturnValue(new Promise(() => {}));
    const renderer = await render(entry());
    await press(renderer, "transcript.browserCard.send");

    // The card is spent at the press, so the message takes the host and the
    // values back in the same breath: the card must not blink while it waits.
    await act(async () => {
      renderer.update(
        React.createElement(BrowserConfirmCard, {
          entry: { card: stripCardValues(entry().card) },
          colors: modes.light,
        }),
      );
    });

    expect(textOf(renderer, "transcript.browserCard.title")).toBe(
      'chat.browser.wantsToSend:{"host":"shop.example"}',
    );
    expect(textOf(renderer, "transcript.browserCard.field.0")).toBe("L");
    expect(textOf(renderer, "transcript.browserCard.field.1")).toBe(SECRET_DOTS);
  });

  it("a card that never had a destination still says so while the answer is on the road", async () => {
    mockAnswer.mockReturnValue(new Promise(() => {}));
    const nowhere = entry();
    nowhere.card.destination = null;
    const renderer = await render(nowhere);
    await press(renderer, "transcript.browserCard.decline");

    await act(async () => {
      renderer.update(
        React.createElement(BrowserConfirmCard, {
          entry: { card: stripCardValues(nowhere.card) },
          colors: modes.light,
        }),
      );
    });

    expect(textOf(renderer, "transcript.browserCard.title")).toBe("chat.browser.noDestination");
  });
});
