import { createRichCallbacks, type RichCallbackCtx } from "./sendCallbacks";
import { createTurnFence } from "./turnGuards";
import type { Message } from "./hostMessage";

/**
 * What a held browser request lands on the assistant message
 * (PHONE-CHAT-PROTOCOL §3.1): the card as it came, so the person is shown
 * every field as it would really be sent, and the fate of it afterwards on the
 * very same card.
 */
function harness() {
  const fence = createTurnFence();
  const token = fence.beginRun();
  const messages: Message[] = [
    { id: "assistant-1", role: "assistant", text: "", createdAt: 0 },
  ];
  const setMessages = (updater: (prev: Message[]) => Message[]) => {
    messages.splice(0, messages.length, ...updater(messages));
  };
  const ctx: RichCallbackCtx = {
    fence,
    token,
    assistantId: "assistant-1",
    setMessages,
    onToolCapture: jest.fn(),
    t: (key) => key,
  };
  return { rich: createRichCallbacks(ctx), message: () => messages[0], fence };
}

/** A conversation whose card was raised by an EARLIER turn, and this turn's own
 *  empty answer beside it — the shape a queued outcome always arrives on. */
function harnessWithOlderCard() {
  const fence = createTurnFence();
  const token = fence.beginRun();
  const older: Message = {
    id: "assistant-0",
    role: "assistant",
    text: "ti chiedo prima",
    createdAt: 0,
    browserCards: [
      {
        card: {
          cardId: ID_A,
          method: "POST",
          url: "https://shop.example/checkout",
          fields: [{ name: "passphrase_2", value: "hunter2", secret: true }],
          deadlineAtMs: 301_000,
        },
      },
    ],
  };
  const messages: Message[] = [older, { id: "assistant-1", role: "assistant", text: "", createdAt: 1 }];
  const setMessages = (updater: (prev: Message[]) => Message[]) => {
    messages.splice(0, messages.length, ...updater(messages));
  };
  const ctx: RichCallbackCtx = {
    fence,
    token,
    assistantId: "assistant-1",
    setMessages,
    onToolCapture: jest.fn(),
    t: (key) => key,
  };
  return {
    rich: createRichCallbacks(ctx),
    message: () => messages[1],
    olderMessage: () => messages[0],
    fence,
  };
}

const ID_A = "3f9c1a77e2b04d5681aa90c3b7e4412d";
const ID_B = "aa11bb22cc33dd44ee55ff6677889900";

/** Distinct 32-hex ids, so "the ninth card" is a different card and not a
 *  duplicate frame. */
const id = (n: number) => n.toString(16).padStart(32, "0");

const card = (cardId: string, over: Record<string, unknown> = {}) => ({
  card_id: cardId,
  method: "POST",
  url: "https://shop.example/checkout",
  fields: [{ name: "passphrase_2", value: "hunter2", secret: true }],
  asked_at_ms: 1767225600000,
  answer_in_ms: 300000,
  ...over,
});

