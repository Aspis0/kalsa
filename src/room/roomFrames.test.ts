/**
 * The stream's own moves, folded: a rename recolors the rows already held,
 * a member leaving is marked on their words, a refetch resolves what the
 * client slept through, a turn's note and its assembly follow the frames, a
 * resync drops the floor, and the endings — removed, a cut wire, a door
 * that cannot be dialed, a terminal stop — read as the screen's states.
 */
import infoFixture from "./fixtures/info.json";
import { emptyRoomFeed, foldInfo, foldResync, type RoomFeed } from "./roomFeed";
import { foldEvent } from "./roomFrames";
import { parseRoomInfo, type RoomHistoryMessage, type RoomInfo } from "./roomWire";

const INFO: RoomInfo = parseRoomInfo(infoFixture) as RoomInfo;

function entry(seq: number, epoch = INFO.epoch): RoomHistoryMessage {
  return {
    seq,
    epoch,
    memberId: 3,
    name: "Marco",
    time: 1_791_000_000 + seq,
    text: `m${seq}`,
    callAi: false,
    former: false,
  };
}

function feed(): RoomFeed {
  return foldInfo(emptyRoomFeed(), INFO);
}

function withHistory(seqs: number[]): RoomFeed {
  return foldEvent(feed(), {
    type: "resynced",
    info: INFO,
    history: {
      messages: seqs.map((seq) => entry(seq)),
      hasOlder: false,
      hasNewer: false,
    },
  });
}

describe("member news", () => {
  test("live entries resolve the host against the room member list", () => {
    const state = foldEvent(feed(), {
      type: "message",
      entry: {
        ...entry(4),
        memberId: 4294967295,
        name: "Former member",
        former: true,
        text: "che bello",
      },
    });
    expect(state.entries.map(({ name, former }) => [name, former])).toEqual([
      ["This computer", false],
    ]);
  });

  test("live entries resolve a member that joined after the opening snapshot", () => {
    const joined = foldEvent(feed(), {
      type: "member",
      member: { action: "joined", memberId: 9, name: "Paired phone 3" },
    });
    const state = foldEvent(joined, {
      type: "message",
      entry: { ...entry(4), memberId: 9, name: "Old device name", former: true },
    });
    expect(state.entries.map(({ name, former }) => [name, former])).toEqual([
      ["Paired phone 3", false],
    ]);
  });

  test("a live author absent from a stale member list keeps the server's current status", () => {
    const state = foldEvent(feed(), {
      type: "message",
      entry: { ...entry(4), memberId: 12, name: "New member", former: false },
    });
    expect(state.entries.map(({ name, former }) => [name, former])).toEqual([
      ["New member", false],
    ]);
  });

  test("a rename follows the member list and every row already held", () => {
    const state = foldEvent(withHistory([1, 2]), {
      type: "member",
      member: { action: "renamed", memberId: 3, name: "Marco Rossi" },
    });
    expect(state.info?.members.find((member) => member.memberId === 3)?.name).toBe("Marco Rossi");
    expect(state.entries.map((held) => held.name)).toEqual(["Marco Rossi", "Marco Rossi"]);
  });

  test("a join adds a phone, a leave takes the member out", () => {
    const joined = foldEvent(feed(), {
      type: "member",
      member: { action: "joined", memberId: 9, name: "Paired phone 3" },
    });
    expect(joined.info?.members.map((member) => member.memberId)).toContain(9);
    expect(joined.info?.members.find((member) => member.memberId === 9)?.kind).toBe("phone");
    const left = foldEvent(joined, {
      type: "member",
      member: { action: "left", memberId: 9, name: "Paired phone 3" },
    });
    expect(left.info?.members.some((member) => member.memberId === 9)).toBe(false);
  });

  test("a member who left keeps their words, marked as a former member", () => {
    const state = foldEvent(withHistory([1, 2]), {
      type: "member",
      member: { action: "left", memberId: 3, name: "Marco" },
    });
    expect(state.entries.map((held) => [held.name, held.former])).toEqual([
      ["Marco", true],
      ["Marco", true],
    ]);
  });

  test("the reconnect's own info resolves the rows it slept through", () => {
    const renamed = foldEvent(withHistory([1, 2]), {
      type: "refetched",
      info: {
        ...INFO,
        members: INFO.members.map((member) =>
          member.memberId === 3 ? { ...member, name: "Marco Rossi" } : member,
        ),
      },
    });
    expect(renamed.entries.map((held) => held.name)).toEqual(["Marco Rossi", "Marco Rossi"]);

    const gone = foldEvent(withHistory([1, 2]), {
      type: "refetched",
      info: { ...INFO, members: INFO.members.filter((member) => member.memberId !== 3) },
    });
    expect(gone.entries.every((held) => held.former)).toBe(true);
  });
});

