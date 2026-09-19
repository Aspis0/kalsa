/**
 * Per-model LRU eviction + free-space floor, stale prompt-env discard,
 * and the KALSA_SESSION evict marker.
 */

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

jest.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
  getInfoAsync: jest.fn(async () => ({ exists: false, isDirectory: false })),
  getFreeDiskStorageAsync: jest.fn(async () => 1_000_000_000),
  readDirectoryAsync: jest.fn(async () => []),
  deleteAsync: jest.fn(async () => undefined),
  makeDirectoryAsync: jest.fn(async () => undefined),
}));

jest.mock("./deviceProfile", () => ({
  getFreeDiskBytes: jest.fn(async () => Number.MAX_SAFE_INTEGER),
}));

import { STATIC_PREFIX_CONVERSATION_ID, sessionStem } from "./sessionKey";
import { sessionDiskBytesRequired } from "./sessionPersistence";
import {
  deleteSessionsForModelConversation,
  evictSessionPool,
  evictSessionPoolForSpace,
  pickEvictionStems,
  pickEvictionStemsForBytes,
  staleStemsForConversation,
} from "./sessionPool";

const stemOf = (model: string, conv: string) => sessionStem(model, conv, "env")!;
const spaceGateInput = { nPast: 100, nCtx: 8192, bytesPerToken: 5200 };
const spaceGateRequiredBytes = sessionDiskBytesRequired(
  spaceGateInput.nPast,
  spaceGateInput.bytesPerToken,
);

