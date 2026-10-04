/**
 * The feed's own rules, away from the wire: a page merges by seq without
 * moving a row, a live entry is never a second copy, an acked post shows
 * once (its row built from the ack, because the stream's copy was skipped)
 * and gives way to the room's own entry for that seq, an ack's refused call
 * is carried, the shelf folds to the waiting list, the window keeps what
 * the reader paged in, and a read that lost the race — a 401, or an older
 * epoch — changes nothing.
 */
import infoFixture from "./fixtures/info.json";
import {
  emptyRoomFeed,
  failRoom,
  foldHistory,
  foldInfo,
  foldQueue,
  foldQueueSent,
  foldResync,
  roomRows,
  type RoomFeed,
} from "./roomFeed";
import { parseRoomInfo, type RoomHistoryMessage, type RoomInfo } from "./roomWire";

const INFO: RoomInfo = parseRoomInfo(infoFixture) as RoomInfo;
const YOU = INFO.you;
const AI = 4294967294;

function entry(
  seq: number,
  text = `m${seq}`,
  memberId = 3,
  name = "Marco",
  epoch = INFO.epoch,
): RoomHistoryMessage {
  return {
    seq,
    epoch,
    memberId,
    name,
    time: 1_791_000_000 + seq,
    text,
    callAi: false,
    former: false,
  };
}

function feed(): RoomFeed {
  return foldInfo(emptyRoomFeed(), INFO);
}

/** One page's worth of the room's entries, `high` down to `low` — the
 *  page that sits immediately older than `high + 1`. */
function pageDown(high: number, low: number): RoomHistoryMessage[] {
  const messages: RoomHistoryMessage[] = [];
  for (let seq = high; seq >= low; seq -= 1) messages.push(entry(seq));
  return messages;
}

describe("history pages", () => {
  test("merge by seq: an overlap is one row and the later page fills the rest", () => {
    const first = foldHistory(feed(), {
      messages: [entry(1), entry(2)],
      hasOlder: false,
      hasNewer: true,
    });
    const second = foldHistory(first, {
      messages: [entry(2), entry(3)],
      hasOlder: true,
      hasNewer: false,
    });
    expect(second.entries.map((held) => held.seq)).toEqual([1, 2, 3]);
    expect(second.entries[1].text).toBe("m2");
  });

  test("a page never rewrites a row already held", () => {
    const streamed = foldHistory(feed(), {
      messages: [entry(7, "as it arrived")],
      hasOlder: false,
      hasNewer: false,
    });
    const renamed = foldHistory(streamed, {
      messages: [entry(7, "as the room reads it now")],
      hasOlder: false,
      hasNewer: false,
    });
    expect(renamed.entries.map((held) => held.text)).toEqual(["as it arrived"]);
  });

});

describe("an acked post", () => {
  const post = {
    clientMsgId: "a".repeat(32),
    text: "dinner at eight?",
    callAi: false,
    createdAt: 1,
    state: "sent" as const,
    seq: 42,
    time: 1_791_000_042,
    refusal: null,
  };

  test("becomes a row of its own, then gives way to the room's entry for that seq", () => {
    const acked = foldQueueSent(feed(), post);
    expect(roomRows(acked).map((row) => [row.seq, row.text, row.own])).toEqual([
      [42, "dinner at eight?", true],
    ]);

    const landed = foldHistory(acked, {
      messages: [entry(42, "dinner at eight?")],
      hasOlder: false,
      hasNewer: false,
    });
    expect(landed.sent).toEqual([]);
    expect(roomRows(landed)).toHaveLength(1);
    // The room's copy is the row now: its name is the resolved one.
    expect(roomRows(landed)[0].name).toBe("Marco");
  });

  test("a call the room refused is carried, and the next post clears it", () => {
    const refused = foldQueueSent(feed(), { ...post, refusal: "already_pending" });
    expect(refused.callRefusalCode).toBe("already_pending");
    const accepted = foldQueueSent(refused, {
      ...post,
      clientMsgId: "b".repeat(32),
      seq: 43,
      refusal: null,
    });
    expect(accepted.callRefusalCode).toBeNull();
  });

  test("the same ack twice, or its entry first, is never a second row", () => {
    const twice = foldQueueSent(foldQueueSent(feed(), post), post);
    expect(twice.sent).toHaveLength(1);
    const entryFirst = foldQueueSent(
      foldHistory(feed(), { messages: [entry(42)], hasOlder: false, hasNewer: false }),
      post,
    );
    expect(roomRows(entryFirst)).toHaveLength(1);
  });
});

