import {
  newRequestId,
  parseOpenAiSseData,
  parseSseFrame,
  splitSseFrames,
} from "./openaiSse";

describe("splitSseFrames", () => {
  test("splits complete frames and keeps a partial tail", () => {
    const { frames, rest } = splitSseFrames(
      "data: {\"a\":1}\n\ndata: {\"b\":2}\n\ndata: {\"c\"",
    );
    expect(frames).toEqual(['data: {"a":1}', 'data: {"b":2}']);
    expect(rest).toBe('data: {"c"');
  });

  test("tolerates CRLF", () => {
    const { frames } = splitSseFrames("data: hi\r\n\r\n");
    expect(frames).toEqual(["data: hi"]);
  });
});

describe("parseOpenAiSseData", () => {
  test("maps content and reasoning_content", () => {
    const delta = parseOpenAiSseData(
      JSON.stringify({
        choices: [
          {
            delta: { content: "pong", reasoning_content: "think" },
            finish_reason: null,
          },
        ],
      }),
    );
    expect(delta).toEqual({
      content: "pong",
      reasoning: "think",
      done: false,
      finishReason: null,
    });
  });

  test("treats [DONE] as terminal", () => {
    expect(parseOpenAiSseData("[DONE]")).toEqual({
      content: "",
      reasoning: "",
      done: true,
      finishReason: "stop",
    });
  });

  test("returns null on garbage JSON", () => {
    expect(parseOpenAiSseData("not-json")).toBeNull();
  });
});

describe("parseSseFrame", () => {
  test("extracts data lines from a frame", () => {
    const deltas = parseSseFrame(
      'data: {"choices":[{"delta":{"content":"1"}}]}\n',
    );
    expect(deltas[0]?.content).toBe("1");
  });
});

describe("newRequestId", () => {
  test("is unique and prefixed", () => {
    const a = newRequestId();
    const b = newRequestId();
    expect(a).toMatch(/^kalsa-remote-/);
    expect(a).not.toBe(b);
  });
});
