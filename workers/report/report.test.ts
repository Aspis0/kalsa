import worker, { newReportId, type Env } from "./index";

const REPORT_URL = "https://kalsa.io/report";
const VALID_APP = "0.9.1/macos/arm64";
const CLIENT_IP = "203.0.113.9";
const CAP = 4 * 1024 * 1024;

type PutRecord = {
  key: string;
  value: Uint8Array;
  options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> };
};

/** A null header value in overrides deletes the default (header absent). */
type HeaderOverrides = Record<string, string | null>;

function fakeEnv(limitSuccess = true) {
  const puts: PutRecord[] = [];
  const limitKeys: string[] = [];
  const env = {
    REPORTS: {
      put: async (key: string, value: Uint8Array, options?: PutRecord["options"]) => {
        puts.push({ key, value, options });
      },
    },
    REPORT_RATE_LIMITER: {
      limit: async (req: { key: string }) => {
        limitKeys.push(req.key);
        return { success: limitSuccess };
      },
    },
  } as unknown as Env;
  return { env, puts, limitKeys };
}

function post(
  env: Env,
  body = "line one\nline two\n",
  headers: HeaderOverrides = {},
): Promise<Response> {
  const merged: Record<string, string> = {
    "content-type": "text/plain; charset=utf-8",
    "content-length": String(Buffer.byteLength(body)),
    "x-kalsa-app": VALID_APP,
    "cf-connecting-ip": CLIENT_IP,
  };
  for (const [name, value] of Object.entries(headers)) {
    if (value === null) delete merged[name];
    else merged[name] = value;
  }
  return worker.fetch(new Request(REPORT_URL, { method: "POST", headers: merged, body }), env);
}

async function errorBody(res: Response): Promise<{ code: string; message: string }> {
  const body = JSON.parse(await res.text());
  return body.error;
}

describe("routing and methods", () => {
  test("GET /report is 405 with the error JSON shape", async () => {
    const { env } = fakeEnv();
    const res = await worker.fetch(new Request(REPORT_URL), env);
    expect(res.status).toBe(405);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const body = JSON.parse(await res.text());
    expect(Object.keys(body)).toEqual(["error"]);
    expect(Object.keys(body.error)).toEqual(["code", "message"]);
    expect(body.error.code).toBe("method_not_allowed");
  });

  test("any other path or host is 404", async () => {
    const { env, puts } = fakeEnv();
    for (const path of ["/", "/report/", "/reports", "/report/2025-01-01/x.log", "/pair"]) {
      const res = await worker.fetch(
        new Request("https://kalsa.io" + path, { method: "POST", body: "log\n" }),
        env,
      );
      expect(res.status).toBe(404);
      expect((await errorBody(res)).code).toBe("not_found");
    }
    const foreign = await worker.fetch(
      new Request("https://other.example/report", { method: "POST", body: "log\n" }),
      env,
    );
    expect(foreign.status).toBe(404);
    expect(puts).toHaveLength(0);
  });
});

