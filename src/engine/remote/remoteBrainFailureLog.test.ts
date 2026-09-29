import {
  logRemoteBrainFailure,
  remoteBrainFailureReason,
} from "./remoteBrainFailureLog";

describe("remoteBrainFailureReason", () => {
  test("our own codes pass through verbatim", () => {
    expect(remoteBrainFailureReason(new Error("remote_brain_http_401"))).toBe(
      "remote_brain_http_401",
    );
    expect(remoteBrainFailureReason(new Error("remote_brain_timeout"))).toBe(
      "remote_brain_timeout",
    );
  });

  test("the engine's control codes map to their token", () => {
    const interrupted = new Error("_interrupted sentence") as Error & { code: string };
    interrupted.code = "interrupted";
    expect(remoteBrainFailureReason(interrupted)).toBe("interrupted");
    const truncated = new Error("another sentence") as Error & { code: string };
    truncated.code = "truncated";
    expect(remoteBrainFailureReason(truncated)).toBe("truncated");
  });

  test("the probe's status spelling becomes the http code", () => {
    expect(remoteBrainFailureReason(new Error("models HTTP 401"))).toBe(
      "remote_brain_http_401",
    );
    expect(remoteBrainFailureReason(new Error("health HTTP 503"))).toBe(
      "remote_brain_http_503",
    );
  });

  test("anything else collapses to remote_brain_internal — no free text in the log", () => {
    expect(
      remoteBrainFailureReason(
        new Error("fetch failed: java.net.ConnectException: 10.0.0.2:8443"),
      ),
    ).toBe("remote_brain_internal");
    expect(remoteBrainFailureReason(new Error("Model unloaded"))).toBe(
      "remote_brain_internal",
    );
    expect(remoteBrainFailureReason(undefined)).toBe("remote_brain_internal");
    expect(remoteBrainFailureReason("remote_brain_network")).toBe(
      "remote_brain_internal",
    );
  });
});

describe("logRemoteBrainFailure", () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  test("one line with road, stage and the normalized code", () => {
    logRemoteBrainFailure("init", "iroh", new Error("remote_brain_http_401"));
    expect(logSpy).toHaveBeenCalledWith(
      "remote.brain.failure",
      JSON.stringify({ road: "iroh", stage: "init", reason: "remote_brain_http_401" }),
    );
  });

  test("a user stop stays silent — interrupted is not a failure", () => {
    const stop = new Error("interrupted sentence") as Error & { code: string };
    stop.code = "interrupted";
    logRemoteBrainFailure("stream", "https", stop);
    expect(logSpy).not.toHaveBeenCalled();
  });

  test("a native exception logs the collapsed code, never its message", () => {
    logRemoteBrainFailure(
      "stream",
      "unknown",
      new Error("secret at /Users/marco/.kalsa/config"),
    );
    const line = logSpy.mock.calls[0]?.[1] as string;
    expect(line).toBe(
      JSON.stringify({ road: "unknown", stage: "stream", reason: "remote_brain_internal" }),
    );
  });
});
