/**
 * Sender tests with a mocked network: the header grammar, the local refusals
 * (empty log, malformed header) that must never reach fetch, the Worker
 * status/JSON mapping, the timeout, and the exact body handed to fetch.
 */

jest.mock("react-native", () => ({
  Platform: { OS: "android" },
}));

jest.mock("../collector", () => ({
  readLogReportText: jest.fn(() => ""),
}));

// expo-constants is required lazily inside sendLog, so the factory's closure
// over mockVersion is already initialized by the time it runs.
const mockVersion: { value: string | undefined } = { value: "1.4.2" };
jest.mock("expo-constants", () => ({
  default: {
    get expoConfig() {
      return mockVersion.value === undefined ? undefined : { version: mockVersion.value };
    },
  },
}));

import { sendLog } from "../sendLog";

const collector = jest.requireMock("../collector") as {
  readLogReportText: jest.Mock;
};

// The Worker's own grammar (workers/report/index.ts APP_HEADER_PATTERN).
const WORKER_HEADER_PATTERN =
  /^[0-9A-Za-z._-]{1,32}\/[a-z0-9_]{1,16}\/[a-z0-9_]{1,16}$/;

function jsonResponse(status: number, body: unknown): { status: number; json: () => Promise<unknown> } {
  return { status, json: async () => body };
}

let fetchMock: jest.Mock;

beforeEach(() => {
  mockVersion.value = "1.4.2";
  collector.readLogReportText.mockReturnValue("KALSA_APP event=started\n");
  fetchMock = jest.spyOn(globalThis, "fetch").mockName("fetch") as unknown as jest.Mock;
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

function mockFetchReply(reply: { status: number; json: () => Promise<unknown> }): void {
  fetchMock.mockImplementation(async () => reply);
}

function sentInit(): RequestInit {
  return fetchMock.mock.calls[0][1] as RequestInit;
}

describe("the X-Kalsa-App header", () => {
  it("sends <version>/<os>/<arch> matching the Worker grammar", async () => {
    mockFetchReply(jsonResponse(201, { id: "ABCD2345" }));
    const result = await sendLog();

    expect(result).toEqual({ ok: true, id: "ABCD2345" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://kalsa.io/report");
    expect(sentInit().method).toBe("POST");
    expect(sentInit().headers).toEqual({
      "Content-Type": "text/plain; charset=utf-8",
      "X-Kalsa-App": "1.4.2/android/arm64",
    });
  });

  it("falls back to the telemetry default version 0.1.0", async () => {
    mockVersion.value = undefined;
    mockFetchReply(jsonResponse(201, { id: "ABCD2345" }));
    await sendLog();

    expect((sentInit().headers as Record<string, string>)["X-Kalsa-App"]).toBe(
      "0.1.0/android/arm64",
    );
  });

  it("never sends a header outside the Worker grammar", async () => {
    mockFetchReply(jsonResponse(201, { id: "ABCD2345" }));
    await sendLog();
    expect(WORKER_HEADER_PATTERN.test((sentInit().headers as Record<string, string>)["X-Kalsa-App"])).toBe(true);
  });

  it("refuses a malformed header locally without any request", async () => {
    mockVersion.value = "1.4.2 beta"; // the space is outside the version grammar
    const result = await sendLog();

    expect(result).toEqual({ ok: false, reason: "failed" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the empty log refusal", () => {
  it("returns empty and never calls fetch", async () => {
    collector.readLogReportText.mockReturnValue("");
    const result = await sendLog();

    expect(result).toEqual({ ok: false, reason: "empty" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the Worker status mapping", () => {
  it.each([
    ["201 with a well-formed id", jsonResponse(201, { id: "ABCD2345" }), { ok: true, id: "ABCD2345" }],
    ["201 with a lowercase id", jsonResponse(201, { id: "abcd2345" }), { ok: false, reason: "failed" }],
    ["201 with an id containing 1", jsonResponse(201, { id: "AB1C2345" }), { ok: false, reason: "failed" }],
    ["201 with a non-string id", jsonResponse(201, { id: 12345678 }), { ok: false, reason: "failed" }],
    ["429", jsonResponse(429, { error: { code: "rate_limited" } }), { ok: false, reason: "rate_limited" }],
    ["503 daily_limit", jsonResponse(503, { error: { code: "daily_limit" } }), { ok: false, reason: "daily_limit" }],
    ["503 storage_conflict", jsonResponse(503, { error: { code: "storage_conflict" } }), { ok: false, reason: "failed" }],
    ["503 without JSON", { status: 503, json: async () => { throw new Error("bad"); } }, { ok: false, reason: "failed" }],
    ["413", jsonResponse(413, { error: { code: "payload_too_large" } }), { ok: false, reason: "failed" }],
    ["415", jsonResponse(415, { error: { code: "unsupported_media_type" } }), { ok: false, reason: "failed" }],
    ["400", jsonResponse(400, { error: { code: "bad_app_header" } }), { ok: false, reason: "failed" }],
    ["404", jsonResponse(404, { error: { code: "not_found" } }), { ok: false, reason: "failed" }],
    ["500", jsonResponse(500, { error: { code: "internal_error" } }), { ok: false, reason: "failed" }],
  ])("%s maps to the documented result", async (_name, reply, expected) => {
    mockFetchReply(reply);
    await expect(sendLog()).resolves.toEqual(expected);
  });

  it("maps a 201 whose JSON cannot be parsed to failed", async () => {
    mockFetchReply({
      status: 201,
      json: async () => {
        throw new Error("invalid json");
      },
    });
    await expect(sendLog()).resolves.toEqual({ ok: false, reason: "failed" });
  });
});

describe("the request body", () => {
  it("posts exactly the text read from the report store", async () => {
    const logText = "KALSA_ROAD {\"road\":\"iroh\"}\nKALSA_LOAD {\"ms\":12}\n";
    collector.readLogReportText.mockReturnValue(logText);
    mockFetchReply(jsonResponse(201, { id: "ABCD2345" }));
    await sendLog();

    expect(sentInit().body).toBe(logText);
  });
});

describe("the 30 s timeout", () => {
  it("aborts a hanging request and resolves failed", async () => {
    jest.useFakeTimers();
    let abortSignal: AbortSignal | undefined;
    fetchMock.mockImplementation(((_url: unknown, init?: { signal?: AbortSignal }) => {
      abortSignal = init?.signal;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      });
    }) as unknown as typeof fetch);

    const pending = sendLog();
    await jest.advanceTimersByTimeAsync(30_000);

    await expect(pending).resolves.toEqual({ ok: false, reason: "failed" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(abortSignal?.aborted).toBe(true);
  });
});

describe("implicit sends", () => {
  it("never calls fetch: not on import, not for an empty body", async () => {
    expect(fetchMock).not.toHaveBeenCalled();

    collector.readLogReportText.mockReturnValue("");
    await sendLog();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
