import {
  isTerminalFinishReason,
  isTruncatingFinishReason,
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

  test("splits on lone CR framing", () => {
    const { frames, rest } = splitSseFrames("data: a\r\rdata: b\r\rdata: c");
    expect(frames).toEqual(["data: a", "data: b"]);
    expect(rest).toBe("data: c");
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
    expect(delta?.kind).toBe("delta");
    expect(delta?.content).toBe("pong");
    expect(delta?.reasoning).toBe("think");
  });

  test("treats [DONE] as terminal, including spacing and trailing CR", () => {
    expect(parseOpenAiSseData("[DONE]")?.kind).toBe("done");
    expect(parseOpenAiSseData("  [DONE]  \r")?.kind).toBe("done");
  });

  test("malformed non-empty JSON is an error", () => {
    const ev = parseOpenAiSseData("not-json");
    expect(ev?.kind).toBe("error");
    expect(ev?.message).toBe("malformed_sse_json");
  });

  test("JSON error field is an error", () => {
    const ev = parseOpenAiSseData(
      JSON.stringify({ error: { message: "nope" } }),
    );
    expect(ev?.kind).toBe("error");
    expect(ev?.message).toBe("nope");
  });

  test("finish_reason stop/length/content_filter are terminal", () => {
    expect(isTerminalFinishReason("stop")).toBe(true);
    expect(isTerminalFinishReason("length")).toBe(true);
    expect(isTruncatingFinishReason("length")).toBe(true);
    expect(isTruncatingFinishReason("content_filter")).toBe(true);
    const ev = parseOpenAiSseData(
      JSON.stringify({
        choices: [{ delta: {}, finish_reason: "length" }],
      }),
    );
    expect(ev?.kind).toBe("done");
    expect(ev?.finishReason).toBe("length");
  });

  test("mtplx metadata without choices is ignored", () => {
    const ev = parseOpenAiSseData(
      JSON.stringify({ mtplx_progress: { tok_s: 1 } }),
    );
    expect(ev?.kind).toBe("ignore");
  });
});

describe("parseSseFrame", () => {
  test("extracts data lines from a frame", () => {
    const deltas = parseSseFrame(
      'data: {"choices":[{"delta":{"content":"1"}}]}\n',
    );
    expect(deltas[0]?.content).toBe("1");
  });

  test("event:error frames are errors even on HTTP 200 bodies", () => {
    const ev = parseSseFrame(
      'event: error\ndata: {"error":{"message":"boom"}}\n',
    );
    expect(ev[0]?.kind).toBe("error");
    expect(ev[0]?.message).toBe("boom");
  });

  test("comment heartbeats are ignored", () => {
    const ev = parseSseFrame(": ping\n");
    expect(ev[0]?.kind).toBe("ignore");
  });
});
