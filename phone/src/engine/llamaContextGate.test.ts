import {
  __resetForTests,
  isChatModel2BClass,
  isChatModel4BClass,
  isNativeOpChainEmpty,
  runNativeOp,
  runNativeOpBounded,
} from "./llamaContextGate";

describe("chat model size-class helpers", () => {
  it("uses ModelInfo.sizeClass for the two listed chat models", () => {
    expect(isChatModel2BClass("lfm2.5-2.6b")).toBe(true);
    expect(isChatModel4BClass("lfm2.5-2.6b")).toBe(false);
    expect(isChatModel2BClass("qwen3.5-4b")).toBe(false);
    expect(isChatModel4BClass("qwen3.5-4b")).toBe(true);
  });

  it("does not classify stale or unknown ids as the default model", () => {
    expect(isChatModel2BClass("removed-model")).toBe(false);
    expect(isChatModel4BClass("removed-model")).toBe(false);
    expect(isChatModel2BClass(null)).toBe(false);
    expect(isChatModel4BClass(undefined)).toBe(false);
  });
});

// The model-switch dispose relies on runNativeOpBounded: when a native
// completion never settles (handleStop abort path), dispose must refuse after
// a deadline instead of queueing behind the hung op forever.
describe("runNativeOpBounded", () => {
  afterEach(() => {
    __resetForTests();
  });

  it("runs immediately and returns the value when the chain is empty", async () => {
    const result = await runNativeOpBounded(async () => 42, 1_000);
    expect(result).toEqual({ ok: true, value: 42 });
    expect(isNativeOpChainEmpty()).toBe(true);
  });

  it("refuses with timeout when the chain is hung and does not enqueue", async () => {
    // A never-settling op holds the chain (never-overlap invariant).
    void runNativeOp(() => new Promise<void>(() => undefined));
    expect(isNativeOpChainEmpty()).toBe(false);

    const started = Date.now();
    const result = await runNativeOpBounded(async () => "never", 80, 10);
    const elapsed = Date.now() - started;

    expect(result).toEqual({ ok: false, refused: "timeout" });
    expect(elapsed).toBeGreaterThanOrEqual(80);
    // Refusal must not append a third op: still exactly the one hung op.
    expect(isNativeOpChainEmpty()).toBe(false);
  });

  it("submits when the chain frees before the deadline", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    void runNativeOp(async () => {
      await gate;
      return 1;
    });
    const pending = runNativeOpBounded(async () => 2, 1_000, 10);
    const timer = setTimeout(release, 30);
    try {
      await expect(pending).resolves.toEqual({ ok: true, value: 2 });
    } finally {
      clearTimeout(timer);
    }
  });
});
