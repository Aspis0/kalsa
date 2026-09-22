import type {
  HistoryWriteGuard,
  HistoryWriteTicket,
} from "../chat/historyWriteGuard";
import {
  createHistoryWriter,
  type HistoryWriter,
  type HistoryWriterDeps,
} from "./historyWrite";

type Msg = { id: string };

const KEY = "kalsa.messages.conv-test";

function msgs(...ids: string[]): Msg[] {
  return ids.map((id) => ({ id }));
}

interface Harness {
  writer: HistoryWriter<Msg>;
  project: jest.Mock;
  order: string[];
  written: string[];
  guardLists: readonly Msg[][];
  allowGuard(allow: boolean): void;
  refused: number[];
}

function makeHarness(): Harness {
  const order: string[] = [];
  const written: string[] = [];
  const guardLists: Msg[][] = [];
  const refused: number[] = [];
  let guardAllows = true;
  let writer: HistoryWriter<Msg>;

  const guard = {
    tryPersist(list: readonly unknown[], persist: (json: string) => Promise<void>) {
      guardLists.push(list as Msg[]);
      if (!guardAllows) return { issued: false as const };
      // Mirrors the real guard: landed resolves true on KV success, false on rejection.
      return {
        issued: true as const,
        landed: persist(JSON.stringify(list)).then(
          () => true,
          () => false,
        ),
      };
    },
  } as unknown as HistoryWriteGuard;

  const project = jest.fn((snapshot: readonly Msg[]) => snapshot.slice());
  const deps: HistoryWriterDeps<Msg> = {
    guard,
    project,
    write: async (_key, json) => {
      order.push(`write@${writer.epoch()}`);
      written.push(json);
    },
    onRefused: (count) => refused.push(count),
  };
  writer = createHistoryWriter(deps);
  writer.bindKey(KEY);
  return {
    writer,
    project,
    order,
    written,
    guardLists,
    refused,
    allowGuard: (allow) => {
      guardAllows = allow;
    },
  };
}

describe("historyWrite — epoch ordering", () => {
  it("never builds the projection when a clear already advanced the epoch (prevents: payload built from the cleared-away snapshot)", () => {
    const h = makeHarness();
    const stamp = h.writer.epoch();
    h.writer.bumpEpoch();

    const ticket = h.writer.persist(msgs("a", "b"), { epoch: stamp });

    expect(ticket).toBeNull();
    expect(h.project).not.toHaveBeenCalled();
    expect(h.guardLists).toHaveLength(0);
    expect(h.written).toHaveLength(0);
  });

  it("re-checks the epoch after the build so a clear racing the projection never writes (prevents: post-clear write resurrecting wiped messages)", () => {
    const h = makeHarness();
    h.project.mockImplementation(() => {
      // A clear lands while the projection is being built.
      h.writer.bumpEpoch();
      return msgs("a", "b");
    });

    const ticket = h.writer.persist(msgs("a", "b"));

    expect(ticket).toBeNull();
    expect(h.project).toHaveBeenCalledTimes(1);
    expect(h.guardLists).toHaveLength(0);
    expect(h.written).toHaveLength(0);
  });

  it("flushes the old thread's final write BEFORE bumping on clear (prevents: clear dropping the last un-debounced write)", () => {
    const h = makeHarness();

    h.writer.flushThenBump(msgs("a", "b"));

    // Reversed order would stamp the write pre-bump and the entry check
    // would drop it: no write, or a write observed at epoch 1.
    expect(h.order).toEqual(["write@0"]);
    expect(h.written).toHaveLength(1);
    expect(h.writer.epoch()).toBe(1);
  });

  it("bumps the epoch BEFORE the conversation's key is deleted (prevents: a pending write resurrecting the deleted key)", async () => {
    const h = makeHarness();
    const observed: string[] = [];

    await h.writer.bumpThenDeleteKey(async () => {
      observed.push(`delete@${h.writer.epoch()}`);
    });

    expect(observed).toEqual(["delete@1"]);
    expect(h.writer.epoch()).toBe(1);
  });

  it("drops a write stamped before the delete (prevents: in-flight schedule landing after the key is gone)", () => {
    const h = makeHarness();
    const stamp = h.writer.epoch();
    void h.writer.bumpThenDeleteKey(async () => undefined);

    const ticket = h.writer.persist(msgs("a"), { epoch: stamp });

    expect(ticket).toBeNull();
    expect(h.written).toHaveLength(0);
  });
});

describe("historyWrite — guard refusal", () => {
  it("a refusal writes nothing and never retries with a shrunken list (prevents: guard refusal causing stored-history shrink)", () => {
    const h = makeHarness();
    h.allowGuard(false);

    const ticket = h.writer.persist(msgs("a", "b"));

    expect(ticket).toBeNull();
    expect(h.written).toHaveLength(0);
    // Exactly ONE guard consultation with the full projection: a shrunken
    // retry would show up as a second entry.
    expect(h.guardLists).toHaveLength(1);
    expect(h.guardLists[0].map((m) => m.id)).toEqual(["a", "b"]);
    expect(h.refused).toEqual([2]);

    // Recovery after the gate reopens is a full rewrite, not a smaller one.
    h.allowGuard(true);
    expect(h.writer.persist(msgs("a", "b"))).not.toBeNull();
    expect(JSON.parse(h.written[0]).map((m: Msg) => m.id)).toEqual(["a", "b"]);
  });

  it("an empty snapshot, empty projection or unbound key writes nothing (prevents: blank or keyless KV churn)", () => {
    const h = makeHarness();
    expect(h.writer.persist([])).toBeNull();

    h.project.mockReturnValue([]);
    expect(h.writer.persist(msgs("a"))).toBeNull();
    expect(h.guardLists).toHaveLength(0);

    h.writer.bindKey("");
    h.project.mockReturnValue(msgs("a"));
    expect(h.writer.persist(msgs("a"))).toBeNull();
    expect(h.written).toHaveLength(0);
  });

  it("returns the guard's issued ticket so callers can key work off landing", async () => {
    const h = makeHarness();
    const ticket: HistoryWriteTicket | null = h.writer.persist(msgs("a"));
    expect(ticket).not.toBeNull();
    expect(ticket?.issued).toBe(true);
    await expect(ticket?.issued && ticket.landed).resolves.toBe(true);
    expect(h.written).toHaveLength(1);
  });
});
