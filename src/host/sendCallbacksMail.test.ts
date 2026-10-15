import { createRichCallbacks, type RichCallbackCtx } from "./sendCallbacks";
import { createTurnFence } from "./turnGuards";
import type { Message } from "./hostMessage";

/** What a turn's mail lands on the assistant message: a list, because a turn
 *  can list the mail twice and draft for two mails, and because a replaced
 *  draft card paired the second draft's id with the first draft's words. */
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
  return { rich: createRichCallbacks(ctx), message: () => messages[0] };
}

const CARD = {
  kind: "cards",
  items: [{ id: "105", from: { name: "Banca", address: "a@b.it" } }],
  bulk: 0,
};

const draft = (draftId: string) => ({ draft_id: draftId, to: "m@x.it", body: `body ${draftId}` });

describe("mail and drafts on the assistant message", () => {
  it("two drafts are two entries, each with its own id", () => {
    const { rich, message } = harness();
    rich.callbacks.onMailDraft?.(draft("aaaa"));
    rich.callbacks.onMailDraft?.(draft("bbbb"));

    expect(message().mailDrafts?.map((entry) => entry.draftId)).toEqual(["aaaa", "bbbb"]);
  });

  it("two card sets both stay, so the first keeps its Open buttons", () => {
    const { rich, message } = harness();
    rich.callbacks.onMailCards?.(CARD);
    rich.callbacks.onMailCards?.({ ...CARD, items: [{ id: "106", from: { name: "", address: "b@x.it" } }] });

    expect(message().mail).toHaveLength(2);
    expect(message().mail?.[0].items[0].id).toBe("105");
    expect(message().mail?.[1].items[0].id).toBe("106");
  });

  it("a payload no card can draw changes nothing", () => {
    const { rich, message } = harness();
    rich.callbacks.onMailDraft?.({ to: "m@x.it" });
    rich.callbacks.onMailCards?.({ kind: "cards", items: [{ from: { address: "a@b.it" } }] });

    expect(message().mailDrafts).toBeUndefined();
    expect(message().mail).toBeUndefined();
  });

  it("the turn-route answer is marked once, and stays marked", () => {
    const { rich, message } = harness();
    expect(message().linksAsText).toBeUndefined();
    rich.callbacks.onLinksAsText?.();

    expect(message().linksAsText).toBe(true);
  });
});