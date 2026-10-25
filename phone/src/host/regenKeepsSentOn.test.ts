/**
 * A regenerate re-sends the SAME user turn, so it keeps that turn's date line;
 * an edit is a new message and carries no stored line, so it is stamped today.
 */
import { truncateAndResend } from "./truncateAndResend";
import { planEdit, planRegenerate } from "./regenPlan";
import type { Message } from "./hostMessage";

const ORIGINAL = "Sent on Monday, 5 October 2026.";

const thread: Message[] = [
  { id: "u1", role: "user", text: "first question", createdAt: 1, sentOn: ORIGINAL },
  { id: "a1", role: "assistant", text: "first answer", createdAt: 2 },
];

function deps(messages: Message[]) {
  const send = jest.fn(async (_text: string, _opts?: { edited?: boolean; sentOn?: string }) => undefined);
  return {
    send,
    deps: {
      history: {
        messagesRef: { current: messages },
        setMessages: jest.fn(),
        historyGuard: { armDeclaredShrink: jest.fn() },
      },
      sendHost: { send, sendingRef: { current: true } },
      showNoticeKey: jest.fn(),
    } as never,
  };
}

describe("the date line of a resent turn", () => {
  test("a regenerate re-sends the original turn with its original line", async () => {
    const plan = planRegenerate(thread, "a1");
    const { send, deps: d } = deps(thread);
    await truncateAndResend(d, plan!);
    expect(send.mock.calls[0][1]).toEqual({ edited: undefined, sentOn: ORIGINAL });
  });

  test("an edit carries no stored line, so the send stamps today", async () => {
    const plan = planEdit(thread, "u1", "reworded first question");
    const { send, deps: d } = deps(thread);
    await truncateAndResend(d, plan!, { edited: true });
    expect(send.mock.calls[0][1]).toEqual({ edited: true, sentOn: undefined });
  });
});
