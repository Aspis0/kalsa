/**
 * The browser card, driven through the rendered tree (PHONE-CHAT-PROTOCOL
 * §3.1). What it must do: show every field as it would really be sent, keep a
 * secret behind a Show button, take one press and only one, and go quiet at
 * the deadline.
 *
 * The press reaches the real route client, which is mocked here: what is under
 * test is the card's own discipline, not the road to the computer.
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
import { SECRET_DOTS, type BrowserCardEntry } from "../../domain/browserCardPayload";
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

describe("a request held for the person", () => {
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

  it("draws the host, and each field with a value as the label the page gave it", async () => {
    const renderer = await render(entry());
    expect(textOf(renderer, "transcript.browserCard.title")).toBe(
      'chat.browser.wantsToSend:{"host":"shop.example"}',
    );
    // The label the page gives is drawn beside the value; a field with none is its name.
    expect(textOf(renderer, "transcript.browserCard.label.0")).toBe("Taglia:");
    expect(has(renderer, "transcript.browserCard.insecure")).toBe(false);
    expect(textOf(renderer, "transcript.browserCard.field.0")).toBe("L");
    expect(textOf(renderer, "transcript.browserCard.label.1")).toBe("passphrase_2:");
    expect(textOf(renderer, "transcript.browserCard.deadline")).toBe(
      "chat.browser.answerWithin:{\"time\":\"5:00\"}",
    );
    // No method, no path, no query: the host is all there is of the address.
    expect(has(renderer, "transcript.browserCard.method")).toBe(false);
    expect(has(renderer, "transcript.browserCard.url")).toBe(false);
    expect(texts(renderer).join(" ")).not.toMatch(/POST|checkout|size=L/);
  });

  it("a secret is dots until the person asks, and nothing else is masked", async () => {
    const renderer = await render(entry());
    expect(textOf(renderer, "transcript.browserCard.field.1")).toBe(SECRET_DOTS);
    // Not one character of it anywhere in what is drawn.
    expect(texts(renderer).join(" ")).not.toContain("hunter2");

    await press(renderer, "transcript.browserCard.toggle.1");
    expect(textOf(renderer, "transcript.browserCard.field.1")).toBe("hunter2");
    // What is not a secret was never dotted.
    expect(textOf(renderer, "transcript.browserCard.field.0")).toBe("L");

    // Revealed and then pressed: while the answer travels the value is nobody's
    // business, so the secret is dots again.
    mockAnswer.mockReturnValue(new Promise(() => {}));
    await press(renderer, "transcript.browserCard.send");
    expect(textOf(renderer, "transcript.browserCard.field.1")).toBe(SECRET_DOTS);
    expect(texts(renderer).join(" ")).not.toContain("hunter2");
  });

  it("a field with no value is not asked about", async () => {
    const withEmpty = entry();
    withEmpty.card.fields = [{ name: "size", label: "Taglia", value: "L", secret: false }, { name: "note", label: null, value: "", secret: false }];
    expect(has(await render(withEmpty), "transcript.browserCard.label.1")).toBe(false);
  });

  it("pressing Show on one field reveals that field only", async () => {
    const two = entry();
    two.card.fields = [
      { name: "size", label: null, value: "L", secret: false },
      { name: "a_secret", label: null, value: "one", secret: true },
      { name: "b_secret", label: null, value: "two", secret: true },
    ];
    const renderer = await render(two);
    await press(renderer, "transcript.browserCard.toggle.1");
    expect(textOf(renderer, "transcript.browserCard.field.1")).toBe("one");
    expect(textOf(renderer, "transcript.browserCard.field.2")).toBe(SECRET_DOTS);
  });

  it("one press sends, and the outcome is what the card says next", async () => {
    const renderer = await render(entry());
    await press(renderer, "transcript.browserCard.send");
    expect(mockAnswer).toHaveBeenCalledWith(CARD_ID, "send");
    expect(textOf(renderer, "transcript.browserCard.outcome")).toBe(
      'chat.browser.sentTo:{"to":"shop.example"}',
    );
  });

  it("Cancel is the other answer and is spent exactly like Send", async () => {
    mockAnswer.mockResolvedValue({ ok: true, outcome: { code: "declined", host: "" } });
    const renderer = await render(entry());
    await press(renderer, "transcript.browserCard.decline");
    expect(mockAnswer).toHaveBeenCalledWith(CARD_ID, "decline");
    expect(textOf(renderer, "transcript.browserCard.outcome")).toBe("chat.browser.declined");
  });

  it("a spent card cannot be pressed again: the buttons are gone, not greyed", async () => {
    const renderer = await render(entry());
    await press(renderer, "transcript.browserCard.send");
    expect(has(renderer, "transcript.browserCard.send")).toBe(false);
    expect(has(renderer, "transcript.browserCard.decline")).toBe(false);
    expect(mockAnswer).toHaveBeenCalledTimes(1);
  });

  it("a refused answer says so in plain words and is still spent", async () => {
    mockAnswer.mockResolvedValue({ ok: false, errorCode: "card_unknown" });
    const renderer = await render(entry());
    await press(renderer, "transcript.browserCard.send");
    expect(textOf(renderer, "transcript.browserCard.failed")).toBe("chat.browser.failSpent");
    expect(has(renderer, "transcript.browserCard.send")).toBe(false);
  });

  it("an answer that blows up settles the card and leaves no value drawn", async () => {
    mockAnswer.mockRejectedValue(new Error("boom"));
    const renderer = await render(entry());
    await press(renderer, "transcript.browserCard.send");
    // The road died: the card says what it cannot know, and none of the
    // request is left on the screen.
    expect(textOf(renderer, "transcript.browserCard.outcome")).toBe("chat.browser.failUncertain");
    expect(has(renderer, "transcript.browserCard.title")).toBe(false);
    expect(has(renderer, "transcript.browserCard.field.1")).toBe(false);
    expect(texts(renderer).join(" ")).not.toContain("hunter2");
  });

  it("a failure that proves nothing was sent SAYS nothing was sent", async () => {
    for (const code of ["card_expired", "card_unknown"]) {
      mockAnswer.mockResolvedValue({ ok: false, errorCode: code });
      const renderer = await render(entry());
      await press(renderer, "transcript.browserCard.send");
      expect(textOf(renderer, "transcript.browserCard.outcome")).toBe(
        `chat.browser.${code === "card_expired" ? "failExpired" : "failSpent"}`,
      );
    }
  });

  it("a failure that proves NOTHING is silent about what happened", async () => {
    // The request may already have been in the browser's hands: saying "nothing
    // was sent" here would have a person buy the same thing twice.
    for (const code of ["remote_brain_network", "browser_unreadable", "card_wat"]) {
      mockAnswer.mockResolvedValue({ ok: false, errorCode: code });
      const renderer = await render(entry());
      await press(renderer, "transcript.browserCard.send");
      expect(textOf(renderer, "transcript.browserCard.outcome")).toBe("chat.browser.failUncertain");
      expect(texts(renderer).join(" ")).not.toContain("Nothing was sent");
      expect(texts(renderer).join(" ")).not.toContain("Non è stato inviato");
    }
  });

  it("a later outcome from the computer wins over the local failure", async () => {
    mockAnswer.mockResolvedValue({ ok: false, errorCode: "remote_brain_network" });
    const renderer = await render(entry());
    await press(renderer, "transcript.browserCard.send");
    expect(textOf(renderer, "transcript.browserCard.outcome")).toBe("chat.browser.failUncertain");

    // The computer's own word about the same card arrives afterwards.
    await act(async () => {
      renderer.update(
        React.createElement(BrowserConfirmCard, {
          entry: entry({ outcome: { code: "declined", host: "" } }),
          colors: modes.light,
        }),
      );
    });

    expect(textOf(renderer, "transcript.browserCard.outcome")).toBe("chat.browser.declined");
    // One story per card: the raw refusal is not left underneath it.
    expect(has(renderer, "transcript.browserCard.failed")).toBe(false);
  });

  it("a road failure never echoes a code the contract does not name", async () => {
    mockAnswer.mockResolvedValue({ ok: false, errorCode: "remote_brain_network" });
    const renderer = await render(entry());
    await press(renderer, "transcript.browserCard.send");
    expect(texts(renderer).join(" ")).not.toContain("remote_brain_network");
  });

  it("past the deadline the card asks nothing of anybody", async () => {
    // Same card, five minutes later: the deadline is the computer's own number
    // and the phone's clock is what compares it.
    (performance.now as jest.Mock).mockReturnValue(BY);
    const renderer = await render(entry());
    expect(textOf(renderer, "transcript.browserCard.expired")).toBe("chat.browser.expired");
    expect(has(renderer, "transcript.browserCard.send")).toBe(false);
    expect(has(renderer, "transcript.browserCard.decline")).toBe(false);
  });

  it("a revealed value dies with the card that revealed it", async () => {
    const renderer = await render(entry());
    await press(renderer, "transcript.browserCard.toggle.1");
    expect(texts(renderer).join(" ")).toContain("hunter2");
    // Answered: §6 says the value goes, and it goes with the flags that drew it.
    await press(renderer, "transcript.browserCard.send");
    expect(texts(renderer).join(" ")).not.toContain("hunter2");
    expect(has(renderer, "transcript.browserCard.field.1")).toBe(false);
  });

  it("answering tells the message to give the value back", async () => {
    const renderer = await render(entry());
    await press(renderer, "transcript.browserCard.send");
    expect(mockSpent).toHaveBeenCalledWith(CARD_ID);
  });

  it("a card already settled by an outcome spends itself on mount", async () => {
    await render(entry({ outcome: { code: "gone", host: "" } }));
    expect(mockSpent).toHaveBeenCalledWith(CARD_ID);
  });

  it("a card past its deadline spends itself, with nothing pressed", async () => {
    (performance.now as jest.Mock).mockReturnValue(BY);
    await render(entry());
    expect(mockSpent).toHaveBeenCalledWith(CARD_ID);
  });

  it("a live card spends nothing: it may still be answered", async () => {
    await render(entry());
    expect(mockSpent).not.toHaveBeenCalled();
  });

  it("a settled card is one line: no host, no fields, no dots", async () => {
    const renderer = await render(entry());
    await press(renderer, "transcript.browserCard.send");
    expect(has(renderer, "transcript.browserCard.title")).toBe(false);
    expect(has(renderer, "transcript.browserCard.label.0")).toBe(false);
    expect(has(renderer, "transcript.browserCard.toggle.1")).toBe(false);
    expect(texts(renderer).join(" ")).not.toContain(SECRET_DOTS);
    // The one line names the host it went to, and never the path or the query.
    expect(texts(renderer).join(" ")).not.toContain("checkout");
  });

  it("a card the message gave back draws no values and no Show behind them", async () => {
    const spent = entry({ outcome: { code: "gone", host: "" } });
    spent.card.fields = [
      { name: "size", label: null, value: null, secret: false },
      { name: "passphrase_2", label: null, value: null, secret: true },
    ];
    const renderer = await render(spent);
    expect(has(renderer, "transcript.browserCard.field.1")).toBe(false);
    expect(has(renderer, "transcript.browserCard.toggle.1")).toBe(false);
    expect(textOf(renderer, "transcript.browserCard.outcome")).toBe("chat.browser.gone");
  });

  it("an outcome the phone did not ask for is drawn on the card it belongs to", async () => {
    const renderer = await render(
      entry({ outcome: { code: "declined", host: "" } }),
    );
    expect(textOf(renderer, "transcript.browserCard.outcome")).toBe("chat.browser.declined");
    expect(has(renderer, "transcript.browserCard.send")).toBe(false);
  });
});