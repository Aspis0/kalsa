import {
  accumulateToolSources,
  buildCiteInstructionSuffix,
  decideToolExecution,
  makeToolCallKey,
  recordToolFailure,
  recordToolSuccess,
} from "./toolSourceLedger";

describe("tool source ledger", () => {
  test("decides each execution path without mutating state", () => {
    const args = { query: "weather" };
    const key = makeToolCallKey("web_search", args);
    const state = {
      executions: 0,
      successfulKeys: new Set<string>(),
      failedKeys: new Map<string, number>(),
    };

    expect(
      decideToolExecution(state, 2, "web_search", args),
    ).toEqual({ action: "execute", key });
    expect(state).toEqual({
      executions: 0,
      successfulKeys: new Set<string>(),
      failedKeys: new Map<string, number>(),
    });
    expect(
      decideToolExecution(
        { executions: 2, successfulKeys: new Set(), failedKeys: new Map() },
        2,
        "web_search",
        args,
      ),
    ).toEqual({ action: "skip_cap" });
    expect(
      decideToolExecution(
        { executions: 0, successfulKeys: new Set([key]), failedKeys: new Map() },
        2,
        "web_search",
        args,
      ),
    ).toEqual({ action: "skip_dup" });
    expect(
      decideToolExecution(
        { executions: 0, successfulKeys: new Set(), failedKeys: new Map([[key, 2]]) },
        2,
        "web_search",
        args,
      ),
    ).toEqual({ action: "skip_failed_repeat" });
  });

  test("canonicalizes argument order and isolates malformed raw arguments", () => {
    expect(makeToolCallKey("device_calc", { b: 2, a: 1 })).toBe(
      makeToolCallKey("device_calc", { a: 1, b: 2 }),
    );
    expect(
      makeToolCallKey("device_calc", {}, {
        parseFailed: true,
        rawArguments: '{"expression":"1+1"}',
      }),
    ).toBe('device_calc:raw:{"expression":"1+1"}');
  });

  test("deduplicates normalized URLs and preserves first source", () => {
    const first = { title: "First", url: "HTTPS://Example.com/page/" };
    const duplicate = { title: "Duplicate", url: "https://example.com/page#section" };
    const noUrl = { title: "No URL" };
    const acc: unknown[] = [first];

    const result = accumulateToolSources(acc, [duplicate, noUrl, duplicate]);

    expect(result.merged).toEqual([first, noUrl]);
    expect(result.assigned).toEqual([1, 2, 1]);
    expect(result.merged).toBe(acc);
  });

  test("records success and failure state with one retry allowed", () => {
    const key = makeToolCallKey("web_search", { query: "weather" });
    const state = {
      executions: 0,
      successfulKeys: new Set<string>(),
      failedKeys: new Map<string, number>(),
    };

    recordToolFailure(state, key);
    expect(state.executions).toBe(1);
    expect(state.failedKeys.get(key)).toBe(1);
    expect(decideToolExecution(state, 2, "web_search", { query: "weather" })).toEqual({
      action: "execute",
      key,
    });

    recordToolFailure(state, key);
    expect(decideToolExecution(state, 3, "web_search", { query: "weather" })).toEqual({
      action: "skip_failed_repeat",
    });

    recordToolSuccess(state, "device_calc:{}");
    expect(state.executions).toBe(3);
    expect(state.successfulKeys).toEqual(new Set(["device_calc:{}"]));
    expect(
      decideToolExecution(state, 4, "device_calc", {}),
    ).toEqual({ action: "skip_dup" });
  });

  test("builds basic source and passage citation suffixes", () => {
    const strings = {
      errors: {
        webSearchCiteInstruction: "cite the sources",
        webToolCiteInstructionMapped: "map {mapping}",
        webFetchCiteInstruction: "cite passage {index}",
        webFetchPdfCiteInstruction: "cite passage {index} ({pages})",
      },
    };

    expect(buildCiteInstructionSuffix([], strings)).toBe("");
    expect(buildCiteInstructionSuffix([1, 2], strings)).toBe(
      "\n\ncite the sources",
    );
    expect(buildCiteInstructionSuffix([2, 4], strings)).toBe(
      "\n\nmap 1→[2], 2→[4]",
    );
    expect(buildCiteInstructionSuffix([3], strings, "passages")).toBe(
      "\n\ncite passage 3",
    );
    expect(
      buildCiteInstructionSuffix([4], strings, "passages", { pdfPages: [3, 1, 3] }),
    ).toBe("\n\ncite passage 4 (p. 1, p. 3)");
  });
});
