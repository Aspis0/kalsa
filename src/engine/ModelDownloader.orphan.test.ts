/**
 * Orphan-sweep unit tests — pure logic only, no React Native / FileSystem.
 *
 * sweepOrphanModelDirs() touches the FS (readDirectoryAsync / deleteAsync) and
 * is therefore hard to test under the Node jest environment. Its core decision
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
}));

import { MODEL_REGISTRY, WHISPER_MODEL, EMBEDDING_MODEL } from "./ModelRegistry";
import { listOrphanModelDirNames } from "./ModelDownloader";

/** Mirrors the production keep set: catalog + standalone whisper/embedding. */
function catalogKeepIds(): ReadonlySet<string> {
  const ids = new Set<string>([WHISPER_MODEL.id, EMBEDDING_MODEL.id]);
  for (const model of MODEL_REGISTRY) ids.add(model.id);
  return ids;
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