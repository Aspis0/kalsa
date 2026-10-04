/**
 * The transcript's own rules: a page merges by seq without moving a row,
 * a live entry is never a second copy, an acked post shows once (its row
 * built from the ack, because the stream's copy was skipped) and gives way
 * to the room's own entry for that seq, and the window stays capped.
 */
import infoFixture from "./fixtures/info.json";
import {
  emptyRoomFeed,
  foldHistory,
  foldInfo,
  foldQueueSent,
  roomRows,
  type RoomFeed,
} from "./roomFeed";
import { parseRoomInfo, type RoomHistoryMessage, type RoomInfo } from "./roomWire";

const INFO: RoomInfo = parseRoomInfo(infoFixture) as RoomInfo;
const YOU = INFO.you;
const AI = 4294967294;

function entry(seq: number, text = `m${seq}`, memberId = 3, name = "Marco"): RoomHistoryMessage {
  return {
    seq,
    epoch: INFO.epoch,
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

  test("keeps the newest 200 of an unbounded transcript", () => {
    let state = feed();
    for (let seq = 1; seq <= 260; seq += 1) {
      state = foldHistory(state, { messages: [entry(seq)], hasOlder: true, hasNewer: false });
    }
    expect(state.entries).toHaveLength(200);
    expect(state.entries[0].seq).toBe(61);
    expect(state.entries[199].seq).toBe(260);
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
