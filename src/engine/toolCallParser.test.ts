/**
 * Unit tests for tool_call fallback dialects (Qwen + LFM2.5).
 * Pure Node — no React Native.
 */

import {
  parseFallbackToolCall,
  parseFallbackToolCalls,
  stripToolCallTagsFinal,
  createToolCallDeltaStripper,
  LFM_TOOL_CALL_START,
  LFM_TOOL_CALL_END,
  TOOL_CALL_OPEN,
  TOOL_CALL_CLOSE,
} from "./toolCallParser";

describe("toolCallParser LFM2 dialect", () => {
  test("toolCall LFM2 single call", () => {
    const raw = `${LFM_TOOL_CALL_START}[{"name":"web_search","arguments":{"query":"cats"}}]${LFM_TOOL_CALL_END}`;
    const calls = parseFallbackToolCalls(raw);
    expect(calls).toEqual([{ name: "web_search", arguments: { query: "cats" } }]);
    expect(parseFallbackToolCall(raw)).toEqual(calls[0]);
  });

  test("toolCall LFM2 two calls", () => {
    const raw =
      `${LFM_TOOL_CALL_START}` +
      `[{"name":"web_search","arguments":{"query":"a"}},` +
      `{"name":"get_time","arguments":{}}]` +
      `${LFM_TOOL_CALL_END}`;
    expect(parseFallbackToolCalls(raw)).toEqual([
      { name: "web_search", arguments: { query: "a" } },
      { name: "get_time", arguments: {} },
    ]);
  });

  test("toolCall LFM2 whitespace around markers", () => {
    const raw = `
      ${LFM_TOOL_CALL_START}
      [{"name": "web_search", "arguments": {"query": "spaced"}}]
      ${LFM_TOOL_CALL_END}
    `;
    expect(parseFallbackToolCalls(raw)).toEqual([
      { name: "web_search", arguments: { query: "spaced" } },
    ]);
  });

  test("toolCall LFM2 missing end marker with valid JSON", () => {
    const raw = `${LFM_TOOL_CALL_START}[{"name":"web_search","arguments":{"query":"trunc"}}]`;
    expect(parseFallbackToolCalls(raw)).toEqual([
      { name: "web_search", arguments: { query: "trunc" } },
    ]);
  });

  test("toolCall LFM2 missing end marker with broken JSON", () => {
    const raw = `${LFM_TOOL_CALL_START}[{"name":"web_search","arguments":`;
    expect(parseFallbackToolCalls(raw)).toEqual([]);
    expect(parseFallbackToolCall(raw)).toBeNull();
  });

  test("toolCall LFM2 marker mentioned in prose produces no call", () => {
    const raw =
      "Some models emit a " +
      LFM_TOOL_CALL_START +
      " token before the tool JSON array; do not confuse that with a real call.";
    expect(parseFallbackToolCalls(raw)).toEqual([]);
    expect(parseFallbackToolCall(raw)).toBeNull();
  });
});