describe("pickEvictionStems, per-model regime", () => {
  test("does nothing when under budget", () => {
    const keep = stemOf("lfm2.5-2.6b", "c-keep");
    const old = stemOf("lfm2.5-2.6b", "c-old");
    const files = [
      { stem: keep, bytes: 40_000_000, lastUsedAt: 3 },
      { stem: old, bytes: 40_000_000, lastUsedAt: 1 },
    ];
    expect(pickEvictionStems(files, 100_000_000, keep, "per-model")).toEqual([]);
  });

  test("a foreign Qwen file never pays for an LFM save", () => {
    // LFM total (80) is under the LFM budget (100), so nothing is charged
    // for the Qwen file even though the GLOBAL total (130) is over budget.
    const keep = stemOf("lfm2.5-2.6b", "c-keep");
    const ownOld = stemOf("lfm2.5-2.6b", "c-old");
    const qwen = stemOf("qwen3-1.7b", "c-x");
    const files = [
      { stem: keep, bytes: 40, lastUsedAt: 10 },
      { stem: ownOld, bytes: 40, lastUsedAt: 1 },
      { stem: qwen, bytes: 50, lastUsedAt: 9 },
    ];
    expect(pickEvictionStems(files, 100, keep, "per-model")).toEqual([]);
  });

  test("over the model's own budget → an LFM file is evicted, not the Qwen one", () => {
    const keep = stemOf("lfm2.5-2.6b", "c-keep");
    const ownOld = stemOf("lfm2.5-2.6b", "c-old");
    const qwen = stemOf("qwen3-1.7b", "c-x");
    const files = [
      { stem: keep, bytes: 40, lastUsedAt: 10 },
      { stem: ownOld, bytes: 70, lastUsedAt: 1 },
      { stem: qwen, bytes: 50, lastUsedAt: 9 },
    ];
    // LFM total 110 vs 100: drop ownOld (40 left), Qwen is not this save's
    // business even though it is the oldest victim-sized file.
    const victims = pickEvictionStems(files, 100, keep, "per-model");
    expect(victims).toEqual([ownOld]);
    expect(victims).not.toContain(qwen);
    expect(victims).not.toContain(keep);
  });

  test("same-model eviction is LRU and never the keep stem", () => {
    const keep = stemOf("lfm2.5-2.6b", "c-keep");
    const older = stemOf("lfm2.5-2.6b", "c-older");
    const newer = stemOf("lfm2.5-2.6b", "c-newer");
    const files = [
      { stem: keep, bytes: 40, lastUsedAt: 10 },
      { stem: older, bytes: 40, lastUsedAt: 2 },
      { stem: newer, bytes: 40, lastUsedAt: 8 },
    ];
    expect(pickEvictionStems(files, 80, keep, "per-model")).toEqual([older]);
    expect(pickEvictionStems(files, 80, keep, "per-model")).not.toContain(newer);
  });

  test("stops once the model's own total fits", () => {
    const keep = stemOf("lfm2.5-2.6b", "c-keep");
    const a = stemOf("lfm2.5-2.6b", "c-a");
    const b = stemOf("lfm2.5-2.6b", "c-b");
    const files = [
      { stem: keep, bytes: 40, lastUsedAt: 9 },
      { stem: a, bytes: 40, lastUsedAt: 1 },
      { stem: b, bytes: 40, lastUsedAt: 2 },
    ];
    expect(pickEvictionStems(files, 80, keep, "per-model")).toEqual([a]);
  });

  test("an unparseable keep stem evicts nothing (nothing is provably its model)", () => {
    const a = stemOf("lfm2.5-2.6b", "c-a");
    const files = [{ stem: a, bytes: 40, lastUsedAt: 1 }];
    expect(pickEvictionStems(files, 1, "legacy-no-seps", "per-model")).toEqual([]);
  });

  test("the static-prefix snapshot is neither charged nor evicted", () => {
    // The budget is expressed in CONVERSATIONS (sessionBudget.ts:
    // 5200 x 8192 = 42.6 MB each, and the picker offers 1), while the
    // snapshot is shared infrastructure of ~12.6 MB. Charging it made the
    // two evict each other: save, evict, recompute a 40 s prefill, save.
    const snapshot = sessionStem("lfm2.5", STATIC_PREFIX_CONVERSATION_ID, "pfx1")!;
    const chat = sessionStem("lfm2.5", "conv-1", "env")!;
    const files = [
      { stem: snapshot, bytes: 12_600_000, lastUsedAt: 1 },
      { stem: chat, bytes: 30_000_000, lastUsedAt: 2 },
    ];
    // 42.6 MB total would be over a 42,598,400 budget if the snapshot counted;
    // the chat alone is not, so nothing is evicted and the oldest file — the
    // snapshot — is not the victim it would otherwise be.
    expect(pickEvictionStems(files, 42_598_400, chat, "per-model")).toEqual([]);
    // And even when the chats really are over budget, the snapshot is not
    // offered as a victim — in either regime.
    const chat2 = sessionStem("lfm2.5", "conv-2", "env")!;
    const three = [
      { stem: snapshot, bytes: 12_600_000, lastUsedAt: 0 },
      { stem: chat, bytes: 30_000_000, lastUsedAt: 1 },
      { stem: chat2, bytes: 30_000_000, lastUsedAt: 2 },
    ];
    expect(pickEvictionStems(three, 42_598_400, chat2, "per-model")).toEqual([chat]);
    expect(pickEvictionStems(three, 42_598_400, chat2, "global")).toEqual([chat]);
  });
});

describe("pickEvictionStems, global regime", () => {
  const keep = stemOf("lfm2.5-2.6b", "c-keep");
  const ownOld = stemOf("lfm2.5-2.6b", "c-old");
  const qwen = stemOf("qwen3-1.7b", "c-x");
  const files = [
    { stem: keep, bytes: 40, lastUsedAt: 10 },
    { stem: ownOld, bytes: 40, lastUsedAt: 1 },
    { stem: qwen, bytes: 50, lastUsedAt: 9 },
  ];

  test("global — the regime a below-floor or unreadable reading selects — evicts the foreign file first", () => {
    // Which readings select global is pinned by evictionGoesGlobal's own
    // tests (sessionBudget) and by the pool marker test with a null reading.
    // Global total 130 vs 100: foreign-first drops Qwen (80 left) and stops
    // before touching the older same-model file.
    expect(pickEvictionStems(files, 100, keep, "global")).toEqual([qwen]);
    expect(pickEvictionStems(files, 100, keep, "global")).not.toContain(ownOld);
  });

  test("an unusable budget fails closed", () => {
    expect(pickEvictionStems(files, 0, keep, "global")).toEqual([]);
    expect(pickEvictionStems(files, Number.NaN, keep, "global")).toEqual([]);
  });
});

