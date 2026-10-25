/**
 * Retry ceiling vs offline sends, the queue TTL, and foreground readiness —
 * pure policy only; the service flow lives in scripts/telemetryHarness.mjs.
 */
import { BACKOFF_CAP_MS, QUEUE_TTL_MS, RETRY_CEILING } from "./config";
import {
  dateBucketUtc,
  dropExpiredQueued,
  finalizeItemOutcome,
  isReadyToSend,
  makeQueueItem,
  markSending,
  recoverExpiredLeases,
  sanitizeReport,
  type QueueItem,
  type ResponseClass,
} from "./pure";

function queuedItem(
  id: string,
  enqueuedAt: number,
  dateBucket?: string,
): QueueItem {
  const report = sanitizeReport({
    code: "web.fetch",
    detail: "timeout",
    platform: "android",
    ...(dateBucket ? { dateBucket } : {}),
  });
  if (!report) throw new Error("sanitizeReport rejected a valid report");
  return makeQueueItem(report, 1, 0, id, enqueuedAt);
}

/** One full attempt: the pre-dispatch bump, then the finalizer sees the outcome. */
function attempt(
  item: QueueItem,
  responseClass: ResponseClass,
  nowMs: number,
) {
  const sending = markSending(item, nowMs, 60_000);
  return finalizeItemOutcome({
    item: sending,
    liveGeneration: 1,
    liveTransitionEpoch: 0,
    enabled: true,
    responseClass,
    nowMs,
  });
}

describe("retry ceiling vs offline sends", () => {
  test("20 consecutive no-response failures never dead and never spend the ceiling", () => {
    let item = queuedItem("offline", 1_000_000);
    let firstBackoff = 0;
    let lastBackoff = 0;
    for (let i = 1; i <= 20; i++) {
      const out = attempt(item, "no_response", 1_000_000 + i * 1_000);
      expect(out.action).toBe("requeue");
      expect(out.item?.retryCount).toBe(0);
      expect(out.backoffMs).toBeLessThanOrEqual(BACKOFF_CAP_MS);
      if (i === 1) firstBackoff = out.backoffMs ?? 0;
      lastBackoff = out.backoffMs ?? 0;
      item = out.item!;
    }
    expect(item.retryCount).toBe(0);
    expect(item.noResponseStreak).toBe(20);
    expect(lastBackoff).toBeGreaterThan(firstBackoff);
  });

  test("five server 5xx answers still dead-letter the report", () => {
    let item = queuedItem("server", 1_000_000);
    for (let i = 1; i <= RETRY_CEILING; i++) {
      const out = attempt(item, "requeue", 2_000_000 + i);
      if (i < RETRY_CEILING) {
        expect(out.action).toBe("requeue");
        item = out.item!;
      } else {
        expect(out.action).toBe("dead");
        expect(out.item?.state).toBe("dead");
      }
    }
  });

  test("recovery from a crashed send undoes the pre-dispatch bump", () => {
    const item = markSending(queuedItem("crash", 1_000_000), 1_000, 60_000);
    expect(item.retryCount).toBe(1);
    // lease still valid → untouched
    expect(recoverExpiredLeases([item], 31_000)[0]?.retryCount).toBe(1);
    const recovered = recoverExpiredLeases([item], 61_001);
    expect(recovered[0]?.state).toBe("queued");
    expect(recovered[0]?.retryCount).toBe(0);
  });

  test("a server answer clears the offline streak", () => {
    let item = queuedItem("mixed", 1_000_000);
    item = attempt(item, "no_response", 1_000_000).item!;
    expect(item.noResponseStreak).toBe(1);
    item = attempt(item, "requeue", 3_000_000).item!;
    expect(item.noResponseStreak).toBe(0);
    expect(item.retryCount).toBe(1);
  });
});

describe("queue TTL", () => {
  const nowMs = 1_700_000_000_000;

  test("a queued report unsent past 30 days is dropped, not dead-lettered", () => {
    const old = queuedItem("old", nowMs - QUEUE_TTL_MS - 1);
    const fresh = queuedItem("fresh", nowMs - QUEUE_TTL_MS + 1);
    const kept = dropExpiredQueued([old, fresh], nowMs);
    expect(kept.map((it) => it.id)).toEqual(["fresh"]);
  });

  test("an item mid-send is not TTL-dropped", () => {
    const sending: QueueItem = {
      ...queuedItem("inflight", nowMs - QUEUE_TTL_MS - 1),
      state: "sending",
    };
    expect(dropExpiredQueued([sending], nowMs)).toHaveLength(1);
  });

  test("a legacy item without enqueuedAt expires by the report date bucket", () => {
    const oldLegacy = queuedItem(
      "legacy-old",
      0,
      dateBucketUtc(nowMs - QUEUE_TTL_MS - 2 * 86_400_000),
    );
    delete oldLegacy.enqueuedAt;
    const newLegacy = queuedItem("legacy-new", 0, dateBucketUtc(nowMs));
    delete newLegacy.enqueuedAt;
    expect(dropExpiredQueued([oldLegacy, newLegacy], nowMs)).toEqual([
      newLegacy,
    ]);
  });
});

describe("foreground readiness", () => {
  test("ignores the backoff only for no-response items", () => {
    const future = 5_000_000;
    const offline: QueueItem = {
      ...queuedItem("offline", 1_000_000),
      nextRetryAt: future,
      noResponseStreak: 3,
    };
    expect(isReadyToSend(offline, 0)).toBe(false);
    expect(isReadyToSend(offline, 0, { ignoreNoResponseBackoff: true })).toBe(
      true,
    );

    const serverBackoff: QueueItem = {
      ...queuedItem("server", 1_000_000),
      nextRetryAt: future,
      noResponseStreak: 0,
    };
    expect(
      isReadyToSend(serverBackoff, 0, { ignoreNoResponseBackoff: true }),
    ).toBe(false);

    expect(isReadyToSend(queuedItem("due", 1_000_000), 0)).toBe(true);
    expect(isReadyToSend(queuedItem("not-due", 1_000_000), -1)).toBe(false);
  });
});