describe("a held request on the assistant message", () => {
  // The card's budget is stamped on the phone's own clock at arrival, so the
  // tests pin that clock rather than predicting a wall time.
  beforeEach(() => jest.spyOn(performance, "now").mockReturnValue(1_000));
  afterEach(() => jest.restoreAllMocks());

  it("lands as a card, secret value and all: the person is shown the whole request", () => {
    const { rich, message } = harness();
    rich.callbacks.onBrowserCard?.(card(ID_A));

    expect(message().browserCards).toEqual([
      {
        card: {
          cardId: ID_A,
          method: "POST",
          url: "https://shop.example/checkout",
          fields: [{ name: "passphrase_2", value: "hunter2", secret: true }],
          // Arrival (1 000) plus the budget (300 000) on THIS phone's clock.
          deadlineAtMs: 301_000,
        },
      },
    ]);
  });

  it("a card whose deadline the computer stamped is read as a DURATION, never a date", () => {
    const { rich, message } = harness();
    rich.callbacks.onBrowserCard?.(card(ID_A, { asked_at_ms: 1, answer_in_ms: 300_000 }));

    // 1 ms after the epoch is not a deadline; the budget is 300 000 ms from now.
    expect(message().browserCards?.[0].card.deadlineAtMs).toBe(301_000);
  });

  it("the same card crossing twice is still ONE card with one set of buttons", () => {
    const { rich, message } = harness();
    rich.callbacks.onBrowserCard?.(card(ID_A));
    rich.callbacks.onBrowserCard?.(card(ID_A));

    expect(message().browserCards).toHaveLength(1);
  });

  it("a second card of the same turn is its own card", () => {
    const { rich, message } = harness();
    rich.callbacks.onBrowserCard?.(card(ID_A));
    rich.callbacks.onBrowserCard?.(card(ID_B));

    expect(message().browserCards).toHaveLength(2);
  });

  it("a card the computer should never have sent draws nothing", () => {
    const { rich, message } = harness();
    rich.callbacks.onBrowserCard?.(card(""));
    rich.callbacks.onBrowserCard?.({ ...card(ID_A), fields: [{ name: "size" }] });

    expect(message().browserCards).toBeUndefined();
  });

  it("an outcome lands on the card it belongs to and leaves the other open", () => {
    const { rich, message } = harness();
    rich.callbacks.onBrowserCard?.(card(ID_A));
    rich.callbacks.onBrowserCard?.(card(ID_B));
    rich.callbacks.onBrowserOutcome?.({ card_id: ID_A, code: "gone" });

    expect(message().browserCards?.[0].outcome).toEqual({ code: "gone", host: "" });
    expect(message().browserCards?.[1].outcome).toBeUndefined();
  });

  it("an outcome nobody raised here is not this message's to answer", () => {
    const { rich, message } = harness();
    rich.callbacks.onBrowserCard?.(card(ID_A));
    rich.callbacks.onBrowserOutcome?.({ card_id: ID_B, code: "gone" });

    expect(message().browserCards?.[0].outcome).toBeUndefined();
  });

  it("an outcome CLOSES the card: its values are dropped from the state itself", () => {
    const { rich, message } = harness();
    rich.callbacks.onBrowserCard?.(card(ID_A));
    rich.callbacks.onBrowserOutcome?.({ card_id: ID_A, code: "declined" });

    // The message object itself, not only what a card would draw from it.
    expect(message().browserCards?.[0].card.fields[0].value).toBeNull();
    expect(JSON.stringify(message())).not.toContain("hunter2");
    // And the card keeps its identity and its fate: it still says what happened.
    expect(message().browserCards?.[0].card.cardId).toBe(ID_A);
    expect(message().browserCards?.[0].outcome).toEqual({ code: "declined", host: "" });
  });

  it("a queued outcome closes a card from an EARLIER turn, not this turn's message", () => {
    // The shape the queue exists for: the window closed long after the turn
    // that raised the card, so the outcome is handed over at the start of this
    // phone's NEXT turn — a turn that raised nothing at all.
    const { rich, message, olderMessage } = harnessWithOlderCard();
    rich.callbacks.onBrowserOutcome?.({ card_id: ID_A, code: "declined" });

    expect(olderMessage().browserCards?.[0].outcome).toEqual({ code: "declined", host: "" });
    expect(olderMessage().browserCards?.[0].card.fields[0].value).toBeNull();
    expect(message().browserCards).toBeUndefined();
  });

  it("an outcome for a card no message holds changes nothing at all", () => {
    const { rich, message } = harness();
    rich.callbacks.onBrowserCard?.(card(ID_A));
    const before = message();
    rich.callbacks.onBrowserOutcome?.({ card_id: ID_B, code: "declined" });

    expect(message()).toBe(before);
  });

  it("a phone is asked about at most eight requests at once", () => {
    const { rich, message } = harness();
    for (let n = 0; n < 10; n++) rich.callbacks.onBrowserCard?.(card(id(n)));

    expect(message().browserCards).toHaveLength(8);
    // The ninth and tenth are refused, and a refused one leaves no trace.
    expect(message().browserCards?.map((entry) => entry.card.cardId)).not.toContain(id(8));
  });

  it("a card nobody may answer keeps its shape: names stay, values do not", () => {
    const { rich, message } = harness();
    rich.callbacks.onBrowserCard?.(
      card(ID_A, {
        fields: [
          { name: "size", value: "L", secret: false },
          { name: "passphrase_2", value: "hunter2", secret: true },
        ],
      }),
    );
    rich.callbacks.onBrowserOutcome?.({ card_id: ID_A, code: "gone" });

    expect(message().browserCards?.[0].card.fields[0]).toEqual({
      name: "size",
      value: null,
      secret: false,
    });
    // The address is a stranger's site too, and goes with the values (§6).
    expect(message().browserCards?.[0].card.url).toBeNull();
    expect(message().browserCards?.[0].card.method).toBe("POST");
  });

  it("a duplicate card arriving after it was spent never brings the values back", () => {
    const { rich, message } = harness();
    rich.callbacks.onBrowserCard?.(card(ID_A));
    rich.callbacks.onBrowserOutcome?.({ card_id: ID_A, code: "declined" });
    rich.callbacks.onBrowserCard?.(card(ID_A));

    expect(message().browserCards).toHaveLength(1);
    expect(JSON.stringify(message())).not.toContain("hunter2");
  });

  it("a code the contract does not name still closes the card, with no host", () => {
    const { rich, message } = harness();
    rich.callbacks.onBrowserCard?.(card(ID_A));
    rich.callbacks.onBrowserOutcome?.({ card_id: ID_A, code: "invented" });

    expect(message().browserCards?.[0].outcome).toEqual({ code: "invented", host: "" });
  });

  it("an outcome with a host it should not carry still closes the card", () => {
    const { rich, message } = harness();
    rich.callbacks.onBrowserCard?.(card(ID_A));
    rich.callbacks.onBrowserOutcome?.({ card_id: ID_A, code: "gone", host: "shop.example" });

    // The card is over — a protocol slip must not leave live buttons behind.
    expect(message().browserCards?.[0].outcome).toEqual({ code: "gone", host: "" });
  });

  it("a finished turn takes neither a card nor an outcome", () => {
    const { rich, message, fence } = harness();
    fence.invalidate();
    rich.callbacks.onBrowserCard?.(card(ID_A));
    rich.callbacks.onBrowserOutcome?.({ card_id: ID_A, code: "gone" });

    expect(message().browserCards).toBeUndefined();
  });
});