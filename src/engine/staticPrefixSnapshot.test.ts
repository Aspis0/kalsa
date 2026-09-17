/**
 * Unit tests for the static-prefix KV snapshot (save + restore + eviction).
 *
 * Covers the failures that must never silently pass: a stale snapshot whose
 * engine build no longer matches (refused AND deleted), a loadSession that
 * resolves tokens_loaded: 0 (refused AND deleted), and a native save that
 * covers fewer tokens than the prefix (refused, tmp dropped).
 */

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStore.kv.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockStore.kv.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      mockStore.kv.delete(key);
    }),
  },
}));

jest.mock("expo-file-system/legacy", () => ({
  __esModule: true,
  documentDirectory: "file:///docs/",
  getInfoAsync: jest.fn(async (path: string) => ({
    // Directory paths (trailing /) always exist — the real fs has them once
    // makeDirectoryAsync ran; files live in the mockStore map.
    exists: path.endsWith("/") || mockStore.files.has(path),
    isDirectory: path.endsWith("/"),
    size: mockStore.files.get(path) ?? 0,
  })),
  getFreeDiskStorageAsync: jest.fn(async () => Number.MAX_SAFE_INTEGER),
  readDirectoryAsync: jest.fn(async (dir: string) => {
    const names: string[] = [];
    for (const key of mockStore.files.keys()) {
      if (!key.startsWith(dir)) continue;
      const rest = key.slice(dir.length);
      if (!rest.includes("/")) names.push(rest);
    }
    return names;
  }),
  deleteAsync: jest.fn(async (path: string) => {
    mockStore.files.delete(path);
  }),
  moveAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
    const size = mockStore.files.get(from);
    if (size === undefined) throw new Error(`missing ${from}`);
    mockStore.files.delete(from);
    mockStore.files.set(to, size);
  }),
  makeDirectoryAsync: jest.fn(async () => undefined),
}));

import AsyncStorage from "@react-native-async-storage/async-storage";

import { sessionMetaKey, sessionFilePath } from "./sessionPersistence";
import {
  type StaticPrefixIdentity,
  expectedStaticPrefixMeta,
  restoreStaticPrefixSnapshot,
  saveStaticPrefixSnapshot,
  staticPrefixStem,
} from "./staticPrefixSnapshot";

const mockStore: { files: Map<string, number>; kv: Map<string, string> } = {
  files: new Map(),
  kv: new Map(),
};

const IDENTITY: StaticPrefixIdentity = {
  modelId: "lfm2.5",
  modelFileId: "123:456",
  engineBuild: "build-a",
  nCtx: 4096,
  cacheTypeK: "q8_0",
  cacheTypeV: "q4_0",
  prefixHash: "pfx1",
};

const PREFIX_TOKENS = 1832;

function stemFor(prefixHash: string): string {
  return staticPrefixStem(IDENTITY.modelId, prefixHash) ?? "";
}

function putSnapshotFile(identity: StaticPrefixIdentity): string {
  const stem = stemFor(identity.prefixHash);
  mockStore.files.set(sessionFilePath(stem), 12_600_000);
  return stem;
}

async function putSnapshotMeta(identity: StaticPrefixIdentity): Promise<void> {
  const stem = stemFor(identity.prefixHash);
  await AsyncStorage.setItem(
    sessionMetaKey(stem),
    JSON.stringify(expectedStaticPrefixMeta(identity)),
  );
}

beforeEach(() => {
  mockStore.files.clear();
  mockStore.kv.clear();
  jest.clearAllMocks();
});

/** The caller-side abort predicate, asked again right before the native load. */
const NEVER_STOP = () => false;