describe("pickEvictionStemsForBytes (space mode: cover the deficit, no more)", () => {
  const keep = stemOf("lfm2.5-2.6b", "c-keep");
  const ownOld = stemOf("lfm2.5-2.6b", "c-old");
  const qwenA = stemOf("qwen3-1.7b", "c-a");
  const qwenB = stemOf("qwen3-1.7b", "c-b");
  const snapshot = sessionStem("qwen3-1.7b", STATIC_PREFIX_CONVERSATION_ID, "pfx1")!;
  const files = [
    { stem: keep, bytes: 40, lastUsedAt: 10 },
    { stem: ownOld, bytes: 40, lastUsedAt: 1 },
    { stem: qwenA, bytes: 50, lastUsedAt: 9 },
    { stem: qwenB, bytes: 30, lastUsedAt: 2 },
  ];

  test("foreign first, only until the need is covered", () => {
    // Within the foreign group LRU applies: qwenB (older, 30) first, then
    // qwenA (50) covers the remaining 30. The older same-model file — older
    // than both foreign files — is still never touched.
    expect(pickEvictionStemsForBytes(files, 60, keep)).toEqual([qwenB, qwenA]);
    expect(pickEvictionStemsForBytes(files, 30, keep)).toEqual([qwenB]);
  });

  test("zero or negative need evicts nothing", () => {
    expect(pickEvictionStemsForBytes(files, 0, keep)).toEqual([]);
    expect(pickEvictionStemsForBytes(files, -5, keep)).toEqual([]);
  });

  test("never the keep stem, even when it is the only file", () => {
    expect(pickEvictionStemsForBytes([{ stem: keep, bytes: 150, lastUsedAt: 1 }], 100, keep)).toEqual([]);
  });

  test("never the static-prefix snapshot, whatever its age or size", () => {
    const withSnapshot = [
      { stem: snapshot, bytes: 200, lastUsedAt: 0 },
      { stem: qwenA, bytes: 30, lastUsedAt: 5 },
    ];
    // Need 50, only 30 evictable: the snapshot is not offered to cover it.
    expect(pickEvictionStemsForBytes(withSnapshot, 50, stemOf("qwen3-1.7b", "c-z"))).toEqual([qwenA]);
  });
});

describe("staleStemsForConversation", () => {
  test("drops same model+conversation with a different env hash", () => {
    const keep = sessionStem("m", "c1", "envA");
    const stale = sessionStem("m", "c1", "envB");
    const other = sessionStem("m", "c2", "envB");
    const names = [`${keep}.kvs`, `${stale}.kvs`, `${other}.kvs`, "m.kvs"];
    expect(staleStemsForConversation(names, "m", "c1", "envA")).toEqual([stale]);
  });
});

describe("deleteSessionsForModelConversation", () => {
  // Restore the shared expo mocks even when the assertion fails, so a
  // leaked exists:true / .kvs listing cannot poison later tests.
  afterEach(async () => {
    const FileSystem = await import("expo-file-system/legacy");
    (FileSystem.getInfoAsync as jest.Mock)
      .mockReset()
      .mockResolvedValue({ exists: false, isDirectory: false });
    (FileSystem.readDirectoryAsync as jest.Mock)
      .mockReset()
      .mockResolvedValue([]);
    (FileSystem.deleteAsync as jest.Mock)
      .mockReset()
      .mockResolvedValue(undefined);
  });

  test("throws when a matching .kvs survives the delete", async () => {
    const FileSystem = await import("expo-file-system/legacy");
    const stem = sessionStem("lfm2.5-2.6b", "chat-1", "env")!;
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({
      exists: true,
      isDirectory: true,
    });
    (FileSystem.readDirectoryAsync as jest.Mock).mockResolvedValue([
      `${stem}.kvs`,
    ]);
    // deleteAsync is a no-op mock, so the re-list still sees the file.
    await expect(
      deleteSessionsForModelConversation("lfm2.5-2.6b", "chat-1"),
    ).rejects.toThrow(/left 1 \.kvs/);
  });
});

