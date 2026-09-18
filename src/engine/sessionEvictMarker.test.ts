/**
 * The evict marker in isolation: field merge, emit shape, error-name
 * allowlist. The pool-level marker tests cover the full pipeline.
 */

import {
  beginEvictMarker,
  errorTypeName,
} from "./sessionEvictMarker";

describe("errorTypeName", () => {
  test("allowlists error-shaped names", () => {
    expect(errorTypeName(new TypeError("no path here"))).toBe("TypeError");
    expect(errorTypeName({ name: "NodeError.sub" })).toBe("NodeError.sub");
    expect(errorTypeName({ name: "A".repeat(64) })).toBe("A".repeat(64));
  });

  test("falls back to unknown for anything path-shaped or odd", () => {
    expect(errorTypeName({ name: "/docs/lfm__c__env.kvs" })).toBe("unknown");
    expect(errorTypeName({ name: "sessions/x.kvs" })).toBe("unknown");
    expect(errorTypeName({ name: "" })).toBe("unknown");
    expect(errorTypeName({ name: "1abc" })).toBe("unknown");
    expect(errorTypeName({ name: "A".repeat(65) })).toBe("unknown");
    expect(errorTypeName({ name: 42 })).toBe("unknown");
    expect(errorTypeName("boom")).toBe("unknown");
    expect(errorTypeName(undefined)).toBe("unknown");
  });
});

describe("beginEvictMarker", () => {
  test("emits one KALSA_SESSION line, later sets winning", () => {
    const spy = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      const marker = beginEvictMarker();
      marker.set({ policy: "per-model", freeBytes: 5 });
      marker.set({ policy: "global" });
      marker.emit();
      expect(spy).toHaveBeenCalledTimes(1);
      const line = String(spy.mock.calls[0][0]);
      expect(line.startsWith("KALSA_SESSION ")).toBe(true);
      const payload = JSON.parse(line.slice("KALSA_SESSION ".length)) as {
        [key: string]: unknown;
      };
      expect(payload).toMatchObject({
        op: "evict",
        ok: false,
        policy: "global",
        freeBytes: 5,
      });
    } finally {
      spy.mockRestore();
    }
  });

  test("thrown records evict_failed with the allowlisted type", () => {
    const spy = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      const marker = beginEvictMarker();
      marker.thrown(new TypeError("message with /docs/paths"));
      marker.emit();
      const payload = JSON.parse(
        String(spy.mock.calls[0][0]).slice("KALSA_SESSION ".length),
      ) as { [key: string]: unknown };
      expect(payload).toMatchObject({
        op: "evict",
        ok: false,
        reason: "evict_failed",
        errorType: "TypeError",
      });
      // The message never reaches the line, only the type does.
      expect(String(spy.mock.calls[0][0])).not.toContain("/docs/");
    } finally {
      spy.mockRestore();
    }
  });
});
