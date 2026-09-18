import {
  createHistoryWriteGuard,
  type HistoryKv,
} from "./historyWriteGuard";
import {
  deleteConversationHistory,
  quarantineKeyFor,
} from "./historyQuarantine";

const KEY = "kalsa.messages.testconv";
const OTHER_KEY = "kalsa.messages.other";
const QUARANTINE_KEY = quarantineKeyFor(KEY);

/** History in the persisted shape (id/role/text per message). */
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

/** Yield a macrotask so chained promise handlers have settled. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function messages(ids: string[]): { id: string; role: string; text: string }[] {
  return ids.map((id) => ({ id, role: "user", text: `text for ${id}` }));
}

function all17Ids(): string[] {
  return Array.from({ length: 17 }, (_, i) => `m${i}`);
}

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

/**
 * Fake KV whose quarantine writes (any slot of KEY) hang until released —
 * drives the in-flight preservation window.
 */
function deferredQuarantineKv(seed?: Record<string, string>) {
  const base = fakeKv(seed);
  let release: (() => void) | null = null;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const kv: HistoryKv = {
    getItem: base.kv.getItem,
    async setItem(key, value) {
      if (key.startsWith(`${KEY}.quarantine`)) await pending;
      return base.kv.setItem(key, value);
    },
  };
  return { ...base, kv, releaseCopy: () => release?.() };
}

/** Deferred KV write of the caller's choosing (for writes in flight). */
function withDeferredWrites(kv: HistoryKv, match: (key: string) => boolean) {
  const releaseFns: (() => void)[] = [];
  const gated = new Map<string, Promise<void>>();
  return {
    kv: {
      getItem: (key: string) => kv.getItem(key),
      setItem: async (key: string, value: string) => {
        if (match(key)) {
          const existing = gated.get(key);
          if (existing) {
            await existing;
          } else {
            const gate = new Promise<void>((resolve) =>
              releaseFns.push(resolve),
            );
            gated.set(key, gate);
            await gate;
          }
        }
        return kv.setItem(key, value);
      },
    } satisfies HistoryKv,
    releaseAll: () => releaseFns.forEach((fn) => fn()),
  };
}

/** Load + settle a faithful 17-entry history on a fresh guard. */
async function loadFaithful17() {
  const { kv, map } = fakeKv({ [KEY]: raw17 });
  const guard = createHistoryWriteGuard(kv);
  const begun = guard.beginHistoryLoad(raw17, KEY, (e) => e);
  const settled = await guard.settleHistoryLoad();
  return { guard, map, kv, begun, settled };
}