describe("request validation", () => {
  test("415 for a non-log content type", async () => {
    const { env, puts } = fakeEnv();
    const res = await post(env, '{"why":"not a log"}', { "content-type": "application/json" });
    expect(res.status).toBe(415);
    expect((await errorBody(res)).code).toBe("unsupported_media_type");
    expect(puts).toHaveLength(0);
  });

  test("415 for a missing content type", async () => {
    const { env, puts } = fakeEnv();
    const res = await worker.fetch(
      new Request(REPORT_URL, {
        method: "POST",
        headers: {
          "content-length": "9",
          "x-kalsa-app": VALID_APP,
          "cf-connecting-ip": CLIENT_IP,
        },
        body: new TextEncoder().encode("log bytes"),
      }),
      env,
    );
    expect(res.status).toBe(415);
    expect(puts).toHaveLength(0);
  });

  test("411 without Content-Length", async () => {
    const { env, puts } = fakeEnv();
    const res = await post(env, "log\n", { "content-length": null });
    expect(res.status).toBe(411);
    expect((await errorBody(res)).code).toBe("length_required");
    expect(puts).toHaveLength(0);
  });

  test("413 by Content-Length over the cap", async () => {
    const { env, puts } = fakeEnv();
    const res = await post(env, "small body\n", { "content-length": String(CAP + 1) });
    expect(res.status).toBe(413);
    expect((await errorBody(res)).code).toBe("payload_too_large");
    expect(puts).toHaveLength(0);
  });

  test("413 by a lying Content-Length plus an oversized stream, nothing stored", async () => {
    const { env, puts } = fakeEnv();
    const res = await post(env, "x".repeat(CAP + 1), { "content-length": "10" });
    expect(res.status).toBe(413);
    expect((await errorBody(res)).code).toBe("payload_too_large");
    expect(puts).toHaveLength(0);
  });

  test("400 for an empty body", async () => {
    const { env, puts } = fakeEnv();
    const res = await post(env, "");
    expect(res.status).toBe(400);
    expect((await errorBody(res)).code).toBe("empty_body");
    expect(puts).toHaveLength(0);
  });

  test("400 for a missing or malformed X-Kalsa-App", async () => {
    const { env, puts } = fakeEnv();
    const bad: HeaderOverrides[] = [
      { "x-kalsa-app": null },
      { "x-kalsa-app": "1.0.0" },
      { "x-kalsa-app": "1.0.0/MacOS/arm64" },
      { "x-kalsa-app": "1.0.0/mac os/arm64" },
      { "x-kalsa-app": `${"1".repeat(33)}/macos/arm64` },
      { "x-kalsa-app": "1.0.0/macos/" },
    ];
    for (const headers of bad) {
      const res = await post(env, "log\n", headers);
      expect(res.status).toBe(400);
      expect((await errorBody(res)).code).toBe("bad_app_header");
    }
    expect(puts).toHaveLength(0);
  });
});

describe("storage", () => {
  test("201 with the id, key shape, and stored metadata", async () => {
    const { env, puts, limitKeys } = fakeEnv();
    const res = await post(env, "line one\nline two\n", { "x-kalsa-app": "1.4.0/linux/x86_64" });
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
    const id = JSON.parse(await res.text()).id;
    expect(id).toMatch(/^[2-9A-HJ-KM-NP-Z]{8}$/);
    expect(limitKeys).toEqual([CLIENT_IP]);
    expect(puts).toHaveLength(1);
    const put = puts[0];
    expect(put.key).toMatch(/^\d{4}-\d{2}-\d{2}\/[2-9A-HJ-KM-NP-Z]{8}\.log$/);
    expect(put.key.slice(0, 10)).toBe(new Date().toISOString().slice(0, 10));
    expect(put.key.slice(11, -4)).toBe(id);
    expect(new TextDecoder().decode(put.value)).toBe("line one\nline two\n");
    expect(put.options?.httpMetadata).toEqual({ contentType: "text/plain" });
    expect(Object.keys(put.options?.customMetadata ?? {})).toEqual(["app", "received"]);
    expect(put.options?.customMetadata?.app).toBe("1.4.0/linux/x86_64");
    const received = put.options?.customMetadata?.received ?? "";
    expect(Number.isNaN(Date.parse(received))).toBe(false);
  });
});

describe("rate limiting", () => {
  test("429 when the limiter refuses, nothing stored", async () => {
    const { env, puts, limitKeys } = fakeEnv(false);
    const res = await post(env);
    expect(res.status).toBe(429);
    expect((await errorBody(res)).code).toBe("rate_limited");
    expect(limitKeys).toEqual([CLIENT_IP]);
    expect(puts).toHaveLength(0);
  });
});

describe("report id", () => {
  test("ids are 8 chars from the phone-readable alphabet", () => {
    const pattern = /^[2-9A-HJ-KM-NP-Z]{8}$/;
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const id = newReportId();
      expect(id).toMatch(pattern);
      seen.add(id);
    }
    expect(seen.size).toBeGreaterThan(300); // random ids, not a constant or a counter
  });
});
