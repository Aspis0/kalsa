/**
 * Unit tests for the llama.cpp native log tail and its console mirror
 * (KALSA_NATIVE). The invariant under pin: WARN/ERROR always mirror (a native
 * abort does not throw — the last line ggml prints is the whole diagnosis),
 * INFO mirrors only when kalsa.bench.nativelog is on: measured on the S23
 * (2026-09-27) the engine-load phase crossed ~1,570 then ~1,990 INFO lines to
 * JS in seconds (1,102 in the peak second) and each became a console.log +
 * logcat write. The in-memory tail keeps EVERY level regardless.
 */

jest.mock("llama.rn", () => ({
  toggleNativeLog: jest.fn(async () => undefined),
  addNativeLogListener: jest.fn(),
}));
jest.mock("../bench/benchConfig", () => ({
  getBenchNativeLogMirror: jest.fn(async () => false),
}));

import { addNativeLogListener } from "llama.rn";
import { getBenchNativeLogMirror } from "../bench/benchConfig";
import {
  beginNativeLogEpoch,
  ensureNativeLogCapture,
  logNativeTailOnFailure,
  nativeLogForEpoch,
  nativeLogSummary,
  resetNativeLogTailForTests,
  shouldMirrorNativeLog,
} from "./nativeLogTail";

let listener: ((level: string, text: string) => void) | null = null;

function drive(level: string, text: string): void {
  listener!(level, text);
}

function mirrored(): string[] {
  return (console.log as jest.Mock).mock.calls
    .map(([first]) => String(first))
    .filter((first) => first.startsWith("KALSA_NATIVE"));
}

beforeEach(async () => {
  jest.clearAllMocks();
  resetNativeLogTailForTests();
  jest.spyOn(console, "log").mockImplementation(() => undefined);
  (getBenchNativeLogMirror as jest.Mock).mockResolvedValue(false);
  (addNativeLogListener as jest.Mock).mockImplementation((cb) => {
    listener = cb;
  });
  await ensureNativeLogCapture();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("shouldMirrorNativeLog (the gate)", () => {
  test("warn and error always mirror, whatever the pref", () => {
    expect(shouldMirrorNativeLog("warn", false)).toBe(true);
    expect(shouldMirrorNativeLog("error", false)).toBe(true);
    expect(shouldMirrorNativeLog("warn", true)).toBe(true);
  });

  test("info mirrors only when the bench pref is on", () => {
    expect(shouldMirrorNativeLog("info", false)).toBe(false);
    expect(shouldMirrorNativeLog("info", true)).toBe(true);
    // The binding maps DEBUG onto the default "info" string too.
    expect(shouldMirrorNativeLog("debug", true)).toBe(true);
  });
});

describe("the installed listener", () => {
  test("a WARN line is always mirrored", () => {
    drive("warn", "warning: failed to mlock 223281152-byte buffer: Out of memory");
    expect(mirrored()).toEqual([
      "KALSA_NATIVE warn warning: failed to mlock 223281152-byte buffer: Out of memory",
    ]);
  });

  test("an ERROR line is always mirrored", () => {
    drive("error", "ggml_gallocr_reserve_n: failed to allocate graph buffers");
    expect(mirrored()).toEqual([
      "KALSA_NATIVE error ggml_gallocr_reserve_n: failed to allocate graph buffers",
    ]);
  });

  test("an INFO line is NOT mirrored by default", () => {
    drive("info", "create_tensor: loading tensor token_embd.weight");
    expect(mirrored()).toEqual([]);
  });

  test("INFO mirrors when the bench pref was on at capture setup", async () => {
    (getBenchNativeLogMirror as jest.Mock).mockResolvedValue(true);
    resetNativeLogTailForTests();
    await ensureNativeLogCapture();
    drive("info", "llama_model_loader: loaded meta data with 38 key-value pairs");
    expect(mirrored()).toEqual([
      "KALSA_NATIVE info llama_model_loader: loaded meta data with 38 key-value pairs",
    ]);
  });

  test("the tail keeps every level even when INFO is not mirrored", () => {
    const epoch = beginNativeLogEpoch();
    drive("info", "create_tensor: loading tensor output_norm.weight");
    drive("warn", "failed to mlock buffer");
    const log = nativeLogForEpoch(epoch);
    expect(log).toContain("create_tensor: loading tensor output_norm.weight");
    expect(log).toContain("failed to mlock buffer");
    expect(nativeLogSummary()).toContain("failed to mlock buffer");
  });

  test("logNativeTailOnFailure prints the unmirrored INFO tail too", () => {
    drive("info", "print_info: n_ctx = 16384");
    logNativeTailOnFailure();
    const dumped = (console.log as jest.Mock).mock.calls.filter(
      ([first]) => first === "[engine-init-native-tail]",
    );
    expect(dumped).toHaveLength(1);
    expect(String(dumped[0][1])).toContain("print_info: n_ctx = 16384");
  });
});

describe("capture setup", () => {
  test("installs the listener once and never mirrors before it is asked", async () => {
    expect(addNativeLogListener).toHaveBeenCalledTimes(1);
    await ensureNativeLogCapture();
    expect(addNativeLogListener).toHaveBeenCalledTimes(1);
  });
});
