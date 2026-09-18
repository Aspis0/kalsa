import {
  createHistoryWriteGuard,
  deleteConversationHistory,
  quarantineKeyFor,
  type HistoryKv,
} from "./historyWriteGuard";

const KEY = "kalsa.messages.testconv";
const QUARANTINE_KEY = quarantineKeyFor(KEY);

/** 17-entry history in the persisted shape (id/role/text per message). */
function rawHistory(count: number, idPrefix = "m"): string {
  return JSON.stringify(
    Array.from({ length: count }, (_, i) => ({
      id: `${idPrefix}${i}`,
      role: i % 2 === 0 ? "user" : "assistant",
      text: `text ${i}`,
    })),
  );
}
const raw17 = rawHistory(17);

/** Map-backed fake KV standing in for AsyncStorage in these tests. */
function fakeKv(seed?: Record<string, string>) {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  const kv: HistoryKv = {
    async getItem(key) {
      return map.has(key) ? (map.get(key) as string) : null;
    },
    async setItem(key, value) {
      map.set(key, value);
    },
  };
  return { kv, map };
}

/** Fake KV whose quarantine write hangs until released (tests the in-flight window). */
function deferredQuarantineKv(seed?: Record<string, string>) {
  const base = fakeKv(seed);
  let release: (() => void) | null = null;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const kv: HistoryKv = {
    getItem: base.kv.getItem,
    async setItem(key, value) {
      if (key === QUARANTINE_KEY) await pending;
      return base.kv.setItem(key, value);
    },
  };
  return { ...base, kv, releaseCopy: () => release?.() };
}

/** Fake KV whose writes all reject. */
function rejectingKv() {
  return {
    async getItem(): Promise<string | null> {
      return null;
    },
    async setItem(): Promise<void> {
      throw new Error("quota");
    },
  };
}

