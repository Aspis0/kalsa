/**
 * Orphan-sweep unit tests — pure logic only, no React Native / FileSystem.
 *
 * sweepOrphanModelDirs() touched the FS (readDirectoryAsync / deleteAsync) and
 * was therefore hard to test under the Node jest environment. Its core decision
 * — "which models/<id>/ subdirs no longer belong in the catalog" — lives in the
 * pure listOrphanModelDirNames(), which is what these tests pin.
 *
 * The module under test imports expo-file-system/legacy (ESM source). Jest does
 * not transform node_modules, so we stub that module exactly like the existing
 * ModelDownloader.test.ts to keep this suite RN-free.
 */

jest.mock("expo-file-system/legacy", () => ({
  __esModule: true,
  documentDirectory: "file:///kalsa/",
  readDirectoryAsync: jest.fn(),
  getInfoAsync: jest.fn(),
  deleteAsync: jest.fn(),
}));

jest.mock("@react-native-async-storage/async-storage", () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: Object.assign(
      {
        getItem: jest.fn(async (key: string) => store.get(key) ?? null),
        setItem: jest.fn(async (key: string, value: string) => {
          store.set(key, value);
        }),
        removeItem: jest.fn(async (key: string) => {
          store.delete(key);
        }),
        getAllKeys: jest.fn(async () => [...store.keys()]),
      },
      // Test-only handle to the backing Map (not shipped in the mock).
      { __store: store },
    ),
  };
});

import AsyncStorage from "@react-native-async-storage/async-storage";
import { MODEL_REGISTRY, WHISPER_MODEL, EMBEDDING_MODEL } from "./ModelRegistry";
import { listOrphanModelDirNames } from "./ModelDownloader";
import {
  clearPendingOrphanMigration,
  deleteOrphanDirs,
  detectOrphansAtBoot,
  filterOrphansExcludingSelected,
  loadKeptOrphanIds,
  loadPendingOrphanMigration,
  rememberKeptOrphanIds,
  type PendingOrphanMigration,
} from "./ModelDownloader.orphanMigration";
import * as FileSystem from "expo-file-system/legacy";

const readDirectoryAsync = FileSystem.readDirectoryAsync as unknown as jest.Mock;
const getInfoAsync = FileSystem.getInfoAsync as unknown as jest.Mock;
const deleteAsync = FileSystem.deleteAsync as unknown as jest.Mock;

/** The in-memory AsyncStorage Map, for assertions. */
function backingStore(): Map<string, string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (AsyncStorage as unknown as { __store: Map<string, string> }).__store;
}

/** Catalog ids that legitimately own a folder (mirrors catalogKeepIds). */
function catalogKeepIds(): ReadonlySet<string> {
  const ids = new Set<string>([WHISPER_MODEL.id, EMBEDDING_MODEL.id]);
  for (const model of MODEL_REGISTRY) ids.add(model.id);
  return ids;
}

/** Reset all mocked FS + AsyncStorage state between tests. */
function resetMocks(): void {
  backingStore().clear();
  readDirectoryAsync.mockReset();
  getInfoAsync.mockReset();
  deleteAsync.mockReset();
  readDirectoryAsync.mockResolvedValue([]);
  getInfoAsync.mockReturnValue({ exists: false });
  deleteAsync.mockResolvedValue(undefined);
}

describe("listOrphanModelDirNames (M1)", () => {
  const keepIds = catalogKeepIds();

  it("returns nothing for an empty or already-clean models dir", () => {
    expect(listOrphanModelDirNames([], keepIds)).toEqual([]);
    expect(
      listOrphanModelDirNames([MODEL_REGISTRY[0]!.id, WHISPER_MODEL.id], keepIds),
    ).toEqual([]);
  });

  it("keeps every live catalog id plus standalone whisper / embedding", () => {
    const kept = [
      ...MODEL_REGISTRY.map((m) => m.id),
      WHISPER_MODEL.id,
      EMBEDDING_MODEL.id,
    ];
    const orphans = listOrphanModelDirNames(kept, keepIds);
    expect(orphans).toHaveLength(0);
  });

  it("flags pruned-model folders (no catalog entry) as orphans", () => {
    // These ids were in the catalog before the prune; none remain now.
    const dirNames = [
      MODEL_REGISTRY[0]!.id,
      "qwen3.5-2b",
      "gemma-4-e2b",
      "lfm25-8b-a1b",
      WHISPER_MODEL.id,
      EMBEDDING_MODEL.id,
    ];
    const orphans = listOrphanModelDirNames(dirNames, keepIds);
    expect(orphans.sort()).toEqual(["gemma-4-e2b", "lfm25-8b-a1b", "qwen3.5-2b"]);
  });

  it("does not treat a stray file name as a live model (see sweepOrphanModelDirs dir guard)", () => {
    // The pure helper cannot know on-disk type; sweepOrphanModelDirs only deletes
    // entries where getInfoAsync(...).isDirectory === true. A non-dir stray name
    // that is not a catalog id is still reported here and filtered by that guard.
    const dirNames = ["qwen3.5-4b", ".DS_Store"];
    expect(listOrphanModelDirNames(dirNames, keepIds)).toEqual([".DS_Store"]);
  });
});

