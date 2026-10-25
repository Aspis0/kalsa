/**
 * The press behind a browser card (PHONE-CHAT-PROTOCOL §3.1): one press ever,
 * the answer it waits for, the failure it reports, and the values the card
 * gives back the moment it is spent.
 *
 * Driven through the rendered tree: the press reaches the real route client,
 * which is mocked here — what is under test is the card's own discipline, not
 * the road to the computer.
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
import type { BrowserCardEntry } from "../../domain/browserCardPayload";
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

describe("the press behind a request held for the person", () => {
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

  it("an outcome the phone did not ask for is drawn on the card it belongs to", async () => {
    const renderer = await render(
      entry({ outcome: { code: "declined", host: "" } }),
    );
    expect(textOf(renderer, "transcript.browserCard.outcome")).toBe("chat.browser.declined");
    expect(has(renderer, "transcript.browserCard.send")).toBe(false);
  });
});