describe("restoreStaticPrefixSnapshot", () => {
  test("happy path: loads the file, returns the native token count", async () => {
    const stem = putSnapshotFile(IDENTITY);
    await putSnapshotMeta(IDENTITY);
    const ctx = {
      loadSession: jest.fn(async () => ({
        tokens_loaded: PREFIX_TOKENS,
        prompt: "",
      })),
    };
    const outcome = await restoreStaticPrefixSnapshot(ctx, IDENTITY, NEVER_STOP);
    expect(outcome).toEqual({
      ok: true,
      stem,
      tokensLoaded: PREFIX_TOKENS,
    });
    // URI form: loadSession strips file:// itself — do not pre-strip.
    expect(ctx.loadSession).toHaveBeenCalledWith(sessionFilePath(stem));
  });

  test("a stop asked for during the awaits prevents the native load", async () => {
    // The point of the predicate: everything above loadSession — stat, .bak
    // promotion, .tmp delete, meta read — can outlive the context, and the
    // native load is the point of no return. A guard only at the call site
    // narrows that window; this closes it.
    const stem = putSnapshotFile(IDENTITY);
    await putSnapshotMeta(IDENTITY);
    const ctx = {
      loadSession: jest.fn(async () => ({ tokens_loaded: PREFIX_TOKENS })),
    };
    const outcome = await restoreStaticPrefixSnapshot(ctx, IDENTITY, () => true);
    expect(outcome).toEqual({ ok: false, stem, reason: "aborted" });
    expect(ctx.loadSession).not.toHaveBeenCalled();
  });

  test("the stop is asked AFTER the meta check, not instead of it", async () => {
    // A mismatched snapshot must still be deleted even when the job is
    // stopping: the artifact is wrong regardless of who is asking.
    const stem = putSnapshotFile(IDENTITY);
    await putSnapshotMeta({ ...IDENTITY, engineBuild: "build-old" });
    const ctx = {
      loadSession: jest.fn(async () => ({ tokens_loaded: PREFIX_TOKENS })),
    };
    const outcome = await restoreStaticPrefixSnapshot(ctx, IDENTITY, () => true);
    expect(outcome).toEqual({
      ok: false,
      stem,
      reason: "meta_mismatch:engineBuild",
      deleted: true,
    });
    expect(ctx.loadSession).not.toHaveBeenCalled();
  });

  test("stale engine build is refused AND deleted", async () => {
    const stem = putSnapshotFile(IDENTITY);
    await putSnapshotMeta({ ...IDENTITY, engineBuild: "build-old" });
    const ctx = {
      loadSession: jest.fn(async () => ({ tokens_loaded: PREFIX_TOKENS })),
    };
    const outcome = await restoreStaticPrefixSnapshot(ctx, IDENTITY, NEVER_STOP);
    expect(outcome).toEqual({
      ok: false,
      stem,
      reason: "meta_mismatch:engineBuild",
      deleted: true,
    });
    expect(ctx.loadSession).not.toHaveBeenCalled();
    expect(mockStore.files.has(sessionFilePath(stem))).toBe(false);
    expect(
      mockStore.kv.has(
        sessionMetaKey(stem),
      ),
    ).toBe(false);
  });

  test("loadSession resolving tokens_loaded: 0 is refused AND deleted", async () => {
    const stem = putSnapshotFile(IDENTITY);
    await putSnapshotMeta(IDENTITY);
    const ctx = {
      loadSession: jest.fn(async () => ({ tokens_loaded: 0, prompt: "" })),
    };
    const outcome = await restoreStaticPrefixSnapshot(ctx, IDENTITY, NEVER_STOP);
    expect(outcome).toEqual({
      ok: false,
      stem,
      reason: "tokens_loaded:0",
      deleted: true,
    });
    expect(mockStore.files.has(sessionFilePath(stem))).toBe(false);
  });

  test("no snapshot on disk → plain miss, nothing deleted", async () => {
    const ctx = {
      loadSession: jest.fn(async () => ({ tokens_loaded: PREFIX_TOKENS })),
    };
    const outcome = await restoreStaticPrefixSnapshot(ctx, IDENTITY, NEVER_STOP);
    expect(outcome).toEqual({
      ok: false,
      stem: stemFor(IDENTITY.prefixHash),
      reason: "no_file",
    });
    expect("deleted" in outcome && outcome.deleted).toBe(false);
  });

  test("native load error is reported as load_error for the caller to clear", async () => {
    putSnapshotFile(IDENTITY);
    await putSnapshotMeta(IDENTITY);
    const ctx = {
      loadSession: jest.fn(async () => {
        throw new Error("native boom");
      }),
    };
    const outcome = await restoreStaticPrefixSnapshot(ctx, IDENTITY, NEVER_STOP);
    expect(outcome).toEqual({
      ok: false,
      stem: stemFor(IDENTITY.prefixHash),
      reason: "load_error",
    });
  });

  test("a different KV cache type is refused AND deleted", async () => {
    // Cache types are NOT in the stem (sessionKey.ts: "Engine knobs and KV
    // cache types stay in SessionMeta"), so the meta comparison is the only
    // thing standing between a q8_0/q4_0 file and a context built with
    // different types. Without this, expectedStaticPrefixMeta could drop the
    // fields entirely and the suite would not notice.
    for (const [field, stored] of [
      ["cacheTypeK", { ...IDENTITY, cacheTypeK: "f16" }],
      ["cacheTypeV", { ...IDENTITY, cacheTypeV: "f16" }],
    ] as const) {
      mockStore.files.clear();
      mockStore.kv.clear();
      const stem = putSnapshotFile(IDENTITY);
      await putSnapshotMeta(stored);
      const ctx = {
        loadSession: jest.fn(async () => ({ tokens_loaded: PREFIX_TOKENS })),
      };
      const outcome = await restoreStaticPrefixSnapshot(ctx, IDENTITY, NEVER_STOP);
      expect(outcome).toEqual({
        ok: false,
        stem,
        reason: `meta_mismatch:${field}`,
        deleted: true,
      });
      expect(ctx.loadSession).not.toHaveBeenCalled();
      expect(mockStore.files.has(sessionFilePath(stem))).toBe(false);
    }
  });

  test("a crash-left .bak is promoted and restored", async () => {
    // Kill between the bak-rename and the tmp move leaves only the .bak: the
    // previous good file. Without promoteSessionBak the app recomputes a
    // 40 s prefill it already has on disk.
    const stem = stemFor(IDENTITY.prefixHash);
    mockStore.files.set(`${sessionFilePath(stem)}.bak`, 12_600_000);
    await putSnapshotMeta(IDENTITY);
    const ctx = {
      loadSession: jest.fn(async () => ({ tokens_loaded: PREFIX_TOKENS })),
    };
    const outcome = await restoreStaticPrefixSnapshot(ctx, IDENTITY, NEVER_STOP);
    expect(outcome).toEqual({ ok: true, stem, tokensLoaded: PREFIX_TOKENS });
    expect(mockStore.files.has(sessionFilePath(stem))).toBe(true);
  });

  test("an orphan .tmp from a killed write is swept on restore", async () => {
    // sweepStaleSidecars only runs from a save, and the snapshot's save may
    // not run again for hours: a 12.6 MB orphan would sit there counted
    // against the pool's byte accounting.
    const stem = putSnapshotFile(IDENTITY);
    await putSnapshotMeta(IDENTITY);
    mockStore.files.set(`${sessionFilePath(stem)}.tmp`, 12_600_000);
    const ctx = {
      loadSession: jest.fn(async () => ({ tokens_loaded: PREFIX_TOKENS })),
    };
    await restoreStaticPrefixSnapshot(ctx, IDENTITY, NEVER_STOP);
    expect(mockStore.files.has(`${sessionFilePath(stem)}.tmp`)).toBe(false);
  });
});

