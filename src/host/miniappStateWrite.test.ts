/**
 * The sheet's write-back (`hostOverlay.ts` binds it, the renderer calls it):
 * the next envelope state lands in the message that carried the mini-app,
 * unknown ids write nothing, and a live streaming turn defers the disk write
 * to its own completion flush (the clean projection drops streamed messages).
 */
import { writeMiniappState, type MiniappStateHost } from "./miniappStateWrite";
import type { Message } from "./hostMessage";

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: "m1",
    role: "assistant",
    text: "Here is your list.",
    createdAt: 1,
    miniapp: {
      kind: "checklist",
      title: "Groceries",
      blocks: [{ type: "checklist", items: [{ id: "milk", title: "Milk" }] }],
      state: { checked: {} },
    },
    ...overrides,
  };
}

type TestHost = MiniappStateHost & { persisted: Message[][] };

function host(messages: Message[]): TestHost {
  const h: TestHost = {
    persisted: [],
    messagesRef: { current: messages },
    setMessages: (updater) => {
      h.messagesRef.current = updater(h.messagesRef.current);
    },
    persistActiveMessages: (msgs) => {
      h.persisted.push(msgs);
    },
  };
  return h;
}

describe("writeMiniappState", () => {
  test("replaces the state of the message that owns the mini-app and persists", () => {
    const h = host([message()]);
    writeMiniappState(h, "m1", { checked: { milk: true } });

    expect(h.messagesRef.current[0].miniapp?.state).toEqual({ checked: { milk: true } });
    expect(h.persisted).toHaveLength(1);
    const written = h.persisted[0][0];
    expect(written.miniapp?.state).toEqual({ checked: { milk: true } });
    // The untouched fields ride along unchanged.
    expect(written.text).toBe("Here is your list.");
  });

  test("an unknown id writes nothing", () => {
    const current = [message()];
    const h = host(current);
    writeMiniappState(h, "nope", { checked: { milk: true } });

    expect(h.messagesRef.current[0]).toBe(current[0]);
    expect(h.persisted).toHaveLength(0);
  });

  test("a streaming turn defers the disk write to its own flush", () => {
    const h = host([message({ streaming: true })]);
    writeMiniappState(h, "m1", { checked: { milk: true } });

    // The in-memory message IS updated (the tick shows immediately) …
    expect(h.messagesRef.current[0].miniapp?.state).toEqual({ checked: { milk: true } });
    // … but nothing hits disk while the clean projection would drop the stream.
    expect(h.persisted).toHaveLength(0);
  });
});
