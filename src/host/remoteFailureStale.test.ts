/**
 * The stale-pairing rule for failed remote turns: a failure OLDER than the
 * current pairing's completion belongs to a previous pairing, so restore
 * stamps it past (`failureStale`) and the persistable projection drops that
 * stamp again — the save/load JSON must stay byte-identical or the boot
 * hash deletes a good session. Local failures and newer failures never
 * stamp.
 */
import { toPersistableHistoryMessages } from "../engine/historyPersistable";
import { sanitizeHistoryMessages } from "./historyMessages";

const PAIRING_AT = 1_700_000_100_000;

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
