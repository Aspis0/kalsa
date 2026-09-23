import {
  canSendAuthorization,
  isLoopbackHost,
  joinRemoteApiUrl,
  normalizeRemoteUrl,
  redactUrl,
  remoteUrlAllowedInThisBuild,
  remoteUrlGateError,
} from "./remoteUrl";

function withDevFlag(value: boolean, run: () => void): void {
  const g = globalThis as { __DEV__?: boolean };
  const had = Object.prototype.hasOwnProperty.call(g, "__DEV__");
  const prev = g.__DEV__;
  g.__DEV__ = value;
  try {
    run();
  } finally {
    if (had) g.__DEV__ = prev;
    else delete g.__DEV__;
  }
}

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

  test("strips the query string: a credential can hide there and this URL is stored in the clear", () => {
    const out = normalizeRemoteUrl("https://example.com/v1/?token=SECRET");
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.url).toBe("https://example.com/v1");
      expect(out.url).not.toContain("SECRET");
    }
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

  test("redactUrl strips the query too", () => {
    expect(redactUrl("https://u:p@host/x?token=SECRET")).toBe("https://host/x");
  });

  test("loopback hosts", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("example.com")).toBe(false);
  });

  test("https non-loopback and http loopback allowed in both __DEV__ regimes", () => {
    const httpsLan = "https://mac.example.ts.net";
    const httpLoop = "http://127.0.0.1:8000";
    const httpLan = "http://192.168.1.10:8000";
    withDevFlag(true, () => {
      expect(remoteUrlAllowedInThisBuild(httpsLan)).toBe(true);
      expect(remoteUrlAllowedInThisBuild(httpLoop)).toBe(true);
      expect(remoteUrlAllowedInThisBuild(httpLan)).toBe(false);
    });
    withDevFlag(false, () => {
      expect(remoteUrlAllowedInThisBuild(httpsLan)).toBe(true);
      expect(remoteUrlAllowedInThisBuild(httpLoop)).toBe(true);
      expect(remoteUrlAllowedInThisBuild(httpLan)).toBe(false);
    });
  });

  test("empty URL is url_missing, not https_required", () => {
    expect(remoteUrlGateError("")).toBe("remote_brain_url_missing");
    expect(remoteUrlGateError("   ")).toBe("remote_brain_url_missing");
    withDevFlag(false, () => {
      expect(remoteUrlGateError("http://127.0.0.1:8000")).toBeNull();
      expect(remoteUrlGateError("http://example.com")).toBe(
        "remote_brain_https_required",
      );
    });
  });
});
