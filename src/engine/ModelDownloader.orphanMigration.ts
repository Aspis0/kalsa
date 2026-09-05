/**
 * Orphan-model migration (M1) — detect-only, never delete on its own.
 *
 * Replaces the old `sweepOrphanModelDirs()` boot delete. When the catalog prunes
 * a model, its on-disk folder + resume blobs survive with no UI delete path — a
 * disk leak. Instead of deleting at boot, we DETECT the orphans at boot, persist
 * them under a versioned AsyncStorage key, and surface a one-time
 * "Delete / Keep" notice in Settings. The currently selected model is never
 * flagged. Autonomous boot deletion is gone.
 *
 * The pure helpers here (filtering, state shape, keep-set bookkeeping) are unit
 * tested without React Native; the FS/AsyncStorage helpers are exercised with the
 * same stubs as the existing orphan test.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";

import { MODEL_REGISTRY, WHISPER_MODEL, EMBEDDING_MODEL } from "./ModelRegistry";
import type { ModelInfo } from "./ModelRegistry";
import {
  catalogKeepIds,
  clearOrphanResumeKeys,
  listOrphanModelDirNames,
  MODELS_DIR,
} from "./ModelDownloader";

/** Versioned key for the pending (undecided) orphan migration payload. */
export const ORPHAN_MIGRATION_STORAGE_KEY = "kalsa.models.orphanMigration.v1";
/** Versioned key for ids the user chose to KEEP (so we never re-prompt). */
export const ORPHAN_KEEP_STORAGE_KEY = "kalsa.models.orphanKeep.v1";

export type OrphanMigrationVersion = 1;

export type PendingOrphanMigration = {
  version: OrphanMigrationVersion;
  /** Orphaned model directory names (model ids) awaiting a user decision. */
  orphans: string[];
  /** Best-effort total size of those dirs, for the UI. May be undefined. */
  sizeBytes?: number;
};

/**
 * Orphaned model directory names that are NOT the currently selected model.
 *
 * The selected model's folder is never flagged: deleting it out from under the
 * active engine would break the app. The user must re-select another model
 * first; only then does its id stop being excluded. Pure and FS-free.
 */
export function filterOrphansExcludingSelected(
  orphans: readonly string[],
  selectedModelId: string | null | undefined,
): string[] {
  if (!selectedModelId) return [...orphans];
  return orphans.filter((id) => id !== selectedModelId);
}

/** Persisted keep-set: ids the user already chose to Keep. */
export async function loadKeptOrphanIds(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(ORPHAN_KEEP_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.orphans)) {
      return new Set();
    }
    return new Set(parsed.orphans.filter((id: unknown): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}

export async function rememberKeptOrphanIds(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    await AsyncStorage.setItem(ORPHAN_KEEP_STORAGE_KEY, JSON.stringify({ orphans: [...ids] }));
  } catch {
    // Best-effort: a failed remember just means we may re-prompt once.
  }
}

export async function loadPendingOrphanMigration(): Promise<PendingOrphanMigration | null> {
  try {
    const raw = await AsyncStorage.getItem(ORPHAN_MIGRATION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingOrphanMigration>;
    if (
      !parsed ||
      parsed.version !== 1 ||
      !Array.isArray(parsed.orphans) ||
      parsed.orphans.length === 0
    ) {
      return null;
    }
    const sizeBytes =
      typeof parsed.sizeBytes === "number" && Number.isFinite(parsed.sizeBytes)
        ? parsed.sizeBytes
        : undefined;
    return { version: 1, orphans: [...parsed.orphans], sizeBytes };
  } catch {
    return null;
  }
}

export async function savePendingOrphanMigration(
  migration: PendingOrphanMigration,
): Promise<void> {
  if (migration.orphans.length === 0) {
    await clearPendingOrphanMigration();
    return;
  }
  try {
    await AsyncStorage.setItem(
      ORPHAN_MIGRATION_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        orphans: [...migration.orphans],
        ...(migration.sizeBytes != null ? { sizeBytes: migration.sizeBytes } : {}),
      }),
    );
  } catch {
    // Best-effort: nothing persisted means the notice simply won't show.
  }
}

export async function clearPendingOrphanMigration(): Promise<void> {
  try {
    await AsyncStorage.removeItem(ORPHAN_MIGRATION_STORAGE_KEY);
  } catch {
    // Best-effort.
  }
}

/**
 * Best-effort total size of the given orphan dirs. Sums on-disk directory
 * sizes where available, falling back to the registry's declared sizeBytes.
 * Never throws — returns 0 when size cannot be determined.
 */
export async function estimateOrphanSizeBytes(orphans: readonly string[]): Promise<number> {
  let total = 0;
  for (const id of orphans) {
    const target = `${MODELS_DIR}${id}`;
    try {
      const info = await FileSystem.getInfoAsync(target);
      if (info.exists) {
        if (info.size && info.size > 0) {
          total += info.size;
          continue;
        }
      }
    } catch {
      // Fall through to registry fallback.
    }
    const registryEntry: ModelInfo | undefined = MODEL_REGISTRY.find((m) => m.id === id);
    if (registryEntry) {
      total += registryEntry.sizeBytes + (registryEntry.mmproj?.sizeBytes ?? 0);
    }
  }
  return total;
}

/**
 * Boot detection path. Replaces the old synchronous boot delete.
 *
 * Reads the models dir, lists orphans, excludes the currently selected model and
 * ids the user already chose to Keep, and — if anything remains — persists a
 * `PendingOrphanMigration` for the UI. Never deletes anything. Returns the
 * persisted payload (or null when there is nothing to decide).
 */
export async function detectOrphansAtBoot(
  selectedModelId: string | null | undefined,
): Promise<PendingOrphanMigration | null> {
  const keepIds = catalogKeepIds();
  const kept = await loadKeptOrphanIds();

  let names: string[];
  try {
    names = await FileSystem.readDirectoryAsync(MODELS_DIR);
  } catch {
    return null;
  }

  const orphans = listOrphanModelDirNames(names, keepIds);
  // Never flag the active model; never re-prompt for ids the user already kept.
  const pending = filterOrphansExcludingSelected(orphans, selectedModelId).filter(
    (id) => !kept.has(id),
  );

  if (pending.length === 0) {
    await clearPendingOrphanMigration();
    return null;
  }

  const sizeBytes = await estimateOrphanSizeBytes(pending);
  const migration: PendingOrphanMigration = {
    version: 1,
    orphans: pending,
    ...(sizeBytes > 0 ? { sizeBytes } : {}),
  };
  await savePendingOrphanMigration(migration);
  return migration;
}

/**
 * Delete outcome: remove the given orphan dirs (best-effort) and clear their
 * resume blobs, then drop the pending migration. Reuses the existing resume-key
 * cleanup. Never throws to the caller.
 */
export async function deleteOrphanDirs(orphans: readonly string[]): Promise<void> {
  const keepIds = catalogKeepIds();
  for (const id of orphans) {
    // Skip the selected model defensively (the UI should never offer to delete it).
    if (keepIds.has(id)) continue;
    const target = `${MODELS_DIR}${id}`;
    try {
      const info = await FileSystem.getInfoAsync(target);
      if (info.exists && info.isDirectory === true) {
        await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => undefined);
      }
    } catch {
      // Best-effort: skip this orphan and continue.
    }
    await clearOrphanResumeKeys(id);
  }
  await clearPendingOrphanMigration();
}