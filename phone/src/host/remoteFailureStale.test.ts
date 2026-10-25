/**
 * The stale-pairing rule for failed remote turns: a failure OLDER than the
 * current pairing's completion belongs to a previous pairing, so restore
 * stamps it past (`failureStale`) and the persistable projection drops that
 * stamp again — the save/load JSON must stay byte-identical or the boot
 * hash deletes a good session. Local failures and newer failures never
 * stamp.
 */
import { toPersistableHistoryMessages } from "../engine/historyPersistable";
import { markStaleRemoteFailures, sanitizeHistoryMessages } from "./historyMessages";

const PAIRING_AT = 1_700_000_100_000;

/** A minimal assistant message at `createdAt`, for the live-rule cases. */
function baseMessage(createdAt: number) {
  return {
    id: `m-${createdAt}`,
    role: "assistant" as const,
    text: "⚠️ Could not reach your computer.",
    createdAt,
  };
}

function failedRemoteRecord(createdAt: number, reason = "Could not reach your computer."): Record<string, unknown> {
  return {
    id: "a1",
    role: "assistant",
    text: "Could not reach your computer.",
    createdAt,
    failed: true,
    failureSource: "remote",
    failureReason: reason,
  };
}

describe("stale-pairing stamping at restore", () => {
  test("a remote failure older than the stamp is marked stale", () => {
    const [message] = sanitizeHistoryMessages(
      [failedRemoteRecord(PAIRING_AT - 1)],
      "en",
      { remoteStaleBefore: PAIRING_AT },
    );
    expect(message.failed).toBe(true);
    expect(message.failureSource).toBe("remote");
    expect(message.failureStale).toBe(true);
  });

  test("a remote failure newer than the stamp is current", () => {
    const [message] = sanitizeHistoryMessages(
      [failedRemoteRecord(PAIRING_AT + 1)],
      "en",
      { remoteStaleBefore: PAIRING_AT },
    );
    expect(message.failureStale).toBeUndefined();
  });

  test("no stamp (no pairing completed, or unreadable) stamps nothing", () => {
    const [noStamp] = sanitizeHistoryMessages(
      [failedRemoteRecord(PAIRING_AT - 1)],
      "en",
      { remoteStaleBefore: null },
    );
    expect(noStamp.failureStale).toBeUndefined();
    const [noArg] = sanitizeHistoryMessages([failedRemoteRecord(PAIRING_AT - 1)], "en");
    expect(noArg.failureStale).toBeUndefined();
  });

  test("a local failure is never stale — re-pairing says nothing about the phone", () => {
    const [message] = sanitizeHistoryMessages(
      [
        {
          id: "a2",
          role: "assistant",
          text: "The model crashed.",
          createdAt: PAIRING_AT - 1,
          failed: true,
          failureReason: "Model unloaded",
        },
      ],
      "en",
      { remoteStaleBefore: PAIRING_AT },
    );
    expect(message.failureStale).toBeUndefined();
  });

  test("the source mark needs the failed row: a corrupt source alone restores nothing", () => {
    const [message] = sanitizeHistoryMessages(
      [
        {
          id: "a3",
          role: "assistant",
          text: "some answer",
          createdAt: 1,
          failureSource: "remote",
        },
      ],
      "en",
      { remoteStaleBefore: PAIRING_AT },
    );
    expect(message.failureSource).toBeUndefined();
    expect(message.failureStale).toBeUndefined();
  });
});

describe("markStaleRemoteFailures — the live rule", () => {
  test("marks only old remote failures; keeps the reference when nothing changes", () => {
    const oldRemote = {
      ...baseMessage(PAIRING_AT - 1),
      failed: true,
      failureSource: "remote" as const,
    };
    const newRemote = {
      ...baseMessage(PAIRING_AT + 1),
      failed: true,
      failureSource: "remote" as const,
    };
    const oldLocal = {
      ...baseMessage(PAIRING_AT - 1),
      failed: true,
      failureReason: "local decode crash",
    };
    const messages = [oldRemote, newRemote, oldLocal];
    const next = markStaleRemoteFailures(messages, PAIRING_AT);
    expect(next[0].failureStale).toBe(true);
    expect(next[1].failureStale).toBeUndefined();
    expect(next[2].failureStale).toBeUndefined();
    // Already-marked stays marked, and a clean list returns the SAME array:
    // a completion event on an unaffected conversation is a no-op render.
    expect(markStaleRemoteFailures(next, PAIRING_AT)).toBe(next);
    expect(markStaleRemoteFailures([newRemote], PAIRING_AT)).toBeInstanceOf(Array);
    expect(markStaleRemoteFailures([newRemote], PAIRING_AT)[0]).toBe(newRemote);
  });

  test("no stamp (null, undefined, NaN) marks nothing", () => {
    const old = {
      ...baseMessage(PAIRING_AT - 1),
      failed: true,
      failureSource: "remote" as const,
    };
    for (const stamp of [null, undefined, Number.NaN]) {
      const marked = markStaleRemoteFailures([old], stamp);
      expect(marked).toBeInstanceOf(Array);
      expect(marked[0].failureStale).toBeUndefined();
    }
  });
});

describe("the stamp is volatile in the persistable projection", () => {
  test("failureStale never reaches the JSON; failureSource does", () => {
    const [restored] = sanitizeHistoryMessages(
      [failedRemoteRecord(PAIRING_AT - 1)],
      "en",
      { remoteStaleBefore: PAIRING_AT },
    );
    const persistable = toPersistableHistoryMessages([restored]) as Array<
      Record<string, unknown>
    >;
    expect("failureStale" in persistable[0]).toBe(false);
    expect(persistable[0].failureSource).toBe("remote");
  });

  test("the stamp leaves the persistable shape identical — the boot hash cannot tell", () => {
    const stored = [failedRemoteRecord(PAIRING_AT - 1)];
    // Both sides of the boot comparison run through sanitize: the stamped
    // load and an unstamped one must write the exact same JSON.
    const stamped = toPersistableHistoryMessages(
      sanitizeHistoryMessages(stored, "en", { remoteStaleBefore: PAIRING_AT }),
    );
    const unstamped = toPersistableHistoryMessages(sanitizeHistoryMessages(stored, "en"));
    expect(JSON.stringify(stamped)).toBe(JSON.stringify(unstamped));
  });
});