/** Yield a macrotask so chained promise handlers have settled. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function messages(ids: string[]): { id: string; role: string; text: string }[] {
  return ids.map((id) => ({ id, role: "user", text: `text for ${id}` }));
}

async function loadFaithful17() {
  const { kv, map } = fakeKv({ [KEY]: raw17 });
  const guard = createHistoryWriteGuard(kv);
  const outcome = await guard.onHistoryLoaded(raw17, KEY, (e) => e);
  return { guard, map, outcome };
}

describe("historyWriteGuard", () => {
  test("2-over-17: a write missing known ids without a declaration is refused", async () => {
    const { guard, outcome } = await loadFaithful17();
    expect(outcome.preservationFailed).toBe(false);
    expect(guard.tryPersist(messages(["a", "b"]), async () => {})).toBe(false);
  });

  test("2-over-17 with a declared shrink is allowed and the declaration is spent", async () => {
    const { guard } = await loadFaithful17();
    const shrunk = messages(["a", "b"]);
    guard.armDeclaredShrink(shrunk);
    expect(guard.tryPersist(shrunk, async () => {})).toBe(true);
    await flush();
    // Spent by that write once it landed: a later drop of ids the store now
    // holds is refused again.
    expect(guard.tryPersist(messages(["c"]), async () => {})).toBe(false);
  });

  test("lossy-but-nonzero sanitize (17 raw → 2 valid): raw is quarantined and the raw ids refuse same-count impostors", async () => {
    const { kv, map } = fakeKv({ [KEY]: raw17 });
    const guard = createHistoryWriteGuard(kv);
    const keep2 = (entries: unknown[]) => entries.slice(0, 2);
    const outcome = await guard.onHistoryLoaded(raw17, KEY, keep2);
    expect(outcome.messages).toHaveLength(2);
    expect(outcome.preservationFailed).toBe(false);
    expect(map.get(QUARANTINE_KEY)).toBe(raw17);
    expect(map.get(KEY)).toBe(raw17);
    // Count equal, content different: refused. A count-based rule would
    // wrongly allow this and erase the 15 dropped entries.
    const seventeenDifferent = JSON.parse(rawHistory(17, "x")) as unknown[];
    expect(guard.tryPersist(seventeenDifferent, async () => {})).toBe(false);
    // But growth that keeps the 2 surviving ids writes normally.
    expect(
      guard.tryPersist([...messages(["m0", "m1"]), ...messages(["n0"])], async () => {}),
    ).toBe(true);
  });

  test("poisoned sequence: load → type → flush refused while the copy is in flight → copy confirmed → flush allowed", async () => {
    const { kv, map, releaseCopy } = deferredQuarantineKv({ [KEY]: raw17 });
    const guard = createHistoryWriteGuard(kv);
    const loaded = guard.onHistoryLoaded(raw17, KEY, () => []);
    let outcome: { messages: unknown[]; preservationFailed: boolean } | null =
      null;
    loaded.then((o) => {
      outcome = o;
    });
    // In flight: the gate is closed, nothing may overwrite the raw.
    expect(guard.tryPersist(messages(["a"]), async () => {})).toBe(false);
    releaseCopy();
    await loaded;
    expect(outcome).not.toBeNull();
    expect(outcome!.preservationFailed).toBe(false);
    expect(map.get(QUARANTINE_KEY)).toBe(raw17);
    expect(map.get(KEY)).toBe(raw17);
    // Preservation confirmed and the screen shows 0: writes resume.
    expect(guard.tryPersist(messages(["a", "b"]), async () => {})).toBe(true);
  });

  test("quarantine copy fails: writes stay refused and the caller is told (preservationFailed)", async () => {
    const guard = createHistoryWriteGuard(rejectingKv());
    const outcome = await guard.onHistoryLoaded(raw17, KEY, () => []);
    expect(outcome.preservationFailed).toBe(true);
    expect(guard.tryPersist(messages(["a"]), async () => {})).toBe(false);
    expect(guard.tryPersist(JSON.parse(raw17) as unknown[], async () => {})).toBe(false);
    // The probe: the store must still count as holding messages.
    expect(guard.storeKnownToHoldMessages()).toBe(true);
  });

  test("unparseable raw behaves like any lossy load: preserved → resume, failed → refuse", async () => {
    const broken = '{"messages": [';
    const ok = fakeKv({ [KEY]: broken });
    const guardOk = createHistoryWriteGuard(ok.kv);
    const outcomeOk = await guardOk.onHistoryLoaded(broken, KEY, (e) => e);
    expect(outcomeOk.preservationFailed).toBe(false);
    expect(ok.map.get(QUARANTINE_KEY)).toBe(broken);
    expect(ok.map.get(KEY)).toBe(broken);
    expect(guardOk.tryPersist(messages(["a"]), async () => {})).toBe(true);

    const failingGuard = createHistoryWriteGuard(rejectingKv());
    const outcomeBad = await failingGuard.onHistoryLoaded(broken, KEY, (e) => e);
    expect(outcomeBad.preservationFailed).toBe(true);
    expect(failingGuard.tryPersist(messages(["a"]), async () => {})).toBe(false);
  });

  test("no false positives: growth and equal-length writes pass; empty and absent raws open the gate", async () => {
    const { guard } = await loadFaithful17();
    expect(guard.tryPersist(messages(Array.from({ length: 17 }, (_, i) => `m${i}`)), async () => {})).toBe(true);
    expect(
      guard.tryPersist(
        messages([...Array.from({ length: 17 }, (_, i) => `m${i}`), "new"]),
        async () => {},
      ),
    ).toBe(true);

    const empty = fakeKv({ [KEY]: "[]" });
    const guardEmpty = createHistoryWriteGuard(empty.kv);
    await guardEmpty.onHistoryLoaded("[]", KEY, () => []);
    expect(guardEmpty.tryPersist(messages(["a"]), async () => {})).toBe(true);

    const absent = fakeKv();
    const guardAbsent = createHistoryWriteGuard(absent.kv);
    await guardAbsent.onHistoryLoaded(null, KEY, () => []);
    expect(guardAbsent.tryPersist(messages(["a"]), async () => {})).toBe(true);
    expect(guardAbsent.storeKnownToHoldMessages()).toBe(false);
  });

  test("quarantine never clobbers an existing quarantine; the oldest copy counts as preserved", async () => {
    const firstCopy = '{"oldest": true}';
    const { kv, map } = fakeKv({
      [KEY]: raw17,
      [QUARANTINE_KEY]: firstCopy,
    });
    const guard = createHistoryWriteGuard(kv);
    const outcome = await guard.onHistoryLoaded(raw17, KEY, () => []);
    expect(map.get(QUARANTINE_KEY)).toBe(firstCopy);
    expect(map.get(KEY)).toBe(raw17);
    expect(outcome.preservationFailed).toBe(false);
    expect(guard.tryPersist(messages(["a"]), async () => {})).toBe(true);
  });

  test("declared shrink survives an unrelated flush: the flush does not spend it (B5)", async () => {
    const { guard } = await loadFaithful17();
    const all17 = JSON.parse(raw17) as unknown[];
    const shrunk = [...messages(["m0", "m1", "m2"]), ...messages(["u", "a"])];
    guard.armDeclaredShrink(shrunk);
    // Unrelated flush: same ids as the store (equal-length rewrite) —
    // allowed by membership, and it must NOT consume the declaration.
    expect(guard.tryPersist(all17, async () => {})).toBe(true);
    // The intended truncating write still shrinks.
    expect(guard.tryPersist(shrunk, async () => {})).toBe(true);
    // Spent by exactly that write.
    expect(guard.tryPersist(messages(["m0"]), async () => {})).toBe(false);
  });

  test("an allowed write whose setItem rejects does not move the known ids (B4)", async () => {
    const { kv } = fakeKv({ [KEY]: raw17 });
    let rejectNext = false;
    const kv2: HistoryKv = {
      getItem: kv.getItem,
      async setItem(key, value) {
        if (rejectNext) throw new Error("disk full");
        return kv.setItem(key, value);
      },
    };
    const guard = createHistoryWriteGuard(kv2);
    await guard.onHistoryLoaded(raw17, KEY, (e) => e);
    const growth = JSON.parse(raw17) as unknown[];
    growth.push({ id: "m17", role: "assistant", text: "x" });

    rejectNext = true;
    expect(guard.tryPersist(growth, (json) => kv2.setItem(KEY, json))).toBe(true);
    await flush();
    // The write rejected: the store still holds exactly the 17 — a shrink is refused.
    expect(guard.tryPersist(messages(["m0", "m1"]), async () => {})).toBe(false);

    rejectNext = false;
    expect(guard.tryPersist(growth, (json) => kv2.setItem(KEY, json))).toBe(true);
    await flush();
    // Now the store holds 18; the 17-only write is still fine (subset kept),
    // but a 2-message shrink remains refused.
    expect(guard.tryPersist(messages(["m0", "m1"]), async () => {})).toBe(false);
    expect(guard.storeKnownToHoldMessages()).toBe(true);
  });

  test("declared shrink cannot mask drops of ids learned after the arm", async () => {
    const { guard } = await loadFaithful17();
    const shrunk = messages(["m0", "m1", "m2"]);
    guard.armDeclaredShrink(shrunk);
    // An unrelated growth first (allowed by membership) teaches the guard a
    // new id once it lands; the stale declaration does not cover dropping it.
    const grown = [...JSON.parse(raw17) as unknown[], ...messages(["late"])];
    expect(guard.tryPersist(grown, async () => {})).toBe(true);
    await flush();
    const shrunkPlus = [...shrunk, ...messages(["u"])];
    expect(guard.tryPersist(shrunkPlus, async () => {})).toBe(false);
  });

  test("deleting a conversation removes the quarantine key with the messages key (B6)", async () => {
    const { kv, map } = fakeKv({
      [KEY]: raw17,
      [QUARANTINE_KEY]: raw17,
      "kalsa.messages.other": "keep me",
    });
    await deleteConversationHistory(
      {
        removeItem: async (key: string) => {
          map.delete(key);
        },
      },
      KEY,
    );
    expect(map.has(KEY)).toBe(false);
    expect(map.has(QUARANTINE_KEY)).toBe(false);
    expect(map.get("kalsa.messages.other")).toBe("keep me");
  });

  test("deleteConversationHistory reports false when the storage cannot delete", async () => {
    expect(await deleteConversationHistory({}, KEY)).toBe(false);
  });
});