describe("evictSessionPool marker", () => {
  const keepStem = stemOf("lfm2.5-2.6b", "c-keep");
  const ownOldStem = stemOf("lfm2.5-2.6b", "c-old");
  const qwenStem = stemOf("qwen3-1.7b", "c-x");

  beforeEach(async () => {
    const FileSystem = await import("expo-file-system/legacy");
    const { getFreeDiskBytes } = await import("./deviceProfile");
    (FileSystem.getInfoAsync as jest.Mock)
      .mockReset()
      .mockResolvedValue({ exists: false, isDirectory: false });
    (FileSystem.readDirectoryAsync as jest.Mock)
      .mockReset()
      .mockResolvedValue([]);
    (FileSystem.getFreeDiskStorageAsync as jest.Mock)
      .mockReset()
      .mockResolvedValue(1_000_000_000);
    (FileSystem.deleteAsync as jest.Mock)
      .mockReset()
      .mockResolvedValue(undefined);
    (getFreeDiskBytes as jest.Mock)
      .mockReset()
      .mockResolvedValue(Number.MAX_SAFE_INTEGER);
  });

  test("emits one evict line with victim/keep modelIds and no stem", async () => {
    const FileSystem = await import("expo-file-system/legacy");
    const { getFreeDiskBytes } = await import("./deviceProfile");
    const spy = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      // Unreadable free space selects the global regime; the line must say so
      // (freeBytes null, policy global) rather than leave it unexplained.
      (getFreeDiskBytes as jest.Mock).mockResolvedValue(null);
      (FileSystem.readDirectoryAsync as jest.Mock).mockResolvedValue([
        `${keepStem}.kvs`,
        `${ownOldStem}.kvs`,
        `${qwenStem}.kvs`,
      ]);
      const bytesByPath = new Map<string, number>([
        [`file:///docs/sessions/${keepStem}.kvs`, 40],
        [`file:///docs/sessions/${ownOldStem}.kvs`, 50],
        [`file:///docs/sessions/${qwenStem}.kvs`, 50],
      ]);
      (FileSystem.getInfoAsync as jest.Mock).mockImplementation(
        async (path: string) => ({
          exists: true,
          isDirectory: false,
          size: bytesByPath.get(path) ?? 0,
          modificationTime: 0,
        }),
      );

      await evictSessionPool(keepStem, 100);

      const lines = spy.mock.calls
        .map((call) => String(call[0]))
        .filter(
          (l) => l.startsWith("KALSA_SESSION ") && l.includes('"op":"evict"'),
        );
      expect(lines).toHaveLength(1);
      const payload = JSON.parse(lines[0].slice("KALSA_SESSION ".length)) as {
        [key: string]: unknown;
      };
      // Model ids come out exactly as they sit on disk: the sanitized stem
      // segment ("." → _002e), still greppable against the directory.
      expect(payload).toMatchObject({
        op: "evict",
        ok: true,
        mode: "budget",
        policy: "global",
        keepModel: "lfm2_002e5-2_002e6b",
        budgetBytes: 100,
        totalBytes: 140,
        poolBytes: 140,
        freeBytes: null,
        victims: 1,
        bytes: 50,
        sidecars: 0,
      });
      expect(payload.victimModels).toEqual(["qwen3-1_002e7b"]);
      // The stem IS the conversation id: assert its absence, not just the
      // presence of the allowed fields — a presence-only check would not
      // catch a stem sneaking into the payload.
      for (const secret of [
        keepStem,
        ownOldStem,
        qwenStem,
        "c-keep",
        "c-old",
        "c-x",
        ".kvs",
        "sessions/",
      ]) {
        expect(lines[0]).not.toContain(secret);
      }
    } finally {
      spy.mockRestore();
    }
  });

  test("a thrown run emits ok:false with the error type, never the message", async () => {
    const FileSystem = await import("expo-file-system/legacy");
    const spy = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      // The session dir must exist, or listSessionDirNames short-circuits on
      // getInfoAsync and the rejection below never fires.
      (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({
        exists: true,
        isDirectory: false,
      });
      (FileSystem.readDirectoryAsync as jest.Mock).mockRejectedValue(
        new Error(`EIO listing ${keepStem}.kvs`),
      );

      await evictSessionPool(keepStem, 100);

      const lines = spy.mock.calls
        .map((call) => String(call[0]))
        .filter(
          (l) => l.startsWith("KALSA_SESSION ") && l.includes('"op":"evict"'),
        );
      expect(lines).toHaveLength(1);
      const payload = JSON.parse(lines[0].slice("KALSA_SESSION ".length)) as {
        [key: string]: unknown;
      };
      expect(payload).toMatchObject({
        op: "evict",
        ok: false,
        reason: "evict_failed",
        errorType: "Error",
      });
      // The rejection message contained a stem; the strong absence list runs
      // on the failure line exactly as on the success line.
      for (const secret of [
        keepStem,
        ownOldStem,
        qwenStem,
        "c-keep",
        "c-old",
        "c-x",
        ".kvs",
        "sessions/",
      ]) {
        expect(lines[0]).not.toContain(secret);
      }
    } finally {
      spy.mockRestore();
    }
  });

  test("a common no-victim per-model run still emits its line", async () => {
    const FileSystem = await import("expo-file-system/legacy");
    const spy = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      // Free space plenty (default mock) → per-model; LFM total 40 <= 100 →
      // nothing to do. The Qwen file is charged to poolBytes, not to the
      // regime's totalBytes.
      (FileSystem.readDirectoryAsync as jest.Mock).mockResolvedValue([
        `${keepStem}.kvs`,
        `${qwenStem}.kvs`,
      ]);
      (FileSystem.getInfoAsync as jest.Mock).mockImplementation(
        async (path: string) => ({
          exists: true,
          isDirectory: false,
          size: path.includes("qwen") ? 50 : 40,
          modificationTime: 0,
        }),
      );

      await evictSessionPool(keepStem, 100);

      const lines = spy.mock.calls
        .map((call) => String(call[0]))
        .filter(
          (l) => l.startsWith("KALSA_SESSION ") && l.includes('"op":"evict"'),
        );
      expect(lines).toHaveLength(1);
      const payload = JSON.parse(lines[0].slice("KALSA_SESSION ".length)) as {
        [key: string]: unknown;
      };
      expect(payload).toMatchObject({
        op: "evict",
        ok: true,
        policy: "per-model",
        keepModel: "lfm2_002e5-2_002e6b",
        totalBytes: 40,
        poolBytes: 90,
        victims: 0,
        bytes: 0,
        victimModels: [],
      });
      expect(payload.reason).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });

  test("over budget with nothing evictable is reported, not silent", async () => {
    const FileSystem = await import("expo-file-system/legacy");
    const spy = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      // One own file (the keep stem) larger than the whole budget: the
      // victim list is empty while the charge stays over budget.
      (FileSystem.readDirectoryAsync as jest.Mock).mockResolvedValue([
        `${keepStem}.kvs`,
      ]);
      (FileSystem.getInfoAsync as jest.Mock).mockImplementation(
        async () => ({
          exists: true,
          isDirectory: false,
          size: 150,
          modificationTime: 0,
        }),
      );

      await evictSessionPool(keepStem, 100);

      const lines = spy.mock.calls
        .map((call) => String(call[0]))
        .filter(
          (l) => l.startsWith("KALSA_SESSION ") && l.includes('"op":"evict"'),
        );
      expect(lines).toHaveLength(1);
      const payload = JSON.parse(lines[0].slice("KALSA_SESSION ".length)) as {
        [key: string]: unknown;
      };
      expect(payload).toMatchObject({
        op: "evict",
        ok: false,
        reason: "over_budget_unevictable",
        policy: "per-model",
        totalBytes: 150,
        poolBytes: 150,
        victims: 0,
        bytes: 0,
      });
    } finally {
      spy.mockRestore();
    }
  });

  test("invalid budget refuses without evicting", async () => {
    const FileSystem = await import("expo-file-system/legacy");
    const spy = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      (FileSystem.readDirectoryAsync as jest.Mock).mockResolvedValue([
        `${keepStem}.kvs`,
        `${qwenStem}.kvs`,
      ]);
      await evictSessionPool(keepStem, 0);

      expect(FileSystem.deleteAsync as jest.Mock).not.toHaveBeenCalled();
      const lines = spy.mock.calls
        .map((call) => String(call[0]))
        .filter(
          (l) => l.startsWith("KALSA_SESSION ") && l.includes('"op":"evict"'),
        );
      const payload = JSON.parse(lines[0].slice("KALSA_SESSION ".length)) as {
        [key: string]: unknown;
      };
      expect(payload).toMatchObject({
        ok: false,
        reason: "invalid_budget",
        budgetBytes: 0,
        victims: 0,
        bytes: 0,
      });
    } finally {
      spy.mockRestore();
    }
  });

  test("a failed cache drop is excluded from counters and marker success", async () => {
    const FileSystem = await import("expo-file-system/legacy");
    const { getFreeDiskBytes } = await import("./deviceProfile");
    const spy = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      (getFreeDiskBytes as jest.Mock).mockResolvedValue(null);
      (FileSystem.readDirectoryAsync as jest.Mock).mockResolvedValue([
        `${keepStem}.kvs`,
        `${qwenStem}.kvs`,
      ]);
      (FileSystem.getInfoAsync as jest.Mock).mockImplementation(
        async (path: string) => ({
          exists: true,
          isDirectory: false,
          size: path.includes("qwen") ? 50 : 40,
          modificationTime: 0,
        }),
      );
      (FileSystem.deleteAsync as jest.Mock).mockImplementation(
        async (path: string) => {
          if (path === `file:///docs/sessions/${qwenStem}.kvs`) {
            throw new Error("EIO");
          }
        },
      );

      await evictSessionPool(keepStem, 40);

      const lines = spy.mock.calls
        .map((call) => String(call[0]))
        .filter(
          (l) => l.startsWith("KALSA_SESSION ") && l.includes('"op":"evict"'),
        );
      const payload = JSON.parse(lines[0].slice("KALSA_SESSION ".length)) as {
        [key: string]: unknown;
      };
      expect(payload).toMatchObject({
        ok: false,
        reason: "evict_failed",
        errorType: "DeleteFailed",
        victims: 0,
        bytes: 0,
      });
    } finally {
      spy.mockRestore();
    }
  });

  test("space mode, evictable < deficit → no cache removed, sidecar swept", async () => {
    const FileSystem = await import("expo-file-system/legacy");
    const spy = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      (FileSystem.readDirectoryAsync as jest.Mock).mockResolvedValue([
        `${keepStem}.kvs`,
        `${qwenStem}.kvs`,
        `${qwenStem}.kvs.tmp`,
      ]);
      (FileSystem.getInfoAsync as jest.Mock).mockImplementation(
        async (path: string) => ({
          exists: true,
          isDirectory: false,
          size: path.endsWith(".kvs.tmp")
            ? 0
            : path.includes("qwen")
              ? 50
              : 40,
          modificationTime: 0,
        }),
      );
      (FileSystem.getFreeDiskStorageAsync as jest.Mock).mockResolvedValue(
        spaceGateRequiredBytes + 1 - 200,
      );

      const result = await evictSessionPoolForSpace(keepStem, spaceGateInput);

      // The foreign .kvs is only 50 bytes, so no whole cache can cover the
      // 200-byte deficit. The stale foreign sidecar is still swept first.
      expect(result).toEqual({
        insufficient: true,
        bytes: 0,
        requiredDeficitBytes: 200,
      });
      const deletedPaths = (FileSystem.deleteAsync as jest.Mock).mock.calls.map(
        ([path]) => String(path),
      );
      expect(deletedPaths).toEqual([
        `file:///docs/sessions/${qwenStem}.kvs.tmp`,
      ]);
      expect(deletedPaths).not.toContain(
        `file:///docs/sessions/${qwenStem}.kvs`,
      );
      const lines = spy.mock.calls
        .map((call) => String(call[0]))
        .filter(
          (l) => l.startsWith("KALSA_SESSION ") && l.includes('"op":"evict"'),
        );
      expect(lines).toHaveLength(1);
      const payload = JSON.parse(lines[0].slice("KALSA_SESSION ".length)) as {
        [key: string]: unknown;
      };
      expect(payload).toMatchObject({
        op: "evict",
        ok: false,
        reason: "deficit_uncoverable",
        mode: "space",
        policy: "global",
        neededBytes: 200,
        evictableBytes: 50,
        victims: 0,
        bytes: 0,
      });
    } finally {
      spy.mockRestore();
    }
  });

  test("space mode, evictable ≥ deficit → whole files cover the need", async () => {
    const FileSystem = await import("expo-file-system/legacy");
    const spy = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      (FileSystem.readDirectoryAsync as jest.Mock).mockResolvedValue([
        `${keepStem}.kvs`,
        `${ownOldStem}.kvs`,
        `${qwenStem}.kvs`,
      ]);
      const bytesByPath = new Map<string, number>([
        [`file:///docs/sessions/${keepStem}.kvs`, 40],
        [`file:///docs/sessions/${ownOldStem}.kvs`, 40],
        [`file:///docs/sessions/${qwenStem}.kvs`, 50],
      ]);
      (FileSystem.getInfoAsync as jest.Mock).mockImplementation(
        async (path: string) => ({
          exists: true,
          isDirectory: false,
          size: bytesByPath.get(path) ?? 0,
          modificationTime: 0,
        }),
      );

      // Need 50: the foreign file covers it — the same-model file stays warm.
      // Victims are whole files, so a final victim may overshoot the need.
      (FileSystem.getFreeDiskStorageAsync as jest.Mock).mockResolvedValue(
        spaceGateRequiredBytes + 1 - 50,
      );
      const result = await evictSessionPoolForSpace(keepStem, spaceGateInput);

      expect(result).toEqual({
        insufficient: false,
        bytes: 50,
        requiredDeficitBytes: 50,
      });
      expect(FileSystem.deleteAsync as jest.Mock).toHaveBeenCalledWith(
        `file:///docs/sessions/${qwenStem}.kvs`,
        { idempotent: true },
      );
      const lines = spy.mock.calls
        .map((call) => String(call[0]))
        .filter(
          (l) => l.startsWith("KALSA_SESSION ") && l.includes('"op":"evict"'),
        );
      expect(lines).toHaveLength(1);
      const payload = JSON.parse(lines[0].slice("KALSA_SESSION ".length)) as {
        [key: string]: unknown;
      };
      expect(payload).toMatchObject({
        op: "evict",
        ok: true,
        mode: "space",
        policy: "global",
        neededBytes: 50,
        evictableBytes: 90,
        victims: 1,
        bytes: 50,
      });
      expect(payload.victimModels).toEqual(["qwen3-1_002e7b"]);
      // No stem ever reaches the line.
      for (const secret of [keepStem, ownOldStem, qwenStem, "c-keep", ".kvs"]) {
        expect(lines[0]).not.toContain(secret);
      }
    } finally {
      spy.mockRestore();
    }
  });

  test("a hostile error name never reaches the line", async () => {
    const FileSystem = await import("expo-file-system/legacy");
    const spy = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({
        exists: true,
        isDirectory: false,
      });
      const hostile = Object.assign(
        new Error(`EIO listing ${keepStem}.kvs`),
        { name: `/docs/sessions/${keepStem}.kvs` },
      );
      (FileSystem.readDirectoryAsync as jest.Mock).mockRejectedValue(hostile);

      await evictSessionPool(keepStem, 100);

      const lines = spy.mock.calls
        .map((call) => String(call[0]))
        .filter(
          (l) => l.startsWith("KALSA_SESSION ") && l.includes('"op":"evict"'),
        );
      expect(lines).toHaveLength(1);
      const payload = JSON.parse(lines[0].slice("KALSA_SESSION ".length)) as {
        [key: string]: unknown;
      };
      expect(payload).toMatchObject({
        op: "evict",
        ok: false,
        reason: "evict_failed",
        errorType: "unknown",
      });
      for (const secret of [
        keepStem,
        ownOldStem,
        qwenStem,
        "c-keep",
        "c-old",
        "c-x",
        ".kvs",
        "sessions/",
      ]) {
        expect(lines[0]).not.toContain(secret);
      }
    } finally {
      spy.mockRestore();
    }
  });
});
