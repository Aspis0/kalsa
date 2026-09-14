import {
  canSendAuthorization,
  isLoopbackHost,
  joinRemoteApiUrl,
  normalizeRemoteUrl,
  redactUrl,
} from "./remoteUrl";

describe("normalizeRemoteUrl", () => {
  test("strips userinfo and trailing slash", () => {
    const out = normalizeRemoteUrl("https://user:pass@example.com/v1/");
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.url).toBe("https://example.com/v1");
  });

  test("rejects non-http schemes", () => {
    expect(normalizeRemoteUrl("ftp://x").ok).toBe(false);
    expect(normalizeRemoteUrl("not a url").ok).toBe(false);
  });
});

describe("joinRemoteApiUrl", () => {
  test("bare host plus /v1/models", () => {
    expect(joinRemoteApiUrl("http://127.0.0.1:8000", "/v1/models")).toBe(
      "http://127.0.0.1:8000/v1/models",
    );
  });

  test("does not double /v1", () => {
    expect(joinRemoteApiUrl("http://127.0.0.1:8000/v1", "/v1/models")).toBe(
      "http://127.0.0.1:8000/v1/models",
    );
    expect(joinRemoteApiUrl("http://127.0.0.1:8000/v1", "/v1/chat/completions")).toBe(
      "http://127.0.0.1:8000/v1/chat/completions",
    );
  });

  test("health stays at server root when base is /v1", () => {
    expect(joinRemoteApiUrl("http://127.0.0.1:8000/v1", "/health")).toBe(
      "http://127.0.0.1:8000/health",
    );
  });
});

describe("auth policy", () => {
  test("https and loopback http may send Authorization", () => {
    expect(canSendAuthorization("https://example.ts.net")).toBe(true);
    expect(canSendAuthorization("http://127.0.0.1:8000")).toBe(true);
    expect(canSendAuthorization("http://example.com")).toBe(false);
  });

  test("redactUrl strips userinfo", () => {
    expect(redactUrl("https://u:p@host/x")).toBe("https://host/x");
  });

  test("loopback hosts", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("example.com")).toBe(false);
  });
});
