/**
 * The /bench route runtime hook: the push is feature-detected (the pinned
 * llama.rn may predate setPrefillOverride — absent logs once and never
 * throws), the KALSA_GOVERNOR route-evidence fields copy what the result
 * carries (null while it carries none), and the join id reaches the FIRST
 * line of a send (KALSA_WINDOW) and the turn that follows it — the last
 * pins are source-level: streamAssistantTurn has no jest harness.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { governorRouteLogFields, pushPrefillOverride } from "./benchRoute";

const stripComments = (text: string) =>
  text.replace(/\/\*[\S\s]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

describe("pushPrefillOverride — feature-detected against the pinned binding", () => {
  let log: jest.SpyInstance;

  beforeEach(() => {
    log = jest.spyOn(console, "log").mockImplementation(() => undefined);
  });
  afterEach(() => log.mockRestore());

  test("no setPrefillOverride → one KALSA_BENCH_ROUTE line per process, never an error", async () => {
    const engine = {};
    await expect(pushPrefillOverride(engine, "cpu")).resolves.toBe("unsupported");
    await expect(pushPrefillOverride(engine, "gpu")).resolves.toBe("unsupported");
    expect(log).toHaveBeenCalledTimes(1);
    const [line] = log.mock.calls[0] as [string];
    expect(line.startsWith("KALSA_BENCH_ROUTE ")).toBe(true);
    expect(JSON.parse(line.slice("KALSA_BENCH_ROUTE ".length))).toEqual({
      applied: false,
      reason: "unsupported",
    });
  });

  test("a supporting engine receives the mode as a method call (this-bound)", async () => {
    const setPrefillOverride = jest.fn(async () => undefined);
    const engine = { setPrefillOverride };
    await expect(pushPrefillOverride(engine, "gpu")).resolves.toBe("applied");
    expect(setPrefillOverride).toHaveBeenCalledWith("gpu");
    expect(setPrefillOverride.mock.instances[0]).toBe(engine);
    expect(log).not.toHaveBeenCalled();
  });
});

describe("governorRouteLogFields — the KALSA_GOVERNOR route evidence", () => {
  test("joins on turnId, echoes the requested mode, and nulls a missing result field", () => {
    expect(
      governorRouteLogFields({ turnId: "12", routeMode: "gpu", completionResult: undefined }),
    ).toEqual({ turnId: "12", route_mode: "gpu", route_chunks: null });
    expect(
      governorRouteLogFields({ turnId: "12", routeMode: "auto", completionResult: null }),
    ).toEqual({ turnId: "12", route_mode: "auto", route_chunks: null });
  });

  test("copies route_chunks from the result; anything non-array reads as absent", () => {
    const chunks = [
      { index: 0, requested: "cpu", actual: "cpu", tokens: 128, prefill_ms: 41, forced: true },
    ];
    expect(
      governorRouteLogFields({
        turnId: "3",
        routeMode: "cpu",
        completionResult: { route_chunks: chunks },
      }).route_chunks,
    ).toEqual(chunks);
    expect(
      governorRouteLogFields({
        turnId: "3",
        routeMode: "cpu",
        completionResult: { route_chunks: "not-an-array" },
      }).route_chunks,
    ).toBeNull();
  });
});

describe("the join id reaches the first line of the send and the turn", () => {
  const windowSource = stripComments(
    readFileSync(join(__dirname, "../host/engineTurnStream.ts"), "utf8"),
  );
  const serviceSource = stripComments(
    readFileSync(join(__dirname, "LlamaService.ts"), "utf8"),
  );

  test("the send mints exactly one id and hands it to the turn", () => {
    expect(windowSource.match(/mintTurnId\(/g)).toHaveLength(1);
    expect(serviceSource).toContain("options.turnId ?? mintTurnId()");
  });

  test("KALSA_WINDOW carries the id, and the turn options carry it too", () => {
    // `turnId,` (word-boundary) in the window JSON and in the options
    // literal — comment-free source, so the import's `mintTurnId,` (and any
    // prose) cannot count.
    expect(windowSource.match(/\bturnId,/g)).toHaveLength(2);
    const windowBlock = windowSource.slice(
      windowSource.indexOf("KALSA_WINDOW"),
      windowSource.indexOf("} catch {", windowSource.indexOf("KALSA_WINDOW")),
    );
    expect(windowBlock).toContain("turnId,");
  });

  test("KALSA_GOVERNOR spreads the route-evidence fields", () => {
    expect(serviceSource.match(/\.\.\.governorRouteLogFields\(/g)).toHaveLength(1);
  });
});
