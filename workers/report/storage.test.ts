/**
 * What the report Worker puts in the bucket and how the limits behave:
 * limiter ordering, daily cap, conditional writes, receipt time, ids.
 */

import worker, { DAILY_CAP, newReportId } from "./index";
import { CAP, CLIENT_IP, REPORT_URL, VALID_APP, errorBody, fakeEnv, post } from "./fakes";

describe("rate-limit ordering", () => {
  test("rejected requests never reach the rate limiter", async () => {
    const { env, puts, limitKeys } = fakeEnv();
    const rejected = [
      post(env, "x", { "content-type": "application/json" }), // 415
      post(env, "log\n", { "x-kalsa-app": null }), // 400
      post(env, "log\n", { "content-length": String(CAP + 1) }), // 413
      worker.fetch(new Request(REPORT_URL), env), // 405
    ];
    const statuses: number[] = [];
    for (const res of rejected) statuses.push((await res).status);
    expect(statuses).toEqual([415, 400, 413, 405]);
    expect(limitKeys).toEqual([]);
    expect(puts).toHaveLength(0);
    const ok = await post(env);
    expect(ok.status).toBe(201);
    expect(limitKeys).toEqual([CLIENT_IP]);
  });

  test("429 when the limiter refuses, nothing stored", async () => {
    const { env, puts, limitKeys } = fakeEnv({ limitSuccess: false });
    const res = await post(env);
    expect(res.status).toBe(429);
    expect((await errorBody(res)).code).toBe("rate_limited");
    expect(limitKeys).toEqual([CLIENT_IP]);
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
    expect(put.options?.onlyIf).toEqual({ etagDoesNotMatch: "*" });
    expect(put.options?.httpMetadata).toEqual({ contentType: "text/plain" });
    expect(Object.keys(put.options?.customMetadata ?? {})).toEqual(["app", "received"]);
    expect(put.options?.customMetadata?.app).toBe("1.4.0/linux/x86_64");
    const received = put.options?.customMetadata?.received ?? "";
    expect(Number.isNaN(Date.parse(received))).toBe(false);
  });

  test("received is the arrival time, taken before the body is read", async () => {
    const { env, puts } = fakeEnv();
    const arrival = new Date("2031-05-04T10:00:00.000Z");
    const duringBody = new Date("2031-05-05T00:30:00.000Z");
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const body = new ReadableStream({
      async pull(controller) {
        await gate;
        controller.enqueue(new TextEncoder().encode("log\n"));
        controller.close();
      },
    });
    // Only Date is faked; timers, ticks and microtasks stay real.
    jest.useFakeTimers({
      now: arrival.getTime(),
      doNotFake: [
        "hrtime",
        "nextTick",
        "performance",
        "queueMicrotask",
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "requestIdleCallback",
        "cancelIdleCallback",
        "setImmediate",
        "clearImmediate",
        "setInterval",
        "clearInterval",
        "setTimeout",
        "clearTimeout",
      ],
    });
    try {
      const pending = worker.fetch(
        new Request(REPORT_URL, {
          method: "POST",
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "content-length": "4",
            "x-kalsa-app": VALID_APP,
            "cf-connecting-ip": CLIENT_IP,
          },
          body,
          duplex: "half",
        } as RequestInit),
        env,
      );
      for (let i = 0; i < 10; i++) await Promise.resolve(); // handler is now blocked on the body
      jest.setSystemTime(duringBody);
      release();
      const res = await pending;
      expect(res.status).toBe(201);
      expect(puts).toHaveLength(1);
      expect(puts[0].options?.customMetadata?.received).toBe(arrival.toISOString());
      expect(puts[0].key.startsWith("2031-05-04/")).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  test("503 daily_limit once the day holds DAILY_CAP reports, nothing stored", async () => {
    const { env, puts } = fakeEnv({ dailyCount: DAILY_CAP });
    const res = await post(env);
    expect(res.status).toBe(503);
    expect((await errorBody(res)).code).toBe("daily_limit");
    expect(puts).toHaveLength(0);
  });

  test("a taken key is retried with a fresh id, never overwritten", async () => {
    const { env, puts, putAttempts } = fakeEnv({ rejectPuts: 1 });
    const res = await post(env);
    expect(res.status).toBe(201);
    const id = JSON.parse(await res.text()).id;
    expect(putAttempts).toHaveLength(2);
    for (const attempt of putAttempts) {
      expect(attempt.options?.onlyIf).toEqual({ etagDoesNotMatch: "*" });
    }
    expect(putAttempts[1].key).not.toBe(putAttempts[0].key);
    expect(puts).toHaveLength(1);
    expect(puts[0].key.endsWith(`/${id}.log`)).toBe(true);
  });

  test("503 after three taken keys, nothing stored", async () => {
    const { env, puts, putAttempts } = fakeEnv({ rejectPuts: 3 });
    const res = await post(env);
    expect(res.status).toBe(503);
    expect((await errorBody(res)).code).toBe("storage_conflict");
    expect(putAttempts).toHaveLength(3);
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