describe("the AI's turn", () => {
  test("ai_status moves the turn view and leaves a note the idle frame keeps", () => {
    const busy = foldEvent(feed(), {
      type: "ai_status",
      status: { state: "thinking", who: "Marco", running: "Marco", queue: [], youPending: true },
    });
    expect(busy.info?.ai).toEqual({ busy: false, running: "Marco", queue: [], youPending: true });
    const refused = foldEvent(busy, {
      type: "ai_status",
      status: {
        state: "refused",
        who: "Marco",
        running: null,
        queue: [],
        youPending: false,
        noteCode: "busy_waiting",
      },
    });
    expect(refused.noteCode).toBe("busy_waiting");
    // The opening snapshot of the next stream is idle and carries no note:
    // the sentence the refusal left is what there is to read.
    const idle = foldEvent(refused, {
      type: "ai_status",
      status: { state: "idle", who: null, running: null, queue: [], noteCode: null },
    });
    expect(idle.noteCode).toBe("busy_waiting");
  });

  test("deltas assemble, the final message replaces them, a stopped turn drops them", () => {
    const delta = (text: string) =>
      foldEvent(feed(), { type: "ai_delta", delta: { text }, assembled: text });
    expect(delta("It is ").live).toBe("It is ");
    const final = foldEvent(delta("It is "), {
      type: "ai_message",
      entry: { ...entry(5), memberId: 4294967294, name: "Kalsa", text: "It is 17:00." },
    });
    expect(final.live).toBeNull();
    expect(final.entries.map((held) => held.text)).toEqual(["It is 17:00."]);
    const stopped = foldEvent(delta("half an ans"), {
      type: "ai_status",
      status: { state: "stopped", who: "Marco", running: null, queue: [] },
    });
    expect(stopped.live).toBeNull();
  });
});

describe("the endings", () => {
  test("a resync replaces the floor and forgets the acks built on the old one", () => {
    const acked = foldEvent(withHistory([1, 2]), { type: "disconnected" });
    const state = foldResync(acked, INFO, {
      messages: [entry(9, "e-new")],
      hasOlder: false,
      hasNewer: false,
    });
    expect(state.entries.map((held) => held.seq)).toEqual([9]);
    expect(state.sent).toEqual([]);
    expect(state.live).toBeNull();
  });

  test("an empty same-epoch resync keeps the last visible transcript", () => {
    const prior = withHistory([1, 2]);
    const state = foldResync(prior, INFO, {
      messages: [],
      hasOlder: false,
      hasNewer: false,
    });
    expect(state.entries.map((held) => held.seq)).toEqual([1, 2]);
  });

  test("an empty new-epoch resync replaces the old transcript", () => {
    const prior = withHistory([1, 2]);
    const state = foldResync(prior, { ...INFO, epoch: "e-new" }, {
      messages: [],
      hasOlder: false,
      hasNewer: false,
    });
    expect(state.epoch).toBe("e-new");
    expect(state.entries).toEqual([]);
  });

  test("a cut wire is a reconnect, and the next frame ends it", () => {
    const cut = foldEvent(feed(), { type: "disconnected" });
    expect(cut.reconnecting).toBe(true);
    const back = foldEvent(cut, {
      type: "member",
      member: { action: "joined", memberId: 9, name: "Paired phone 3" },
    });
    expect(back.reconnecting).toBe(false);
  });

  test("a door that cannot be dialed says why and keeps trying", () => {
    const state = foldEvent(feed(), { type: "door_unusable", message: "no road" });
    expect(state.reconnecting).toBe(true);
    expect(state.error).toEqual({ code: "door_unusable", message: "no road" });
    expect(state.status).toBe("ready");
    const healed = foldEvent(state, {
      type: "ai_status",
      status: { state: "idle", who: null, running: null, queue: [] },
    });
    expect(healed.error).toBeNull();
  });

  test("a terminal stop is an error state, 401 is the removed state", () => {
    const stopped = foldEvent(feed(), {
      type: "error",
      code: "resync_failed",
      message: "three attempts",
    });
    expect(stopped.status).toBe("error");
    expect(stopped.error?.message).toBe("three attempts");
    const removed = foldEvent(feed(), { type: "removed" });
    expect(removed.status).toBe("removed");
  });
});