describe("toolCallParser LFM2.5 Python-call dialect (real upstream form)", () => {
  test("single call with string arg", () => {
    const raw = `${LFM_TOOL_CALL_START}[web_search(query="capitale del Madagascar")]${LFM_TOOL_CALL_END}`;
    expect(parseFallbackToolCalls(raw)).toEqual([
      { name: "web_search", arguments: { query: "capitale del Madagascar" } },
    ]);
  });

  test("comma inside string value", () => {
    const raw = `${LFM_TOOL_CALL_START}[web_search(query="Roma, Italia")]${LFM_TOOL_CALL_END}`;
    expect(parseFallbackToolCalls(raw)).toEqual([
      { name: "web_search", arguments: { query: "Roma, Italia" } },
    ]);
  });

  test("closing paren inside string value", () => {
    const raw = `${LFM_TOOL_CALL_START}[web_search(query="smile :)")]${LFM_TOOL_CALL_END}`;
    expect(parseFallbackToolCalls(raw)).toEqual([
      { name: "web_search", arguments: { query: "smile :)" } },
    ]);
  });

  test("escaped quote inside string value", () => {
    const raw = `${LFM_TOOL_CALL_START}[web_search(query="dice \\"ciao\\"")]${LFM_TOOL_CALL_END}`;
    expect(parseFallbackToolCalls(raw)).toEqual([
      { name: "web_search", arguments: { query: 'dice "ciao"' } },
    ]);
  });

  test("two calls in one payload", () => {
    const raw = `${LFM_TOOL_CALL_START}[web_search(query="a"), web_fetch(url="b")]${LFM_TOOL_CALL_END}`;
    expect(parseFallbackToolCalls(raw)).toEqual([
      { name: "web_search", arguments: { query: "a" } },
      { name: "web_fetch", arguments: { url: "b" } },
    ]);
  });

  test("JSON object value", () => {
    const raw = `${LFM_TOOL_CALL_START}[foo(opts={"k": [1,2]})]${LFM_TOOL_CALL_END}`;
    expect(parseFallbackToolCalls(raw)).toEqual([
      { name: "foo", arguments: { opts: { k: [1, 2] } } },
    ]);
  });

  test("no arguments", () => {
    const raw = `${LFM_TOOL_CALL_START}[get_time()]${LFM_TOOL_CALL_END}`;
    expect(parseFallbackToolCalls(raw)).toEqual([
      { name: "get_time", arguments: {} },
    ]);
  });

  test("unknown/garbage payload returns []", () => {
    const raw = `${LFM_TOOL_CALL_START}[???]${LFM_TOOL_CALL_END}`;
    expect(parseFallbackToolCalls(raw)).toEqual([]);
    expect(parseFallbackToolCall(raw)).toBeNull();
  });

  test("mixed valid and malformed Python call returns []", () => {
    const raw = `${LFM_TOOL_CALL_START}[web_search(query="a"), ???]${LFM_TOOL_CALL_END}`;
    expect(parseFallbackToolCalls(raw)).toEqual([]);
  });

  test("numeric and boolean arg values", () => {
    const raw = `${LFM_TOOL_CALL_START}[foo(n=42, flag=true, x=None)]${LFM_TOOL_CALL_END}`;
    expect(parseFallbackToolCalls(raw)).toEqual([
      { name: "foo", arguments: { n: 42, flag: true, x: null } },
    ]);
  });

  test("single-quoted string", () => {
    const raw = `${LFM_TOOL_CALL_START}[web_search(query='hello')]${LFM_TOOL_CALL_END}`;
    expect(parseFallbackToolCalls(raw)).toEqual([
      { name: "web_search", arguments: { query: "hello" } },
    ]);
  });

  test("missing end marker with valid Python call", () => {
    const raw = `${LFM_TOOL_CALL_START}[web_search(query="trunc")]`;
    expect(parseFallbackToolCalls(raw)).toEqual([
      { name: "web_search", arguments: { query: "trunc" } },
    ]);
  });
});

describe("toolCallParser Qwen dialect (regression)", () => {
  test("toolCall Qwen JSON body still works", () => {
    const raw = `<tool_call>{"name":"web_search","arguments":{"query":"qwen"}}</tool_call>`;
    expect(parseFallbackToolCall(raw)).toEqual({
      name: "web_search",
      arguments: { query: "qwen" },
    });
  });
});

describe("toolCallParser strippers (Qwen + LFM)", () => {
  test("strip final closed LFM span", () => {
    const raw =
      `Before ${LFM_TOOL_CALL_START}[{"name":"web_search","arguments":{"query":"x"}}]${LFM_TOOL_CALL_END} after`;
    expect(stripToolCallTagsFinal(raw)).toBe("Before  after");
  });

  test("strip final unclosed trailing LFM span", () => {
    const raw = `Visible ${LFM_TOOL_CALL_START}[{"name":"web_search","arguments":`;
    expect(stripToolCallTagsFinal(raw)).toBe("Visible ");
  });

  test("stream strip LFM open tag split across two deltas", () => {
    const strip = createToolCallDeltaStripper();
    const open = LFM_TOOL_CALL_START;
    const mid = Math.floor(open.length / 2);
    const first = strip(`Hello ${open.slice(0, mid)}`);
    const second = strip(
      `${open.slice(mid)}[{"name":"web_search","arguments":{"query":"q"}}]${LFM_TOOL_CALL_END} done`,
    );
    expect(first + second).toBe("Hello  done");
  });

  test("strip final Qwen closed span still works (regression)", () => {
    const raw = `Hi ${TOOL_CALL_OPEN}{"name":"web_search","arguments":{"query":"q"}}${TOOL_CALL_CLOSE} bye`;
    expect(stripToolCallTagsFinal(raw)).toBe("Hi  bye");
  });
});
