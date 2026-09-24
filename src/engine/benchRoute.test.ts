/**
 * The /bench route runtime hook, as the campaign will read it: the push is
 * feature-detected and outcome-typed (absent logs once; reject → failed;
 * hung past the short bound → timeout — never an error into the turn), the
 * KALSA_GOVERNOR route fields name a mode ONLY when this turn's push was
 * applied, malformed chunk entries are dropped and counted, and the join
 * keys (window id, attempt, marker) reach every line an analyst stitches —
 * the last pins are source-level: LlamaService has no jest harness.
 */
import { readFileSync } from "fs";
import { join } from "path";
import {
  BENCH_ROUTE_PUSH_TIMEOUT_MS,
  governorRouteLogFields,
  pushPrefillOverride,
} from "./benchRoute";

const stripComments = (text: string) =>
  text.replace(/\/\*[\S\s]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

describe("pushPrefillOverride — feature-detected, bounded, outcome-typed", () => {
  let log: jest.SpyInstance;

  beforeEach(() => {
    log = jest.spyOn(console, "log").mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.useRealTimers();
    log.mockRestore();
  });

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

  test("the shipped bound is 2 s — the product decision, pinned", () => {
    expect(BENCH_ROUTE_PUSH_TIMEOUT_MS).toBe(2_000);
  });

  test("a supporting engine receives the mode as a method call (this-bound)", async () => {
    const setPrefillOverride = jest.fn(async () => undefined);
    const engine = { setPrefillOverride };
    await expect(pushPrefillOverride(engine, "gpu")).resolves.toBe("applied");
    expect(setPrefillOverride).toHaveBeenCalledWith("gpu");
    expect(setPrefillOverride.mock.instances[0]).toBe(engine);
    expect(log).not.toHaveBeenCalled();
  });

  test("a rejecting setter is failed — never applied, never thrown", async () => {
    const engine = {
      setPrefillOverride: () => Promise.reject(new Error("native blew up")),
    };
    await expect(pushPrefillOverride(engine, "cpu")).resolves.toBe("failed");
  });

  test("a setter that never settles times out at the short bound", async () => {
    jest.useFakeTimers();
    const engine = { setPrefillOverride: () => new Promise<void>(() => undefined) };
    const pending = pushPrefillOverride(engine, "cpu");
    await jest.advanceTimersByTimeAsync(BENCH_ROUTE_PUSH_TIMEOUT_MS);
    await expect(pending).resolves.toBe("timeout");
  });
});

describe("governorRouteLogFields — the KALSA_GOVERNOR route evidence", () => {
  test("route_mode names a mode ONLY when this turn's push was applied", () => {
    expect(
      governorRouteLogFields({
        turnId: "12",
        routePush: { mode: "gpu", outcome: "applied" },
        completionResult: undefined,
      }),
    ).toEqual({
      turnId: "12",
      route_requested: "gpu",
      route_mode: "gpu",
      route_push: "applied",
      route_mismatch: null,
      route_chunks: null,
      route_chunks_dropped: null,
    });
    for (const outcome of ["unsupported", "failed", "timeout"] as const) {
      expect(
        governorRouteLogFields({
          turnId: "12",
          routePush: { mode: "gpu", outcome },
          completionResult: undefined,
        }),
      ).toEqual({
        turnId: "12",
        // The nit: even a failed/timeout push reports WHAT was asked…
        route_requested: "gpu",
        // …while route_mode stays honest about what landed.
        route_mode: null,
        route_push: outcome,
        route_mismatch: null,
        route_chunks: null,
        route_chunks_dropped: null,
      });
    }
  });

  test("no push this turn (governor attempted but inactive) → null + skipped", () => {
    expect(
      governorRouteLogFields({ turnId: "12", routePush: null, completionResult: undefined }),
    ).toEqual({
      turnId: "12",
      route_requested: null,
      route_mode: null,
      route_push: "skipped",
      route_mismatch: null,
      route_chunks: null,
      route_chunks_dropped: null,
    });
  });

  test("route_mismatch compares the applied FORCED arm against every chunk", () => {
    const chunk = (actual: string) => ({
      index: 0,
      requested: "gpu",
      actual,
      tokens: 128,
      prefill_ms: 41,
      forced: true,
    });
    const build = (outcome: "applied" | "failed", mode: "cpu" | "gpu" | "auto", chunks: unknown) =>
      governorRouteLogFields({
        turnId: "5",
        routePush: { mode, outcome },
        completionResult: { route_chunks: chunks },
      });
    expect(build("applied", "gpu", [chunk("gpu")]).route_mismatch).toBe(false);
    expect(build("applied", "gpu", [chunk("gpu"), chunk("cpu")]).route_mismatch).toBe(true);
    // not forced, or nothing applied, or no chunks to compare → null
    expect(build("applied", "auto", [chunk("cpu")]).route_mismatch).toBeNull();
    expect(build("failed", "gpu", [chunk("cpu")]).route_mismatch).toBeNull();
    expect(build("applied", "gpu", []).route_mismatch).toBeNull();
  });

  test("non-finite or negative chunk facts are malformed, not valid", () => {
    const base = {
      index: 0,
      requested: "cpu",
      actual: "cpu",
      tokens: 128,
      prefill_ms: 41,
      forced: true,
    };
    const malformed: unknown[] = [
      { ...base, index: Number.NaN },
      { ...base, index: 1.5 },
      { ...base, index: -1 },
      { ...base, tokens: Number.NaN },
      { ...base, tokens: -3 },
      { ...base, prefill_ms: Number.POSITIVE_INFINITY },
      { ...base, prefill_ms: -0.5 },
    ];
    const result = governorRouteLogFields({
      turnId: "9",
      routePush: null,
      completionResult: { route_chunks: [base, ...malformed] },
    });
    expect(result.route_chunks).toHaveLength(1);
    expect(result.route_chunks_dropped).toBe(malformed.length);
  });

  test("route_chunks is projected to the six spec fields; malformed entries drop and count", () => {
    const valid = {
      index: 0,
      requested: "cpu",
      actual: "cpu",
      tokens: 128,
      prefill_ms: 41,
      forced: true,
      junk: "not in the spec",
    };
    const badLiteral = {
      index: 1,
      requested: "cpu",
      actual: "npu",
      tokens: 64,
      prefill_ms: 9,
      forced: false,
    };
    const result = governorRouteLogFields({
      turnId: "3",
      routePush: { mode: "cpu", outcome: "applied" },
      completionResult: { route_chunks: [valid, badLiteral, "nope"] },
    });
    expect(result.route_chunks).toEqual([
      { index: 0, requested: "cpu", actual: "cpu", tokens: 128, prefill_ms: 41, forced: true },
    ]);
    expect(result.route_chunks_dropped).toBe(2);
  });

  test("a missing or non-array route_chunks reads as absent (with no drop count)", () => {
    for (const completionResult of [{}, { route_chunks: "x" }, null, undefined]) {
      expect(
        governorRouteLogFields({ turnId: "3", routePush: null, completionResult }),
      ).toMatchObject({ route_chunks: null, route_chunks_dropped: null });
    }
  });
});

describe("the join keys reach every line an analyst stitches", () => {
  const windowSource = stripComments(
    readFileSync(join(__dirname, "../host/engineTurnStream.ts"), "utf8"),
  );
  const serviceSource = stripComments(
    readFileSync(join(__dirname, "LlamaService.ts"), "utf8"),
  );
  const telemetrySource = stripComments(
    readFileSync(join(__dirname, "turnTelemetry.ts"), "utf8"),
  );

  test("the send mints exactly one id and the turn consumes it — no fallback mint", () => {
    expect(windowSource.match(/mintTurnId\(/g)).toHaveLength(1);
    expect(serviceSource).toContain("const turnId = options.turnId;");
    // The fallback both sites once had is gone: minting inside the turn (or
    // the retry) is exactly what would split one send across two ids.
    expect(serviceSource).not.toContain("?? mintTurnId()");
  });

  test("KALSA_WINDOW carries the id, and the turn options carry it too", () => {
    // `turnId,` (word-boundary) in the window JSON and the options literal —
    // comment-free source, so the import's `mintTurnId,` cannot count.
    expect(windowSource.match(/\bturnId,/g)).toHaveLength(2);
    const windowBlock = windowSource.slice(
      windowSource.indexOf("KALSA_WINDOW"),
      windowSource.indexOf("} catch {", windowSource.indexOf("KALSA_WINDOW")),
    );
    expect(windowBlock).toContain("turnId,");
  });

  test("KALSA_GOVERNOR spreads the route-evidence fields and the attempt", () => {
    expect(serviceSource.match(/\.\.\.governorRouteLogFields\(/g)).toHaveLength(1);
    expect(serviceSource).toContain("attempt: turnAttempt,");
    expect(serviceSource).toContain("routePush: turnRoutePush");
  });

  test("the runtime-fallback marker and its retry share one id + attempt", () => {
    // The marker names the retry that follows; the retry reuses the send's
    // id (never a fresh mint) and bumps the attempt, and the turn's
    // telemetry line carries it.
    expect(serviceSource).toContain("JSON.stringify({ reason, turnId, attempt })");
    expect(serviceSource).toContain("(options.turnAttempt ?? 1) + 1");
    expect(serviceSource).toMatch(
      /reloadGovernorRuntimeFallback\(\s*attempt\.reason,\s*retryOptions\.locale,\s*options\.turnId,\s*retryAttempt,/,
    );
    expect(serviceSource).toContain(
      "streamAssistantTurn(messages, callbacks, signal, retryOptions)",
    );
    expect(serviceSource).toContain("formatTelemetryLine(turnId, r, attempt)");
    expect(telemetrySource).toContain("attempt,");
  });

  test("the governor line reports the record captured at the push, not a re-read", () => {
    // No readBenchRoute anywhere in the emit path — only at the push.
    const emit = serviceSource.slice(
      serviceSource.indexOf("async function emitGovernorTelemetry"),
      serviceSource.indexOf("function emitToolCallTelemetry"),
    );
    expect(emit).not.toContain("readBenchRoute(");
    expect(serviceSource).toContain("turnRoutePush = null;");
  });
});
