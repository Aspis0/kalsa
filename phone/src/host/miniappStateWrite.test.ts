/**
 * The sheet's write-back (`hostOverlay.ts` binds it, the renderer calls it):
 * the next envelope state lands in the message that carried the mini-app.
 * The stub models React: `setMessages` applies the updater to the LATEST
 * queued state while `messagesRef` still points at the last render — the
 * write-back must read `prev`, never the ref, or a queued stream update is
 * unwritten; unknown ids write nothing; an over-cap envelope and a live
 * streaming turn keep their bytes off disk.
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

type TestHost = MiniappStateHost & { persisted: Message[][]; rendered: Message[]; writes: number };

function host(messages: Message[]): TestHost {
  const h: TestHost = {
    rendered: messages,
    persisted: [],
    writes: 0,
    messagesRef: { current: messages },
    setMessages: (updater) => {
      h.writes += 1;
      h.rendered = updater(h.rendered);
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

    expect(h.rendered[0].miniapp?.state).toEqual({ checked: { milk: true } });
    expect(h.persisted).toHaveLength(1);
    const written = h.persisted[0][0];
    expect(written.miniapp?.state).toEqual({ checked: { milk: true } });
    // The untouched fields ride along unchanged.
    expect(written.text).toBe("Here is your list.");
  });

  test("a queued stream update is not discarded (updater reads prev, not the ref)", () => {
    const h = host([message()]);
    // A stream delta landed in React's queued state; the ref still points at
    // the last render without it.
    h.rendered = [{ ...h.rendered[0], text: "Here is your list. (queued delta)" }];

    writeMiniappState(h, "m1", { checked: { milk: true } });

    // The tick is applied …
    expect(h.rendered[0].miniapp?.state).toEqual({ checked: { milk: true } });
    // … on top of the queued update, which survived.
    expect(h.rendered[0].text).toContain("(queued delta)");
  });

  test("an unknown id writes nothing", () => {
    const current = [message()];
    const h = host(current);
    writeMiniappState(h, "nope", { checked: { milk: true } });

    expect(h.writes).toBe(0);
    expect(h.rendered[0]).toBe(current[0]);
    expect(h.persisted).toHaveLength(0);
  });

  test("a write that would cross the 64 KiB envelope guard is refused whole", () => {
    const h = host([message()]);
    writeMiniappState(h, "m1", { blob: "x".repeat(64 * 1024) });

    // No state write reached React, no bytes reached disk: normalizeMiniapp
    // would delete ALL state over the cap on the next restore anyway.
    expect(h.writes).toBe(0);
    expect(h.rendered[0].miniapp?.state).toEqual({ checked: {} });
    expect(h.persisted).toHaveLength(0);
  });

  test("a streaming turn defers the disk write to its own flush", () => {
    const h = host([message({ streaming: true })]);
    writeMiniappState(h, "m1", { checked: { milk: true } });

    // The in-memory message IS updated (the tick shows immediately) …
    expect(h.rendered[0].miniapp?.state).toEqual({ checked: { milk: true } });
    // … but nothing hits disk while the clean projection would drop the stream.
    expect(h.persisted).toHaveLength(0);
  });
});