describe("the paged window", () => {
  test("hasOlder follows the page, and a page of the room's oldest words ends it", () => {
    const newest = foldHistory(feed(), {
      messages: [entry(11), entry(12)],
      hasOlder: true,
      hasNewer: false,
    });
    expect(newest.hasOlder).toBe(true);
    const floor = foldHistory(newest, {
      messages: [entry(9), entry(10)],
      hasOlder: false,
      hasNewer: true,
    });
    expect(floor.hasOlder).toBe(false);
    expect(floor.entries.map((held) => held.seq)).toEqual([9, 10, 11, 12]);
  });

  test("five pages the reader asked for are kept; older words falling off say so", () => {
    let state = foldHistory(feed(), {
      messages: pageDown(1200, 1001),
      hasOlder: true,
      hasNewer: false,
    });
    for (let round = 5; round > 0; round -= 1) {
      const top = round * 200;
      state = foldHistory(state, {
        messages: pageDown(top, top - 199),
        hasOlder: round > 1,
        hasNewer: true,
      });
    }
    expect(state.entries).toHaveLength(1000);
    expect(state.entries[0].seq).toBe(201);
    expect(state.entries[999].seq).toBe(1200);
    // What the bound dropped is still the room's: the reader may ask again.
    expect(state.hasOlder).toBe(true);

    // Re-asking for a page already held adds no row.
    const again = foldHistory(state, {
      messages: pageDown(1000, 801),
      hasOlder: true,
      hasNewer: true,
    });
    expect(again.entries).toHaveLength(1000);
  });
});

describe("a read that lost the race", () => {
  test("a 401 that already arrived cannot be taken back by a slower answer", () => {
    const removed = failRoom(feed(), { code: "removed", message: "This phone is gone." });
    expect(foldInfo(removed, INFO)).toBe(removed);
    expect(
      foldHistory(removed, { messages: [entry(1)], hasOlder: false, hasNewer: false }),
    ).toBe(removed);
    expect(failRoom(removed, { code: "unreachable", message: "network" })).toBe(removed);
  });

  test("a page of an older epoch cannot merge over the floor a resync set", () => {
    const resynced = foldResync(feed(), INFO, {
      messages: [entry(9)],
      hasOlder: false,
      hasNewer: false,
    });
    const stale = foldHistory(resynced, {
      messages: [entry(3, "old words", 3, "Marco", "e-old")],
      hasOlder: false,
      hasNewer: true,
    });
    expect(stale.entries.map((held) => held.seq)).toEqual([9]);
    const olderInfo = { ...INFO, epoch: "e-old" };
    expect(foldInfo(resynced, olderInfo)).toBe(resynced);
  });
});

describe("room rows", () => {
  test("name the writer, the reader's own words and Kalsa", () => {
    const state = foldHistory(feed(), {
      messages: [entry(1, "hi", YOU, "Paired phone 2"), entry(2, "hello", AI, "Kalsa")],
      hasOlder: false,
      hasNewer: false,
    });
    const rows = roomRows(state);
    expect(rows.map((row) => [row.own, row.kalsa])).toEqual([
      [true, false],
      [false, true],
    ]);
  });

  test("without info nobody is claimed as the reader", () => {
    const state = foldHistory(emptyRoomFeed(), {
      messages: [entry(1, "hi", YOU, "Paired phone 2")],
      hasOlder: false,
      hasNewer: false,
    });
    expect(roomRows(state)[0].own).toBe(false);
  });
});

describe("the shelf", () => {
  test("folds to the waiting list with the door's last word on each item", () => {
    const state = foldQueue(feed(), [
      {
        clientMsgId: "b".repeat(32),
        text: "waiting",
        callAi: true,
        createdAt: 1,
        state: "queued",
        error: { code: "read_only", message: "later" },
      },
      {
        clientMsgId: "c".repeat(32),
        text: "failed",
        callAi: false,
        createdAt: 2,
        state: "failed",
        error: { code: "too_large", message: "no" },
      },
    ]);
    expect(state.queue).toEqual([
      {
        clientMsgId: "b".repeat(32),
        text: "waiting",
        callAi: true,
        state: "queued",
        errorCode: "read_only",
      },
      {
        clientMsgId: "c".repeat(32),
        text: "failed",
        callAi: false,
        state: "failed",
        errorCode: "too_large",
      },
    ]);
  });
});
