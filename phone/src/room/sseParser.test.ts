import { createSseParser } from "./sseParser";

describe("the SSE wire", () => {
  test("one message per event: field lines until the blank line dispatches", () => {
    const messages = createSseParser().push(
      "event: ai_status\ndata: {\"state\":\"idle\"}\n\n",
    );
    expect(messages).toEqual([{ id: null, event: "ai_status", data: '{"state":"idle"}' }]);
  });

  test("multi-line data joins with newlines", () => {
    const messages = createSseParser().push("data: one\ndata: two\n\n");
    expect(messages).toEqual([{ id: null, event: "message", data: "one\ntwo" }]);
  });

  test("the door's : ping comment is recognised and dropped, between frames and alone", () => {
    const parser = createSseParser();
    expect(parser.push(": ping\n\n")).toEqual([]);
    expect(parser.push("event: ai_delta\ndata: {\"text\":\"x\"}\n\n: ping\n\n")).toEqual([
      { id: null, event: "ai_delta", data: '{"text":"x"}' },
    ]);
  });

  test("no message leaves the parser before its blank line arrives", () => {
    const parser = createSseParser();
    expect(parser.push("id: 41\nevent: message\ndata: {\"seq\":41}")).toEqual([]);
    expect(parser.push("\n")).toEqual([]);
    expect(parser.push("\n")).toEqual([
      { id: "41", event: "message", data: '{"seq":41}' },
    ]);
  });

  test("chunks split anywhere — mid-line, across lines, CRLF halved — lose nothing", () => {
    const wire = "id: 42\r\nevent: message\r\ndata: {\"seq\":42}\r\n\r\n";
    for (const size of [1, 3, 7]) {
      const parser = createSseParser();
      const messages: ReturnType<ReturnType<typeof createSseParser>["push"]> = [];
      for (let at = 0; at < wire.length; at += size) {
        messages.push(...parser.push(wire.slice(at, at + size)));
      }
      expect(messages).toEqual([{ id: "42", event: "message", data: '{"seq":42}' }]);
    }
  });

  test("id carries across dispatches; the event type resets to message", () => {
    const parser = createSseParser();
    const messages = parser.push(
      "id: 7\nevent: member\ndata: {\"action\":\"joined\"}\n\n" +
        "data: {\"seq\":8}\n\n",
    );
    expect(messages).toEqual([
      { id: "7", event: "member", data: '{"action":"joined"}' },
      { id: "7", event: "message", data: '{"seq":8}' },
    ]);
  });

  test("a dispatch with no data never fires (the spec's empty-data rule)", () => {
    expect(createSseParser().push("event: ai_status\n\n")).toEqual([]);
  });

  test("a value keeps only one leading space; a field with no colon carries no value", () => {
    const messages = createSseParser().push("data:  spaced\ndata:no-space\n\n");
    expect(messages).toEqual([{ id: null, event: "message", data: " spaced\nno-space" }]);
  });

  test("the stream's BOM is not the first field's", () => {
    const messages = createSseParser().push("\uFEFFdata: x\n\n");
    expect(messages).toEqual([{ id: null, event: "message", data: "x" }]);
  });
});
