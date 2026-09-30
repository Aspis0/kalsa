/**
 * The dispatch layer alone: frames in, typed events out — the seq
 * dedupe within an epoch, the epoch verdict, and the ai_delta assembly
 * (per turn, replaced by ai_message's final text, discarded on demand —
 * a reconnect calls discard so a partial never outlives its wire).
 * Raw frames are built the way stream.rs writes them: number/id line
 * for transcript entries (stream.rs:316-324), bare event/data for the
 * rest (stream.rs:297-306).
 */
import { noteRoomEpoch, resetRoomEpochs } from "./roomEpochs";
import { createSseParser } from "./sseParser";
import { createRoomFrameDispatch, type FrameVerdict } from "./roomStreamDispatch";

const LOCAL_ID = "p-lid-dispatch";
const EPOCH = "e-dispatch-1";

function frame(text: string) {
  const messages = createSseParser().push(text);
  expect(messages).toHaveLength(1);
  return messages[0];
}

function entryData(seq: number, epoch = EPOCH): string {
  return JSON.stringify({
    seq,
    epoch,
    member_id: 3,
    name: "Marco",
    time: 1791000000 + seq,
    text: `m${seq}`,
    call_ai: false,
  });
}

function delta(turn: number | undefined, text: string): string {
  return JSON.stringify(turn === undefined ? { text } : { turn, text });
}

function eventOf(verdict: FrameVerdict): Record<string, unknown> {
  expect(verdict.kind).toBe("event");
  return (verdict as Extract<FrameVerdict, { kind: "event" }>).event as Record<string, unknown>;
}

beforeEach(() => {
  resetRoomEpochs();
});

test("seqs deliver at most once and in order within the epoch; the floor is the resume", () => {
  const dispatch = createRoomFrameDispatch(LOCAL_ID);

  expect(dispatch.dispatch(frame(`id: 41\nevent: message\ndata: ${entryData(41)}\n\n`)).kind).toBe("event");
  // Older or equal seqs are replay duplicates: skipped, never re-delivered.
  expect(dispatch.dispatch(frame(`id: 41\nevent: message\ndata: ${entryData(41)}\n\n`)).kind).toBe("skip");
  expect(dispatch.dispatch(frame(`id: 40\nevent: message\ndata: ${entryData(40)}\n\n`)).kind).toBe("skip");
  expect(dispatch.resumeFrom()).toBe(41);

  dispatch.setFloor([{ seq: 90 } as never]);
  expect(dispatch.resumeFrom()).toBe(90);
  expect(dispatch.dispatch(frame(`id: 90\nevent: message\ndata: ${entryData(90)}\n\n`)).kind).toBe("skip");
  expect(dispatch.dispatch(frame(`id: 91\nevent: message\ndata: ${entryData(91)}\n\n`)).kind).toBe("event");
});

test("an entry from another epoch is the verdict that died, and an unknown frame is outgrown", () => {
  noteRoomEpoch(LOCAL_ID, EPOCH);
  const dispatch = createRoomFrameDispatch(LOCAL_ID);

  expect(dispatch.dispatch(frame(`id: 1\nevent: message\ndata: ${entryData(1, "e-other")}\n\n`)).kind).toBe(
    "epoch_died",
  );
  expect(dispatch.dispatch(frame(`event: typing\ndata: {}\n\n`)).kind).toBe("skip");
  expect(dispatch.dispatch(frame(`event: member\ndata: {"action":"joined","member_id":5,"name":"Paired phone 3"}\n\n`)).kind).toBe(
    "event",
  );
});

test("deltas assemble per turn and ride every chunk; a new turn starts fresh", () => {
  const dispatch = createRoomFrameDispatch(LOCAL_ID);

  expect(eventOf(dispatch.dispatch(frame(`event: ai_delta\ndata: ${delta(7, "Hello")}\n\n`)))).toEqual({
    type: "ai_delta",
    delta: { turn: 7, text: "Hello" },
    assembled: "Hello",
  });
  expect(
    eventOf(dispatch.dispatch(frame(`event: ai_delta\ndata: ${delta(7, " world")}\n\n`))),
  ).toMatchObject({ assembled: "Hello world" });

  // The running turn changed: the other turn's text is not this one's.
  expect(
    eventOf(dispatch.dispatch(frame(`event: ai_delta\ndata: ${delta(8, "Fresh")}\n\n`))),
  ).toMatchObject({ assembled: "Fresh" });
});

test("ai_message's final text replaces the assembly", () => {
  const dispatch = createRoomFrameDispatch(LOCAL_ID);
  dispatch.dispatch(frame(`event: ai_delta\ndata: ${delta(9, "partial")}\n\n`));

  const final = eventOf(
    dispatch.dispatch(frame(`id: 10\nevent: ai_message\ndata: ${entryData(10)}\n\n`)),
  );
  expect(final).toMatchObject({ type: "ai_message" });

  // Nothing of the partial survives it — even a same-id chunk starts over.
  expect(eventOf(dispatch.dispatch(frame(`event: ai_delta\ndata: ${delta(9, "next")}\n\n`)))).toMatchObject({
    assembled: "next",
  });
});

test("discardAssembly drops the partial — what a reconnect does with it", () => {
  const dispatch = createRoomFrameDispatch(LOCAL_ID);
  dispatch.dispatch(frame(`event: ai_delta\ndata: ${delta(3, "half")}\n\n`));

  dispatch.discardAssembly();

  expect(eventOf(dispatch.dispatch(frame(`event: ai_delta\ndata: ${delta(3, "resume")}\n\n`)))).toMatchObject({
    assembled: "resume",
  });
});
