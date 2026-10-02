/**
 * HTTP contract of the report Worker: routes, methods, and header/body
 * validation. What lands in the bucket is in storage.test.ts.
 */

import worker from "./index";
import { CAP, CLIENT_IP, REPORT_URL, VALID_APP, errorBody, fakeEnv, post } from "./fakes";

describe("routing and methods", () => {
  test("GET /report is 405 with Allow: POST and the error JSON shape", async () => {
    const { env, limitKeys } = fakeEnv();
    const res = await worker.fetch(new Request(REPORT_URL), env);
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const body = JSON.parse(await res.text());
    expect(Object.keys(body)).toEqual(["error"]);
    expect(Object.keys(body.error)).toEqual(["code", "message"]);
    expect(body.error.code).toBe("method_not_allowed");
    expect(limitKeys).toEqual([]);
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

  test("plaintext http:// is 404 like an unknown path", async () => {
    const { env, puts, limitKeys } = fakeEnv();
    const res = await worker.fetch(
      new Request("http://kalsa.io/report", {
        method: "POST",
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "content-length": "4",
          "x-kalsa-app": VALID_APP,
          "cf-connecting-ip": CLIENT_IP,
        },
        body: "log\n",
      }),
      env,
    );
    expect(res.status).toBe(404);
    expect((await errorBody(res)).code).toBe("not_found");
    expect(puts).toHaveLength(0);
    expect(limitKeys).toEqual([]);
  });

  test("a query string on /report still routes", async () => {
    const { env, puts } = fakeEnv();
    const res = await worker.fetch(
      new Request(REPORT_URL + "?attempt=1", {
        method: "POST",
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "content-length": "4",
          "x-kalsa-app": VALID_APP,
          "cf-connecting-ip": CLIENT_IP,
        },
        body: "log\n",
      }),
      env,
    );
    expect(res.status).toBe(201);
    expect(puts).toHaveLength(1);
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

  test("201 without Content-Length", async () => {
    const { env, puts } = fakeEnv();
    const res = await post(env, "log without a length header\n", { "content-length": null });
    expect(res.status).toBe(201);
    expect(puts).toHaveLength(1);
    expect(new TextDecoder().decode(puts[0].value)).toBe("log without a length header\n");
  });

  test("oversized stream with no Content-Length is capped mid-stream, nothing stored", async () => {
    const { env, puts } = fakeEnv();
    const res = await post(env, "x".repeat(CAP + 1), { "content-length": null });
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
    const bad: Record<string, string | null>[] = [
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