describe("historyWriteGuard", () => {
  test("2-over-17: a write missing known ids without a declaration is refused", async () => {
    const { guard, settled } = await loadFaithful17();
    expect(settled.preservationFailed).toBe(false);
    expect(guard.tryPersist(messages(["a", "b"]), async () => {}).issued).toBe(
      false,
    );
  });

  test("2-over-17 with a declared shrink is allowed and the declaration is spent", async () => {
    const { guard } = await loadFaithful17();
    const shrunk = messages(["a", "b"]);
    guard.armDeclaredShrink(shrunk);
    const ticket = guard.tryPersist(shrunk, async () => {});
    expect(ticket.issued).toBe(true);
    await flush();
    // Spent by that write once it landed: a later drop of ids the store now
    // holds is refused again.
    expect(guard.tryPersist(messages(["c"]), async () => {}).issued).toBe(false);
  });

  test("N1: an unrelated legacy quarantine gets a new slot; the raw is refused until that slot lands", async () => {
    const unrelated = '{"oldest": true}';
    const deferred = deferredQuarantineKv({
      [KEY]: raw17,
      [QUARANTINE_KEY]: unrelated,
    });
    const guard = createHistoryWriteGuard(deferred.kv);
    const begun = guard.beginHistoryLoad(raw17, KEY, () => []);
    expect(begun.messages).toEqual([]);
    // In flight: the gate is closed, the 17-entry raw must not be touched.
    expect(guard.tryPersist(messages(["a"]), async () => {}).issued).toBe(false);
    deferred.releaseCopy();
    const settled = await guard.settleHistoryLoad();
    expect(settled.preservationFailed).toBe(false);
    // THIS raw now has its own slot; the first copy is not clobbered.
    const slots = [...deferred.map.entries()].filter(([k]) =>
      k.startsWith(`${KEY}.quarantine`),
    );
    expect(slots).toHaveLength(2);
    expect(deferred.map.get(QUARANTINE_KEY)).toBe(unrelated);
    const newSlot = slots.find(([k]) => k !== QUARANTINE_KEY);
    expect(newSlot?.[1]).toBe(raw17);
    expect(deferred.map.get(KEY)).toBe(raw17);
    // Preservation confirmed: writes resume.
    expect(guard.tryPersist(messages(["a"]), async () => {}).issued).toBe(true);
  });

  test("re-loading the SAME raw twice writes exactly one slot (idempotent)", async () => {
    const { kv, map } = fakeKv({ [KEY]: raw17 });
    const guard = createHistoryWriteGuard(kv);
    guard.beginHistoryLoad(raw17, KEY, () => []);
    await guard.settleHistoryLoad();
    const guard2 = createHistoryWriteGuard(kv);
    guard2.beginHistoryLoad(raw17, KEY, () => []);
    await guard2.settleHistoryLoad();
    const slots = [...map.keys()].filter((k) =>
      k.startsWith(`${KEY}.quarantine`),
    );
    expect(slots).toEqual([QUARANTINE_KEY]);
    expect(map.get(QUARANTINE_KEY)).toBe(raw17);
  });

  test("N2: a write issued before a load adopts nothing when it resolves after it", async () => {
    const { kv, map } = fakeKv({ [KEY]: raw17, [OTHER_KEY]: rawHistory(3, "b") });
    const deferred = withDeferredWrites(kv, (key) => key === KEY);
    const guard = createHistoryWriteGuard(deferred.kv);
    guard.beginHistoryLoad(raw17, KEY, (e) => e);
    await guard.settleHistoryLoad();
    // Write in flight on KEY: 17 known ids + a new one.
    const growth = [
      ...JSON.parse(raw17) as unknown[],
      ...messages(["m17"]),
    ];
    const ticket = guard.tryPersist(growth, (json) =>
      deferred.kv.setItem(KEY, json),
    );
    expect(ticket.issued).toBe(true);
    // Conversation switch: a faithful load of another key takes over the gate.
    const otherRaw = rawHistory(3, "b");
    guard.beginHistoryLoad(otherRaw, OTHER_KEY, (e) => e);
    await guard.settleHistoryLoad();
    deferred.releaseAll();
    await flush();
    // The old write landed but adopts nothing: the new key's ids stand.
    expect(guard.tryPersist(messages(["b0", "b1", "b2"]), async () => {}).issued).toBe(true);
    expect(guard.tryPersist(messages(["b0"]), async () => {}).issued).toBe(false);
    expect(map.get(KEY)).toBe(JSON.stringify(growth));
  });

  test("N2 failed-load variant: the stale write cannot reopen a closed gate", async () => {
    const { kv } = fakeKv({ [KEY]: raw17, [OTHER_KEY]: "{" });
    const failingQuarantine = {
      getItem: (key: string) => kv.getItem(key),
      setItem: async (key: string, value: string) => {
        if (key.startsWith(`${OTHER_KEY}.quarantine`)) {
          throw new Error("quota");
        }
        return kv.setItem(key, value);
      },
    } satisfies HistoryKv;
    const deferred = withDeferredWrites(failingQuarantine, () => false);
    const guard = createHistoryWriteGuard(deferred.kv);
    guard.beginHistoryLoad(raw17, KEY, (e) => e);
    await guard.settleHistoryLoad();
    const ticket = guard.tryPersist(
      [...JSON.parse(raw17) as unknown[], ...messages(["m17"])],
      async () => {},
    );
    expect(ticket.issued).toBe(true);
    // Switch into a conversation whose raw cannot be preserved.
    guard.beginHistoryLoad("{", OTHER_KEY, (e) => e);
    const settled = await guard.settleHistoryLoad();
    expect(settled.preservationFailed).toBe(true);
    deferred.releaseAll();
    await flush();
    // The stale write landed; the gate must stay closed anyway.
    expect(guard.tryPersist(messages(["a"]), async () => {}).issued).toBe(false);
    expect(guard.storeKnownToHoldMessages()).toBe(true);
  });

  test("N3: a dropped entry whose id duplicates a survivor is lossy and quarantined", async () => {
    // 3 raw entries; m0 appears twice, the duplicate is dropped by sanitize.
    const raw = JSON.stringify([
      { id: "m0", role: "user", text: "one" },
      { id: "m0", role: "user", text: 5 },
      { id: "n1", role: "assistant", text: "two" },
    ]);
    const sanitizeValid = (entries: unknown[]) =>
      entries.filter(
        (e) => typeof (e as { text?: unknown }).text === "string",
      );
    const deferred = deferredQuarantineKv({ [KEY]: raw });
    const guard = createHistoryWriteGuard(deferred.kv);
    const begun = guard.beginHistoryLoad(raw, KEY, sanitizeValid);
    expect(begun.messages).toHaveLength(2);
    expect(begun.droppedCount).toBe(1);
    expect(guard.tryPersist(messages(["m0"]), async () => {}).issued).toBe(false);
    deferred.releaseCopy();
    const settled = await guard.settleHistoryLoad();
    expect(settled.preservationFailed).toBe(false);
    expect(deferred.map.get(QUARANTINE_KEY)).toBe(raw);
    expect(deferred.map.get(KEY)).toBe(raw);
  });

  test("N4: a lossy-but-preserved load reports the dropped count", async () => {
    const { kv } = fakeKv({ [KEY]: raw17 });
    const guard = createHistoryWriteGuard(kv);
    const begun = guard.beginHistoryLoad(raw17, KEY, (e) => e.slice(0, 2));
    expect(begun.messages).toHaveLength(2);
    const settled = await guard.settleHistoryLoad();
    expect(settled.preservationFailed).toBe(false);
    expect(settled.droppedCount).toBe(15);
  });

  test("N5: the declared shrink covers ids of a write that is still in flight", async () => {
    const { kv } = fakeKv({ [KEY]: raw17 });
    const deferred = withDeferredWrites(kv, (key) => key === KEY);
    const guard = createHistoryWriteGuard(deferred.kv);
    guard.beginHistoryLoad(raw17, KEY, (e) => e);
    await guard.settleHistoryLoad();
    const growth = [...JSON.parse(raw17) as unknown[], ...messages(["m17"])];
    const ticket = guard.tryPersist(growth, (json) =>
      deferred.kv.setItem(KEY, json),
    );
    expect(ticket.issued).toBe(true);
    // The edit truncates to the first 5 ids while the growth write is in
    // flight; its declaration must cover m17 too.
    guard.armDeclaredShrink(messages(["m0", "m1", "m2", "m3", "m4"]));
    deferred.releaseAll();
    await flush();
    const shrunkPlus = [
      ...messages(["m0", "m1", "m2", "m3", "m4"]),
      ...messages(["u", "a"]),
    ];
    expect(guard.tryPersist(shrunkPlus, async () => {}).issued).toBe(true);
  });

  test("B5: the declaration survives an unrelated flush and is spent by the shrinking write", async () => {
    const { guard } = await loadFaithful17();
    const all = JSON.parse(raw17) as unknown[];
    const shrunk = [...messages(["m0", "m1", "m2"]), ...messages(["u", "a"])];
    guard.armDeclaredShrink(shrunk);
    // Unrelated flush: same ids as the store — allowed by membership and it
    // must NOT consume the declaration.
    expect(guard.tryPersist(all, async () => {}).issued).toBe(true);
    await flush();
    expect(guard.tryPersist(shrunk, async () => {}).issued).toBe(true);
    await flush();
    expect(guard.tryPersist(messages(["m0"]), async () => {}).issued).toBe(false);
  });

  test("B4: an allowed write whose setItem rejects adopts nothing and lands false", async () => {
    const { kv } = fakeKv({ [KEY]: raw17 });
    let rejectNext = false;
    const flaky: HistoryKv = {
      getItem: (key) => kv.getItem(key),
      setItem: async (key, value) => {
        if (rejectNext) throw new Error("disk full");
        return kv.setItem(key, value);
      },
    };
    const guard = createHistoryWriteGuard(flaky);
    await guard.beginHistoryLoad(raw17, KEY, (e) => e);
    await guard.settleHistoryLoad();
    const growth = [...JSON.parse(raw17) as unknown[], ...messages(["m17"])];

    rejectNext = true;
    const rejected = guard.tryPersist(growth, (json) => flaky.setItem(KEY, json));
    expect(rejected.issued).toBe(true);
    expect(rejected.issued && (await rejected.landed)).toBe(false);
    // The store still holds exactly the 17: a shrink is refused.
    expect(guard.tryPersist(messages(["m0", "m1"]), async () => {}).issued).toBe(false);

    rejectNext = false;
    const ok = guard.tryPersist(growth, (json) => flaky.setItem(KEY, json));
    expect(ok.issued && (await ok.landed)).toBe(true);
    await flush();
    expect(guard.tryPersist(messages(["m0", "m1"]), async () => {}).issued).toBe(false);
    expect(guard.storeKnownToHoldMessages()).toBe(true);
  });

  test("no false positives: growth and equal-length writes pass; empty and absent raws open the gate", async () => {
    const { guard } = await loadFaithful17();
    expect(guard.tryPersist(messages(all17Ids()), async () => {}).issued).toBe(true);
    await flush();
    expect(
      guard.tryPersist(messages([...all17Ids(), "new"]), async () => {}).issued,
    ).toBe(true);

    const empty = fakeKv({ [KEY]: "[]" });
    const guardEmpty = createHistoryWriteGuard(empty.kv);
    guardEmpty.beginHistoryLoad("[]", KEY, () => []);
    await guardEmpty.settleHistoryLoad();
    expect(guardEmpty.tryPersist(messages(["a"]), async () => {}).issued).toBe(true);

    const absent = fakeKv();
    const guardAbsent = createHistoryWriteGuard(absent.kv);
    guardAbsent.beginHistoryLoad(null, KEY, () => []);
    await guardAbsent.settleHistoryLoad();
    expect(guardAbsent.tryPersist(messages(["a"]), async () => {}).issued).toBe(true);
    expect(guardAbsent.storeKnownToHoldMessages()).toBe(false);
  });

  test("unparseable raw behaves like any lossy load: preserved → resume, failed → refuse", async () => {
    const broken = '{"messages": [';
    const ok = fakeKv({ [KEY]: broken });
    const guardOk = createHistoryWriteGuard(ok.kv);
    const begun = guardOk.beginHistoryLoad(broken, KEY, (e) => e);
    expect(begun.messages).toEqual([]);
    const settledOk = await guardOk.settleHistoryLoad();
    expect(settledOk.preservationFailed).toBe(false);
    expect(ok.map.get(QUARANTINE_KEY)).toBe(broken);
    expect(ok.map.get(KEY)).toBe(broken);
    expect(guardOk.tryPersist(messages(["a"]), async () => {}).issued).toBe(true);

    const failing = createHistoryWriteGuard({
      async getItem() {
        return null;
      },
      async setItem() {
        throw new Error("quota");
      },
    });
    failing.beginHistoryLoad(broken, KEY, (e) => e);
    const outcome = await failing.settleHistoryLoad();
    expect(outcome.preservationFailed).toBe(true);
    expect(failing.tryPersist(messages(["a"]), async () => {}).issued).toBe(false);
  });

  test("B6: deleting a conversation removes the messages key with every quarantine slot", async () => {
    const { map } = fakeKv({
      [KEY]: raw17,
      [QUARANTINE_KEY]: raw17,
      [`${QUARANTINE_KEY}.1a2b3c`]: rawHistory(5, "x"),
      "kalsa.messages.other": "keep me",
    });
    const done = await deleteConversationHistory(
      {
        removeItem: async (key: string) => {
          map.delete(key);
        },
        getAllKeys: async () => [...map.keys()],
      },
      KEY,
    );
    expect(done).toBe(true);
    expect(map.has(KEY)).toBe(false);
    expect(map.has(QUARANTINE_KEY)).toBe(false);
    expect(map.has(`${QUARANTINE_KEY}.1a2b3c`)).toBe(false);
    expect(map.get("kalsa.messages.other")).toBe("keep me");
  });

  test("B6: without getAllKeys the live key and the first slot still go; no delete capability reports false", async () => {
    const { map } = fakeKv({
      [KEY]: raw17,
      [QUARANTINE_KEY]: raw17,
      [`${QUARANTINE_KEY}.1a2b3c`]: "suffixed copy",
    });
    expect(
      await deleteConversationHistory(
        {
          removeItem: async (key: string) => {
            map.delete(key);
          },
        },
        KEY,
      ),
    ).toBe(true);
    expect(map.has(KEY)).toBe(false);
    expect(map.has(QUARANTINE_KEY)).toBe(false);
    expect(map.has(`${QUARANTINE_KEY}.1a2b3c`)).toBe(true);

    expect(await deleteConversationHistory({}, KEY)).toBe(false);
  });
});
