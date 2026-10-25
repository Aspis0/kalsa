import { toTranscriptMessages } from "./messageMapper";
import type { Message } from "./hostMessage";

const options = (toolsById?: ReadonlyMap<string, readonly { name: string }[]>) => ({
  thinkingStatus: "Thinking",
  toolsById,
});

const message = (overrides: Partial<Message>): Message => ({
  id: "m1",
  role: "user",
  text: "hello",
  createdAt: 1,
  ...overrides,
});

describe("transcript projection identity", () => {
  test("reuses settled projections and remaps an immutable streaming replacement", () => {
    const settled = message({ id: "settled" });
    const streaming = message({ id: "stream", role: "assistant", streaming: true, text: "a" });
    const first = toTranscriptMessages([settled, streaming], options());
    const next = toTranscriptMessages([settled, { ...streaming, text: "ab" }], options());

    expect(next[0]).toBe(first[0]);
    expect(next[1]).not.toBe(first[1]);
    expect(next[1].text).toBe("ab");
  });

  test("invalidates the projection when captured tools change", () => {
    const assistant = message({ id: "assistant", role: "assistant" });
    const first = toTranscriptMessages(
      [assistant],
      options(new Map([[assistant.id, [{ name: "web_search" }]]])),
    );
    const next = toTranscriptMessages(
      [assistant],
      options(new Map([[assistant.id, [{ name: "web_fetch" }]]])),
    );

    expect(next[0]).not.toBe(first[0]);
    expect(next[0].tools).toEqual([{ name: "web_fetch" }]);
  });
});