describe("saveStaticPrefixSnapshot", () => {
  /**
   * Native saveSession does NOT strip the scheme (llama.rn/src/index.ts:658 —
   * only loadSession does, at :653), so a `file://` URI reaching it is a path
   * the OS cannot open and every save fails on device. The mock therefore
   * REFUSES a URI instead of quietly accepting one: a mock that re-adds the
   * scheme makes the production `.replace(/^file:\/\//, "")` deletable with
   * the whole suite still green.
   */
  function ctxSave(tokens: number, bytes = 12_600_000) {
    return {
      saveSession: jest.fn(async (nativePath: string) => {
        if (nativePath.startsWith("file://")) {
          throw new Error(`saveSession got a URI, not a path: ${nativePath}`);
        }
        mockStore.files.set(`file://${nativePath}`, bytes);
        return tokens;
      }),
    };
  }

  test("happy path: tmp write, meta, and stale-identity variants evicted", async () => {
    // A dead variant from a previous prefix identity must not survive.
    const staleStem = stemFor("pfx0");
    mockStore.files.set(sessionFilePath(staleStem), 12_000_000);
    await AsyncStorage.setItem(
      sessionMetaKey(staleStem),
      JSON.stringify(expectedStaticPrefixMeta(IDENTITY)),
    );
    const ctx = ctxSave(PREFIX_TOKENS);
    const outcome = await saveStaticPrefixSnapshot({
      ctx,
      identity: IDENTITY,
      prefixTokens: PREFIX_TOKENS,
      bytesPerToken: null,
    });
    expect(outcome.ok).toBe(true);
    const stem = outcome.ok ? outcome.stem : "";
    expect(mockStore.files.has(sessionFilePath(stem))).toBe(true);
    expect(mockStore.files.has(`${sessionFilePath(stem)}.tmp`)).toBe(false);
    expect(mockStore.files.has(`${sessionFilePath(stem)}.bak`)).toBe(false);
    // The reserved-conversation variant with a different env hash is gone.
    expect(mockStore.files.has(sessionFilePath(staleStem))).toBe(false);
    expect(mockStore.kv.has(sessionMetaKey(staleStem))).toBe(false);
  });

  test("native save covering fewer tokens than the prefix is refused, tmp dropped", async () => {
    const ctx = ctxSave(100);
    const outcome = await saveStaticPrefixSnapshot({
      ctx,
      identity: IDENTITY,
      prefixTokens: PREFIX_TOKENS,
      bytesPerToken: null,
    });
    expect(outcome).toEqual({
      ok: false,
      stem: stemFor(IDENTITY.prefixHash),
      reason: "native_shorter_than_prefix",
    });
    const stem = outcome.stem ?? "";
    expect(mockStore.files.has(`${sessionFilePath(stem)}.tmp`)).toBe(false);
    expect(mockStore.files.has(sessionFilePath(stem))).toBe(false);
  });

  test("a failed move restores the previous good file", async () => {
    const stem = putSnapshotFile(IDENTITY);
    await putSnapshotMeta(IDENTITY);
    const ctx = ctxSave(PREFIX_TOKENS);
    // The first move is the previous-file → bak rename; fail the SECOND one
    // (tmp → path) so the bak dance must restore.
    const { moveAsync } = jest.requireMock("expo-file-system/legacy") as {
      moveAsync: jest.Mock;
    };
    // NOT mockRestore(): on a jest.mock factory that deletes the
    // implementation entirely, so every later test gets a moveAsync that
    // resolves undefined and moves nothing — a false-passing save.
    const realMove = moveAsync.getMockImplementation();
    let moveCount = 0;
    moveAsync.mockImplementation(async ({ from, to }: { from: string; to: string }) => {
      moveCount += 1;
      if (moveCount === 2) throw new Error("disk busy");
      const size = mockStore.files.get(from);
      if (size === undefined) throw new Error(`missing ${from}`);
      mockStore.files.delete(from);
      mockStore.files.set(to, size);
    });
    const outcome = await saveStaticPrefixSnapshot({
      ctx,
      identity: IDENTITY,
      prefixTokens: PREFIX_TOKENS,
      bytesPerToken: null,
    });
    moveAsync.mockImplementation(realMove!);
    expect(outcome.ok).toBe(false);
    // The previous snapshot file is back on disk.
    expect(mockStore.files.has(sessionFilePath(stem))).toBe(true);
  });

  test("exactly one snapshot survives, across models too", async () => {
    // pickEvictionStems deliberately does not charge the snapshot to the
    // conversation budget (it and the user's chats were evicting each other),
    // so THIS is the entire size bound. A snapshot for a model we no longer
    // run can never be restored, only refused.
    const otherModel = staticPrefixStem("qwen3.5-4b", "pfx9") ?? "";
    mockStore.files.set(sessionFilePath(otherModel), 12_000_000);
    await AsyncStorage.setItem(
      sessionMetaKey(otherModel),
      JSON.stringify(expectedStaticPrefixMeta(IDENTITY)),
    );
    const outcome = await saveStaticPrefixSnapshot({
      ctx: ctxSave(PREFIX_TOKENS),
      identity: IDENTITY,
      prefixTokens: PREFIX_TOKENS,
      bytesPerToken: null,
    });
    expect(outcome.ok).toBe(true);
    expect(mockStore.files.has(sessionFilePath(otherModel))).toBe(false);
  });

  test("reports the bytes written, so the write can calibrate the disk gate", async () => {
    // 1832 tokens is far above SESSION_CALIBRATION_MIN_TOKENS: this write
    // measures the model's real bytes/token. Dropping it leaves a model with
    // no catalog kvBytesPerToken stuck on the 64 KiB dense ceiling, and a
    // rate is only ever learned from a write that SUCCEEDED.
    const outcome = await saveStaticPrefixSnapshot({
      ctx: ctxSave(PREFIX_TOKENS, 12_584_332),
      identity: IDENTITY,
      prefixTokens: PREFIX_TOKENS,
      bytesPerToken: null,
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.fileBytes).toBe(12_584_332);
  });

  test("a write that leaves nothing on disk is reported as a failure", async () => {
    // The move resolves but the destination never appears (a filesystem that
    // lies, or a sweep landing in between). Returning ok:true here would log
    // KALSA_PREWARM snapshot_save ok:true for a file that is not there, and
    // the next cold 40 s prefill would be mis-attributed in campaign data.
    const { moveAsync } = jest.requireMock("expo-file-system/legacy") as {
      moveAsync: jest.Mock;
    };
    const realMove = moveAsync.getMockImplementation();
    moveAsync.mockImplementation(async ({ from }: { from: string }) => {
      mockStore.files.delete(from);
    });
    const outcome = await saveStaticPrefixSnapshot({
      ctx: ctxSave(PREFIX_TOKENS),
      identity: IDENTITY,
      prefixTokens: PREFIX_TOKENS,
      bytesPerToken: null,
    });
    moveAsync.mockImplementation(realMove!);
    expect(outcome).toEqual({
      ok: false,
      stem: stemFor(IDENTITY.prefixHash),
      reason: "gone_after_write",
    });
  });

  test("refuses when the disk gate says there is no room", async () => {
    const { getFreeDiskStorageAsync } = jest.requireMock(
      "expo-file-system/legacy",
    ) as { getFreeDiskStorageAsync: jest.Mock };
    const realFree = getFreeDiskStorageAsync.getMockImplementation();
    getFreeDiskStorageAsync.mockImplementation(async () => 1024);
    const ctx = ctxSave(PREFIX_TOKENS);
    const outcome = await saveStaticPrefixSnapshot({
      ctx,
      identity: IDENTITY,
      prefixTokens: PREFIX_TOKENS,
      bytesPerToken: 6672,
    });
    getFreeDiskStorageAsync.mockImplementation(realFree!);
    expect(outcome).toEqual({
      ok: false,
      stem: stemFor(IDENTITY.prefixHash),
      reason: "disk",
    });
    // The gate must refuse BEFORE the native write, not after.
    expect(ctx.saveSession).not.toHaveBeenCalled();
  });
});