describe("filterOrphansExcludingSelected (M1)", () => {
  const keepIds = catalogKeepIds();
  const orphanNames = ["qwen3.5-2b", "gemma-4-e2b", "lfm25-8b-a1b"];

  it("returns all orphans when no model is selected", () => {
    expect(filterOrphansExcludingSelected(orphanNames, null)).toEqual(orphanNames);
    expect(filterOrphansExcludingSelected(orphanNames, undefined)).toEqual(orphanNames);
  });

  it("never flags the currently selected id", () => {
    const selected = "qwen3.5-2b";
    expect(filterOrphansExcludingSelected(orphanNames, selected)).toEqual([
      "gemma-4-e2b",
      "lfm25-8b-a1b",
    ]);
  });

  it("still flags every other orphan when one is selected", () => {
    expect(filterOrphansExcludingSelected(orphanNames, EMBEDDING_MODEL.id)).toEqual(orphanNames);
  });

  it("does not flag a selected id that is itself a catalog id (no-op filter)", () => {
    const live = MODEL_REGISTRY[0]!.id;
    expect(filterOrphansExcludingSelected([live, "qwen3.5-2b"], live)).toEqual(["qwen3.5-2b"]);
  });
});

// ── Orphan migration: detect-only persistence + both outcomes ────────────────
describe("orphan migration persistence (detect-only, no delete)", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("detectOrphansAtBoot persists a pending migration (never deletes)", async () => {
    readDirectoryAsync.mockResolvedValue(["qwen3.5-2b", "gemma-4-e2b", WHISPER_MODEL.id]);

    const migration = await detectOrphansAtBoot(MODEL_REGISTRY[0]!.id);

    expect(migration).not.toBeNull();
    expect(migration!.orphans.sort()).toEqual(["gemma-4-e2b", "qwen3.5-2b"]);
    // The currently selected catalog id is never flagged.
    expect(migration!.orphans).not.toContain(MODEL_REGISTRY[0]!.id);
    // Nothing was deleted — the whole point of the migration.
    expect(deleteAsync).not.toHaveBeenCalled();

    // And it is persisted under the versioned key for the UI.
    const persisted = await loadPendingOrphanMigration();
    expect(persisted).not.toBeNull();
    expect(persisted!.orphans.sort()).toEqual(["gemma-4-e2b", "qwen3.5-2b"]);
  });

  it("clears a stale pending migration when nothing is undecided", async () => {
    readDirectoryAsync.mockResolvedValue([MODEL_REGISTRY[0]!.id, WHISPER_MODEL.id]);

    const migration = await detectOrphansAtBoot(MODEL_REGISTRY[0]!.id);
    expect(migration).toBeNull();
    expect(await loadPendingOrphanMigration()).toBeNull();
  });

  it("KEEP: remembers ids so we never re-prompt, leaves files", async () => {
    readDirectoryAsync.mockResolvedValue(["qwen3.5-2b", "gemma-4-e2b"]);
    const migration = await detectOrphansAtBoot(MODEL_REGISTRY[0]!.id);
    expect(migration).not.toBeNull();

    // User clicks Keep.
    await rememberKeptOrphanIds(migration!.orphans);
    await clearPendingOrphanMigration();

    expect(await loadKeptOrphanIds()).toEqual(new Set(migration!.orphans));
    // Next boot must not re-prompt for the kept ids and must not re-persist.
    const next = await detectOrphansAtBoot(MODEL_REGISTRY[0]!.id);
    expect(next).toBeNull();
    // Files were left untouched.
    expect(deleteAsync).not.toHaveBeenCalled();
  });

  it("DELETE: removes those dirs + resume keys and clears the pending migration", async () => {
    readDirectoryAsync.mockResolvedValue(["qwen3.5-2b", "gemma-4-e2b"]);
    const migration = await detectOrphansAtBoot(MODEL_REGISTRY[0]!.id);
    expect(migration).not.toBeNull();

    getInfoAsync.mockImplementation(async () => ({
      exists: true,
      isDirectory: true,
      size: 1234,
    }));

    await deleteOrphanDirs(migration!.orphans);

    // Both orphan dirs were deleted (dir guard: isDirectory === true).
    const deletedTargets = deleteAsync.mock.calls.map((c) => c[0] as string);
    for (const id of migration!.orphans) {
      expect(deletedTargets).toContain(`file:///kalsa/models/${id}`);
    }
    // Pending migration cleared.
    expect(await loadPendingOrphanMigration()).toBeNull();
  });

  it("keeps the currently selected model dir on DELETE (defensive)", async () => {
    readDirectoryAsync.mockResolvedValue([]);
    getInfoAsync.mockImplementation(async () => ({
      exists: true,
      isDirectory: true,
      size: 1234,
    }));

    // Deleting the selected id directly must skip it (guarded by catalogKeepIds).
    await deleteOrphanDirs([MODEL_REGISTRY[0]!.id]);
    const deletedTargets = deleteAsync.mock.calls.map((c) => c[0] as string);
    expect(deletedTargets).not.toContain(`file:///kalsa/models/${MODEL_REGISTRY[0]!.id}`);
  });
});