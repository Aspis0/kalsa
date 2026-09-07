import {
  acceptSignal,
  classifyHttpStatus,
  classifyNetworkFailure,
  extractSignal,
  sanitizeReport,
} from "./pure";

describe("telemetry pure helpers", () => {
  test("keeps an allowlisted detail and signal", () => {
    const report = sanitizeReport({
      code: "web.fetch",
      detail: "timeout",
      signal: "ENOSPC",
      appVersion: "1.2.3",
    });

    expect(report?.error).toEqual({
      code: "web.fetch",
      detail: "timeout",
      signal: "ENOSPC",
    });
  });

  test.each([
    "network request failed",
    "https://example.com/private?token=secret",
    "/data/user/0/com.kalsa/files/chat.db",
  ])("omits unsafe free-text detail: %s", (detail) => {
    const report = sanitizeReport({ code: "web.fetch", detail });
    expect(report?.error.detail).toBeUndefined();
  });

  test("does not leak chat, URLs, or paths from rawMessage", () => {
    const chat = "Alice's private chat about her diagnosis";
    const url = "https://example.com/private?token=secret";
    const path = "/data/user/0/com.kalsa/files/chat.db";
    const report = sanitizeReport({
      code: "web.fetch",
      detail: url,
      rawMessage: `${chat} ${url} ${path} ENOSPC`,
    });

    const serialized = JSON.stringify(report);
    expect(report?.error).toEqual({ code: "web.fetch", signal: "ENOSPC" });
    expect(serialized).not.toContain(chat);
    expect(serialized).not.toContain(url);
    expect(serialized).not.toContain(path);
  });

  test("omits an unsafe explicit signal", () => {
    const report = sanitizeReport({
      code: "engine.init",
      signal: "https://example.com/stack/path",
    });

    expect(report?.error.signal).toBeUndefined();
  });

  test("extracts only the fixed signal from a message", () => {
    expect(extractSignal("No space left on device (ENOSPC)")).toBe("ENOSPC");
    expect(extractSignal("ggml_opencl failed at /data/model.gguf")).toBe(
      "ggml_*",
    );
    expect(extractSignal("ordinary user chat text")).toBeUndefined();
  });

  test("does not extract a URL or path as a signal", () => {
    expect(
      extractSignal("failed https://example.com/a/b?q=1 /data/user/0/files"),
    ).toBeUndefined();
  });

  test.each([
    ["ENOSPC", "ENOSPC"],
    ["ggml_opencl", "ggml_*"],
    ["segmentation fault", "segmentation fault"],
  ])("accepts allowlisted signal %s", (input, expected) => {
    expect(acceptSignal(input)).toBe(expected);
  });

  test.each([
    "free text",
    "https://example.com/ENOSPC",
    "ENOSPC/path",
    "bad*star",
  ])("rejects unallowlisted signal: %s", (signal) => {
    expect(acceptSignal(signal)).toBeUndefined();
  });

  test.each([
    [200, "accepted"],
    [429, "backoff"],
    [404, "definitive_drop"],
    [503, "requeue"],
  ] as const)("classifies HTTP status %s", (status, expected) => {
    expect(classifyHttpStatus(status)).toBe(expected);
  });

  test.each([
    ["request timed out", "timeout"],
    ["getaddrinfo ENOTFOUND example.com", "dns"],
    ["TLS handshake failed", "tls"],
    ["out of memory", "oom"],
    ["unexpected failure", "unknown"],
  ] as const)("classifies network failure %s", (message, expected) => {
    expect(classifyNetworkFailure(message)).toBe(expected);
  });
});
