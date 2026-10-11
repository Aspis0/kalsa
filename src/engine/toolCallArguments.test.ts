import {
  echoedToolArguments,
  parseToolArguments,
  prepareToolCall,
  TOOL_ARGS_RETRY_MESSAGE,
} from "./toolCallArguments";

// The payload the device measured: an object cut off mid-value.
const MALFORMED = '{"title": "draft", "body": "unfinished';

describe("unparseable tool-call arguments", () => {
  test("are flagged, so the loop never runs the tool on them", () => {
    expect(parseToolArguments(MALFORMED).parseFailed).toBe(true);
    expect(parseToolArguments("[1, 2]").parseFailed).toBe(true);
    expect(parseToolArguments("null").parseFailed).toBe(true);
  });

  test("are echoed back as an empty object, never the raw text", () => {
    expect(echoedToolArguments(MALFORMED)).toBe("{}");
    expect(echoedToolArguments("[1, 2]")).toBe("{}");
  });

  test("the retry result asks for a JSON object and quotes no model text", () => {
    expect(TOOL_ARGS_RETRY_MESSAGE).toMatch(/JSON object/);
    expect(TOOL_ARGS_RETRY_MESSAGE).not.toContain("draft");
  });
});

describe("arguments that are valid JSON objects", () => {
  test("echo verbatim, so the transcript matches what the model wrote", () => {
    const raw = '{"title": "draft"}';
    expect(parseToolArguments(raw).parseFailed).toBe(false);
    expect(echoedToolArguments(raw)).toBe(raw);
  });

  test("an empty or missing string is a no-argument call that echoes as {}", () => {
    expect(parseToolArguments("").parseFailed).toBe(false);
    expect(echoedToolArguments("")).toBe("{}");
    expect(echoedToolArguments(undefined)).toBe("{}");
  });
});

describe("prepareToolCall", () => {
  // The binding may send null for id or arguments at runtime; the types do not say so.
  const call = (args: string | undefined, id?: string) => ({
    type: "function" as const,
    id,
    function: { name: "web_search", arguments: args as string },
  });

  test("a malformed call is decided failed, runs with {}, and echoes {}", () => {
    const prepared = prepareToolCall(call(MALFORMED, "c1"), "fallback");
    expect(prepared.parseFailed).toBe(true);
    expect(prepared.args).toEqual({});
    expect(prepared.echo.function.arguments).toBe("{}");
    expect(prepared.echo.function.name).toBe("web_search");
    expect(prepared.echo.id).toBe("c1");
  });

  test("a valid call is decided parsed, and echoes the model's text verbatim", () => {
    const raw = '{"query": "lfm2"}';
    const prepared = prepareToolCall(call(raw, "c2"), "fallback");
    expect(prepared.parseFailed).toBe(false);
    expect(prepared.args).toEqual({ query: "lfm2" });
    expect(prepared.echo.function.arguments).toBe(raw);
  });

  test("an empty or missing argument string is a valid no-argument call", () => {
    for (const args of ["", undefined]) {
      const prepared = prepareToolCall(call(args), "fallback");
      expect(prepared.parseFailed).toBe(false);
      expect(prepared.args).toEqual({});
      expect(prepared.echo.function.arguments).toBe("{}");
    }
  });

  test("a missing or null id takes the fallback id", () => {
    expect(prepareToolCall(call("{}"), "call-1-0").echo.id).toBe("call-1-0");
    const nullId = { ...call("{}"), id: null as unknown as string };
    expect(prepareToolCall(nullId, "call-1-0").echo.id).toBe("call-1-0");
  });
});
