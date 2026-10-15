import { parseTurnSseFrame } from "./turnSse";

describe("the turn route's named events", () => {
  test("each event the contract names is read as itself", () => {
    expect(parseTurnSseFrame('event: turn\ndata: {"turn":"t-1"}\n')).toEqual({
      kind: "turn",
      turn: "t-1",
    });
    expect(parseTurnSseFrame('event: reasoning\ndata: {"text":"thinking"}\n')).toEqual({
      kind: "reasoning",
      text: "thinking",
    });
    expect(parseTurnSseFrame('event: delta\ndata: {"text":"ciao"}\n')).toEqual({
      kind: "delta",
      text: "ciao",
    });
    expect(
      parseTurnSseFrame('event: tool_run\ndata: {"id":"1","name":"mail_list","state":"ok"}\n'),
    ).toEqual({ kind: "tool_run", id: "1", name: "mail_list", state: "ok" });
    expect(parseTurnSseFrame("event: done\ndata: {}\n")).toEqual({ kind: "done" });
  });

  test("cards and a draft cross whole: the host owns their shape", () => {
    const cards = { kind: "cards", items: [{ id: "105" }], bulk: 2 };
    expect(parseTurnSseFrame(`event: cards\ndata: ${JSON.stringify(cards)}\n`)).toEqual({
      kind: "cards",
      cards,
    });
    const draft = { draft_id: "a".repeat(32), to: "marco@dominic8.it" };
    expect(parseTurnSseFrame(`event: draft\ndata: ${JSON.stringify(draft)}\n`)).toEqual({
      kind: "draft",
      draft,
    });
  });

  test("an error keeps the code the phone must say something about", () => {
    expect(parseTurnSseFrame('event: error\ndata: {"code":"mail.keychain"}\n')).toEqual({
      kind: "error",
      code: "mail.keychain",
    });
    // A nameless failure is still a failure, never a silent success.
    expect(parseTurnSseFrame("event: error\ndata: {}\n")).toEqual({
      kind: "error",
      code: "stream_malformed",
    });
  });

  test("a ping and an unknown name are ignored, never terminal", () => {
    expect(parseTurnSseFrame(": ping\n")).toEqual({ kind: "ignore" });
    expect(parseTurnSseFrame("event: something_new\ndata: {}\n")).toEqual({ kind: "ignore" });
    expect(parseTurnSseFrame('data: {"choices":[]}\n')).toEqual({ kind: "ignore" });
  });

  test("a frame that should have been JSON and was not fails the turn", () => {
    expect(parseTurnSseFrame("event: delta\ndata: {oops\n")).toEqual({
      kind: "error",
      code: "stream_malformed",
    });
  });

  test("a delta with no text is still the answer's frame", () => {
    expect(parseTurnSseFrame('event: delta\ndata: {"text":""}\n')).toEqual({
      kind: "delta",
      text: "",
    });
  });
});