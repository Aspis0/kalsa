/**
 * A card's budget ends whether or not anyone is looking at it (PHONE-CHAT-PROTOCOL
 * §6). The transcript virtualizes its rows, so a card scrolled out of view is
 * unmounted and its own timer is gone — the conversation's sweep is what
 * actually gives the values back.
 */
import { expireBrowserCards } from "./browserCardState";
import { useBrowserExpiry } from "./useBrowserExpiry";
import { monotonicNowMs } from "../domain/browserCardPayload";
import type { Message } from "./hostMessage";

const NOW = 1_000;
const BY = NOW + 300_000;
const ID_A = "3f9c1a77e2b04d5681aa90c3b7e4412d";
const ID_B = "aa11bb22cc33dd44ee55ff6677889900";

function held(cardId: string, deadlineAtMs: number, url: string | null = "https://shop.example/x") {
  return {
    card: {
      cardId,
      method: "POST",
      url,
      fields: [{ name: "passphrase_2", label: null, value: "hunter2", secret: true }],
      deadlineAtMs,
    },
  };
}

function conversation(): Message[] {
  return [
    { id: "a0", role: "assistant", text: "prima", createdAt: 0, browserCards: [held(ID_A, BY)] },
    { id: "a1", role: "assistant", text: "poi", createdAt: 1, browserCards: [held(ID_B, BY + 60_000)] },
  ];
}

describe("the conversation's own sweep", () => {
  beforeEach(() => jest.spyOn(performance, "now").mockReturnValue(NOW));
  afterEach(() => jest.restoreAllMocks());

  it("a card with time left keeps everything", () => {
    const before = conversation();
    expect(expireBrowserCards(before, NOW + 299_999)).toBe(before);
  });

  it("a card past its budget gives back its values AND its address, mounted or not", () => {
    // No card is drawn anywhere in this file: that is the whole point.
    const after = expireBrowserCards(conversation(), BY + 1);
    expect(after[0].browserCards?.[0].card.fields[0].value).toBeNull();
    expect(after[0].browserCards?.[0].card.url).toBeNull();
    expect(JSON.stringify(after[0])).not.toContain("hunter2");
    expect(JSON.stringify(after[0])).not.toContain("shop.example");
  });

  it("a card still inside its own budget is left alone", () => {
    const after = expireBrowserCards(conversation(), BY + 1);
    expect(after[1].browserCards?.[0].card.fields[0].value).toBe("hunter2");
    expect(after[1].browserCards?.[0].card.url).toBe("https://shop.example/x");
  });

  it("nothing expired means the SAME array, so an idle conversation does no work", () => {
    const before = conversation();
    expect(expireBrowserCards(before, NOW)).toBe(before);
  });

  it("sweeping twice strips once", () => {
    const once = expireBrowserCards(conversation(), BY + 1);
    expect(expireBrowserCards(once, BY + 1)).toBe(once);
  });
});

describe("the hook that runs that sweep", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(performance, "now").mockReturnValue(NOW);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  /** Mounted the way the host mounts it: a setter, and no card anywhere. */
  function mount(messages: Message[]) {
    const setMessages = (updater: (prev: Message[]) => Message[]) => {
      messages.splice(0, messages.length, ...updater(messages));
    };
    function Host() {
      useBrowserExpiry(setMessages);
      return null;
    }
    // The hook is exercised through the React renderer so the interval, its
    // cleanup and its cadence are the real ones.
    const React = require("react") as typeof import("react");
    const { create } = require("react-test-renderer") as typeof import("react-test-renderer");
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    const renderer = create(React.createElement(Host));
    return { setMessages, renderer, unmount: () => renderer.unmount() };
  }

  it("sweeps on mount and then once a second, with no card drawn", () => {
    const messages = conversation();
    const { renderer, unmount } = mount(messages);

    expect(messages[0].browserCards?.[0].card.fields[0].value).toBe("hunter2");

    (performance.now as jest.Mock).mockReturnValue(BY + 1);
    jest.advanceTimersByTime(1_000);

    expect(messages[0].browserCards?.[0].card.fields[0].value).toBeNull();
    expect(messages[0].browserCards?.[0].card.url).toBeNull();
    unmount();
  });

  it("stops sweeping when the conversation goes away", () => {
    const messages = conversation();
    const { unmount } = mount(messages);
    unmount();

    (performance.now as jest.Mock).mockReturnValue(BY + 1);
    const before = messages[0];
    jest.advanceTimersByTime(5_000);

    expect(messages[0]).toBe(before);
  });

  it("the sweep reads the same clock the card stamps its deadline with", () => {
    // A sweep on a different clock would expire every card instantly; this
    // asserts the two agree about "now".
    expect(typeof monotonicNowMs()).toBe("number");
    const messages = conversation();
    const { unmount } = mount(messages);
    jest.advanceTimersByTime(60_000);
    expect(messages[0].browserCards?.[0].card.fields[0].value).toBe("hunter2");
    unmount();
  });
});