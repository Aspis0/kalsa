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
  readDirectoryAsync: jest.fn(async () => []),
  deleteAsync: jest.fn(async () => undefined),
  makeDirectoryAsync: jest.fn(async () => undefined),
}));

jest.mock("./deviceProfile", () => ({
  getFreeDiskBytes: jest.fn(async () => Number.MAX_SAFE_INTEGER),
}));

import { EVICTION_FREE_FLOOR_BYTES } from "./sessionBudget";
import { STATIC_PREFIX_CONVERSATION_ID, sessionStem } from "./sessionKey";
import {
  deleteSessionsForModelConversation,
  evictSessionPool,
  pickEvictionStems,
  staleStemsForConversation,
} from "./sessionPool";

const PLENTY = Number.MAX_SAFE_INTEGER;
const LOW = EVICTION_FREE_FLOOR_BYTES - 1;

const stemOf = (model: string, conv: string) => sessionStem(model, conv, "env")!;

describe("pickEvictionStems, per-model regime (free space at/above floor)", () => {
  test("does nothing when under budget", () => {
    const keep = stemOf("lfm2.5-2.6b", "c-keep");
    const old = stemOf("lfm2.5-2.6b", "c-old");
    const files = [
      { stem: keep, bytes: 40_000_000, lastUsedAt: 3 },
      { stem: old, bytes: 40_000_000, lastUsedAt: 1 },
    ];
    expect(pickEvictionStems(files, 100_000_000, keep, PLENTY)).toEqual([]);
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
    expect(pickEvictionStems(files, 100, keep, PLENTY)).toEqual([]);
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
    const victims = pickEvictionStems(files, 100, keep, PLENTY);
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
    expect(pickEvictionStems(files, 80, keep, PLENTY)).toEqual([older]);
    expect(pickEvictionStems(files, 80, keep, PLENTY)).not.toContain(newer);
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
    expect(pickEvictionStems(files, 80, keep, PLENTY)).toEqual([a]);
  });

  test("an unparseable keep stem evicts nothing (nothing is provably its model)", () => {
    const a = stemOf("lfm2.5-2.6b", "c-a");
    const files = [{ stem: a, bytes: 40, lastUsedAt: 1 }];
    expect(pickEvictionStems(files, 1, "legacy-no-seps", PLENTY)).toEqual([]);
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
    expect(pickEvictionStems(files, 42_598_400, chat, PLENTY)).toEqual([]);
    // And even when the chats really are over budget, the snapshot is not
    // offered as a victim — in either regime.
    const chat2 = sessionStem("lfm2.5", "conv-2", "env")!;
    const three = [
      { stem: snapshot, bytes: 12_600_000, lastUsedAt: 0 },
      { stem: chat, bytes: 30_000_000, lastUsedAt: 1 },
      { stem: chat2, bytes: 30_000_000, lastUsedAt: 2 },
    ];
    expect(pickEvictionStems(three, 42_598_400, chat2, PLENTY)).toEqual([chat]);
    expect(pickEvictionStems(three, 42_598_400, chat2, LOW)).toEqual([chat]);
  });
});

describe("pickEvictionStems, global regime (below the floor, or unreadable)", () => {
  const keep = stemOf("lfm2.5-2.6b", "c-keep");
  const ownOld = stemOf("lfm2.5-2.6b", "c-old");
  const qwen = stemOf("qwen3-1.7b", "c-x");
  const files = [
    { stem: keep, bytes: 40, lastUsedAt: 10 },
    { stem: ownOld, bytes: 40, lastUsedAt: 1 },
    { stem: qwen, bytes: 50, lastUsedAt: 9 },
  ];

  test("below the floor the foreign file becomes evictable again — first", () => {
    // Global total 130 vs 100: foreign-first drops Qwen (80 left) and stops
    // before touching the older same-model file.
    expect(pickEvictionStems(files, 100, keep, LOW)).toEqual([qwen]);
    expect(pickEvictionStems(files, 100, keep, LOW)).not.toContain(ownOld);
  });

  test("a null free-space reading selects global, never plenty", () => {
    expect(pickEvictionStems(files, 100, keep, null)).toEqual([qwen]);
  });

  test("a non-finite reading selects global too", () => {
    expect(pickEvictionStems(files, 100, keep, Number.NaN)).toEqual([qwen]);
  });

  test("the floor boundary itself is per-model", () => {
    expect(
      pickEvictionStems(files, 100, keep, EVICTION_FREE_FLOOR_BYTES),
    ).toEqual([]);
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
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({
      exists: false,
      isDirectory: false,
    });
    (FileSystem.readDirectoryAsync as jest.Mock).mockResolvedValue([]);
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
        policy: "global",
        keepModel: "lfm2_002e5-2_002e6b",
        budgetBytes: 100,
        totalBytes: 140,
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
      expect(lines[0]).not.toContain("c-keep");
    } finally {
      spy.mockRestore();
    }
  });
});
