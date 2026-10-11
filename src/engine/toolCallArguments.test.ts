import {
  echoedToolArguments,
  parseToolArguments,
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
