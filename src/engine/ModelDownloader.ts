import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";

import { getStrings, type Locale } from "../i18n";
import { MODEL_REGISTRY, WHISPER_MODEL, EMBEDDING_MODEL } from "./ModelRegistry";
import type { ModelInfo, ModelFileSpec } from "./ModelRegistry";
import type { ModelGateVerdict } from "./deviceProfile";
import { resolveModelArtifact } from "./modelHost";

/**
 * Download bundle modelli (GGUF + mmproj vision) da HuggingFace con:
 * - URL pinnati alla revision del repo (immutabili)
 * - progresso reale (throttled) e resume per FILE (savable()/AsyncStorage)
 * - abort pulito per fase (pauseAsync → stato salvato → niente init su file parziale)
 * - validazione dimensione ESATTA per ogni file
 */

const MODELS_DIR = `${FileSystem.documentDirectory ?? ""}models/`;
const RESUME_KEY_PREFIX = "kalsa.download.resume.";

export type DownloadProgress = {
  bytesReceived: number;
  bytesTotal: number;
  progress: number; // 0..1
};

export type DownloadOutcome =
  | { status: "done"; uri: string }
  | { status: "aborted" };

export type BundleProgress = {
  modelProgress: DownloadProgress;
  mmprojProgress?: DownloadProgress;
  /** progresso aggregato (modello+mmproj pesati sui byte) */
  overall: number;
};

export type DownloadOptions = {
  onProgress?: (progress: DownloadProgress) => void;
  onBundleProgress?: (progress: BundleProgress) => void;
  signal?: AbortSignal;
  /** Settings locale for user-facing download errors (required). */
  locale: Locale;
  /** Caller-computed hard gate; blocked bundles never reach downloadFile. */
  gate?: ModelGateVerdict;
};

class UnpublishedArtifactError extends Error {
  constructor(readonly artifact: string) {
    super(`Kalsa artifact is unpublished: ${artifact}`);
    this.name = "UnpublishedArtifactError";
  }
}

export function modelLocalPath(model: ModelInfo, file: string): string {
  // Directory per modello: niente collisioni tra revisioni/condivisione mmproj.
  return `${MODELS_DIR}${model.id}/${file}`;
}

export function hfFileUrl(model: ModelInfo, file: string, spec?: ModelFileSpec): string {
  const resolution = resolveModelArtifact(model, spec);
  if (resolution.status === "unpublished") {
    throw new UnpublishedArtifactError(resolution.artifact);
  }
  const { hfRepo: repo, revision } = resolution;
  const [owner, repoName] = repo.split("/").map((part) => encodeURIComponent(part));
  return `https://huggingface.co/${owner}/${repoName}/resolve/${revision}/${encodeURIComponent(file)}`;
}

export async function ensureModelsDir(model: ModelInfo): Promise<void> {
  await FileSystem.makeDirectoryAsync(`${MODELS_DIR}${model.id}`, { intermediates: true });
}

/** Vero solo se il file esiste con la dimensione ESATTA. */
export async function isFileComplete(target: string, sizeBytes: number): Promise<boolean> {
  const info = await FileSystem.getInfoAsync(target);
  return info.exists && (info.size ?? 0) === sizeBytes;
}

export async function isModelBundleDownloaded(model: ModelInfo): Promise<boolean> {
  if (!(await isFileComplete(modelLocalPath(model, model.file), model.sizeBytes))) return false;
  if (model.mmproj) {
    return isFileComplete(modelLocalPath(model, model.mmproj.file), model.mmproj.sizeBytes);
  }
  return true;
}

function resumeKeyFor(model: ModelInfo, file: string, spec?: ModelFileSpec): string {
  // Revision-aware: un resume di una revisione diversa non deve essere riusato.
  const revision = spec?.revision ?? model.revision;
  return `${RESUME_KEY_PREFIX}${model.id}.${revision}.${file}`;
}

const PROGRESS_THROTTLE_MS = 200;
// Nessun progresso per 90s → download bloccato. Alzato da 30s: reti mobili (e in
// particolare MIUI/Xiaomi con power management aggressivo) hanno stalli brevi e
// legittimi che con 30s facevano scattare retry/pause inutili.
const STALL_TIMEOUT_MS = 90_000;

export type FriendlyErrorFallback = "raw" | "engine" | "download";

/**
 * Normalizza errori di rete / storage / engine in messaggi localizzati.
 * `fallback` sceglie cosa restituire se nessun pattern noto matcha.
 */
export function friendlyNetworkError(
  error: unknown,
  locale: Locale,
  fallback: FriendlyErrorFallback = "raw",
): Error {
  const strings = getStrings(locale);
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof UnpublishedArtifactError) {
    return new Error(strings.errors.artifactUnpublished.replace("{artifact}", error.artifact));
  }
  const unpublishedPrefix = strings.errors.artifactUnpublished.split("{artifact}")[0];
  if (message.startsWith(unpublishedPrefix)) {
    return error instanceof Error ? error : new Error(message);
  }
  if (/connection abort|socket|ECONNRESET|timed? ?out|timeout/i.test(message)) {
    return new Error(strings.errors.connectionLost);
  }
  if (/failed to connect|unreachable|no route|network is unreachable/i.test(message)) {
    return new Error(strings.errors.networkUnreachable);
  }
  if (/ENOENT|EACCES|ENOSPC|EPERM|no such file|permission denied|not enough space|disk full|filesystem/i.test(message)) {
    return new Error(strings.errors.storageFailed);
  }
  // Already localized by our own code paths — keep as-is.
  const known = new Set([
    strings.errors.connectionLost,
    strings.errors.networkUnreachable,
    strings.errors.storageFailed,
    strings.errors.engineInitFailed,
    strings.errors.visionInitFailed,
    strings.errors.visionNotSupported,
    strings.errors.modelNotLoaded,
    strings.download.failed,
    strings.download.stalled,
  ]);
  if (known.has(message) || message.startsWith(strings.download.incompleteBytes.split("(")[0])) {
    return error instanceof Error ? error : new Error(message);
  }
  if (fallback === "engine") return new Error(strings.errors.engineInitFailed);
  if (fallback === "download") return new Error(strings.download.failed);
  return error instanceof Error ? error : new Error(message);
}

async function downloadFile(
  model: ModelInfo,
  file: ModelFileSpec,
  options: DownloadOptions,
  onProgress: (progress: DownloadProgress) => void,
): Promise<DownloadOutcome> {
  const locale = options.locale;
  const strings = getStrings(locale);
  if (options.signal?.aborted) return { status: "aborted" };
  await ensureModelsDir(model);
  if (options.signal?.aborted) return { status: "aborted" };

  const target = modelLocalPath(model, file.file);
  const resumeKey = resumeKeyFor(model, file.file, file);

  // Complete file: never re-download or touch stale resume data.
  if (await isFileComplete(target, file.sizeBytes)) {
    await AsyncStorage.removeItem(resumeKey).catch(() => undefined);
    onProgress({
      bytesReceived: file.sizeBytes,
      bytesTotal: file.sizeBytes,
      progress: 1,
    });
    return { status: "done", uri: target };
  }

  let saved = await AsyncStorage.getItem(resumeKey)
    .then((raw) => {
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : null;
      } catch {
        return null;
      }
    })
    .catch(() => null);

  // Resume corrotto: se totalBytesExpectedToWrite ≠ size del registry (>1%), scarta.
  // Altrimenti un expected sbagliato (es. 9.1MB) fa arrivare la barra al 100% su un file troncato
  // e al retry si riutilizza lo stesso resume → loop infinito.
  if (saved) {
    const expectedRaw = (saved as { totalBytesExpectedToWrite?: unknown }).totalBytesExpectedToWrite;
    const expected =
      typeof expectedRaw === "number" && Number.isFinite(expectedRaw) ? expectedRaw : 0;
    if (expected > 0 && file.sizeBytes > 0) {
      const delta = Math.abs(expected - file.sizeBytes) / file.sizeBytes;
      if (delta > 0.01) {
        await AsyncStorage.removeItem(resumeKey).catch(() => undefined);
        saved = null;
      }
    }
  }

  const buildTask = (resumeData?: string) =>
    FileSystem.createDownloadResumable(
      hfFileUrl(model, file.file, file),
      target,
      {},
      (progress) => {
        lastProgressAt = Date.now();
        lastBytesWritten = progress.totalBytesWritten;
        const now = Date.now();
        // Always use registry size for progress: server Content-Length can be wrong
        // (redirects/HTML error pages) and would falsely report 100% on a truncated file.
        const bytesTotal = file.sizeBytes;
        const isFinalChunk =
          bytesTotal > 0 && progress.totalBytesWritten >= bytesTotal;
        if (now - lastProgressEmit < PROGRESS_THROTTLE_MS && !isFinalChunk) return;
        lastProgressEmit = now;
        onProgress({
          bytesReceived: progress.totalBytesWritten,
          bytesTotal,
          progress: bytesTotal > 0 ? Math.min(1, progress.totalBytesWritten / bytesTotal) : 0,
        });
      },
      resumeData,
    );

  let lastProgressEmit = 0;
  let task: FileSystem.DownloadResumable;
  if (saved?.resumeData && typeof saved.resumeData === "string") {
    task = buildTask(saved.resumeData as string);
  } else {
    task = buildTask();
  }

  const onAbort = () => {
    if (pausing) return;
    pausing = true;
    void task
      .pauseAsync()
      .then((pauseState) => AsyncStorage.setItem(resumeKey, JSON.stringify(pauseState)))
      .catch(() => undefined);
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });

  // Watchdog anti-stallo: nessun progresso per STALL_TIMEOUT_MS → pausa ATTESA
  // (salva il resume reale) e lascia che downloadAsync si concluda.
  let lastProgressAt = Date.now();
  let lastBytesWritten = 0;
  let stalled = false;
  let retried = false;
  let pausing = false;
  const stallTimer = setInterval(() => {
    if (pausing) return;
    if (Date.now() - lastProgressAt > STALL_TIMEOUT_MS) {
      stalled = true;
      pausing = true;
      void (async () => {
        try {
          const pauseState = await task.pauseAsync();
          if (pauseState?.resumeData) {
            await AsyncStorage.setItem(resumeKey, JSON.stringify(pauseState));
          }
        } catch {
          // il task risolverà/rigetterà da solo
        }
      })();
    }
  }, 5_000);

  // Un solo tentativo di retry: ricrea il task dal resume SALVATO (dallo stall
  // o dall'abort) e ritenta. `savable()` non produce resumeData durante un
  // trasferimento attivo, quindi l'unico resume valido è quello di una pausa.
  const retryOnce = async (): Promise<FileSystem.FileSystemDownloadResult | undefined> => {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    // Un cancel atterrato nella finestra stallo→retry non deve far ripartire
    // un download multi-GB che poi arriva a fine corsa PRIMA di segnalare
    // l'abort: bail subito, prima di ricreare il task e avviarlo.
    if (options.signal?.aborted) return undefined;
    const savedNow = await AsyncStorage.getItem(resumeKey)
      .then((raw) => {
        if (!raw) return null;
        try {
          const parsed = JSON.parse(raw);
          return parsed && typeof parsed === "object" ? parsed : null;
        } catch {
          return null;
        }
      })
      .catch(() => null);
    stalled = false;
    // `pausing` è per-tentativo: senza reset, dopo il primo stallo il watchdog
    // resta disabilitato per sempre (early-return) e onAbort ignora il cancel
    // dell'utente in silenzio → un secondo stallo si blocca per sempre.
    pausing = false;
    // Il nuovo task riparte da zero progresso osservato: senza reset il
    // watchdog vedrebbe subito >STALL_TIMEOUT_MS (misurato dal tentativo
    // precedente) e ripauserebbe il task appena ricreato.
    lastProgressAt = Date.now();
    task = buildTask(
      typeof savedNow?.resumeData === "string" ? (savedNow.resumeData as string) : undefined,
    );
    return task.downloadAsync();
  };

  try {
    let result: FileSystem.FileSystemDownloadResult | undefined;
    try {
      result = await task.downloadAsync();
    } catch (error) {
      if (options.signal?.aborted) return { status: "aborted" };
      if (!retried) {
        retried = true;
        try {
          result = await retryOnce();
        } catch (retryError) {
          throw friendlyNetworkError(retryError, locale);
        }
      } else {
        throw friendlyNetworkError(error, locale);
      }
    }
    if (options.signal?.aborted) return { status: "aborted" };

    // downloadAsync risolve `undefined` quando il task viene pausato (stall):
    // in quel caso un retry non ancora fatto riprende dal resume salvato.
    if (!result?.uri && stalled && !retried) {
      retried = true;
      try {
        result = await retryOnce();
      } catch (retryError) {
        throw friendlyNetworkError(retryError, locale);
      }
      // Stesso check del path sopra: senza questo, un abort atterrato durante
      // il retry da stallo cade nel throw "stalled/failed" invece di riportare
      // correttamente {status:"aborted"}.
      if (options.signal?.aborted) return { status: "aborted" };
    }
    if (!result?.uri) {
      // Localized base text + bracket facts so AppShell's raw-detail path surfaces
      // why downloadAsync returned no URI (not just a duplicate "Download failed").
      const resumeSaved = !!(saved && typeof (saved as { resumeData?: unknown }).resumeData === "string");
      throw new Error(
        `${stalled ? strings.download.stalled : strings.download.failed} [no-uri, stalled=${stalled}, retried=${retried}, resumeSaved=${resumeSaved}, bytes=${lastBytesWritten}]`,
      );
    }

    // Dimensione ESATTA: un file diverso (parziale/corrotto) non passa mai.
    // Pulisci resume + file troncato PRIMA del throw, altrimenti il retry riusa
    // lo stesso resume corrotto e ricomincia il loop "100% → incomplete".
    const info = await FileSystem.getInfoAsync(target);
    if (!info.exists || (info.size ?? 0) !== file.sizeBytes) {
      await AsyncStorage.removeItem(resumeKey).catch(() => undefined);
      await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => undefined);
      throw new Error(
        strings.download.incompleteBytes
          .replace("{got}", String(info.exists ? (info.size ?? 0) : 0))
          .replace("{expected}", String(file.sizeBytes)),
      );
    }

    await AsyncStorage.removeItem(resumeKey).catch(() => undefined);
    return { status: "done", uri: result.uri };
  } finally {
    clearInterval(stallTimer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

/** Scarica GGUF + mmproj (se presente), con progresso aggregato. */
export async function downloadModelBundle(
  model: ModelInfo,
  options: DownloadOptions,
): Promise<{ model: DownloadOutcome; mmproj?: DownloadOutcome }> {
  if (options.gate?.allowed === false) {
    throw new Error(`model download blocked: ${options.gate.reason}`);
  }

  const modelResolution = resolveModelArtifact(model);
  if (modelResolution.status === "unpublished") {
    throw new UnpublishedArtifactError(modelResolution.artifact);
  }
  if (model.mmproj) {
    const mmprojResolution = resolveModelArtifact(model, model.mmproj);
    if (mmprojResolution.status === "unpublished") {
      throw new UnpublishedArtifactError(mmprojResolution.artifact);
    }
  }

  const mmprojTotal = model.mmproj ? model.mmproj.sizeBytes : 0;
  const totalBytes = model.sizeBytes + mmprojTotal;
  let modelBytes = 0;
  let mmprojBytes = 0;

  const emitBundle = () => {
    if (!options.onBundleProgress) return;
    const overall = totalBytes > 0 ? (modelBytes + mmprojBytes) / totalBytes : 0;
    options.onBundleProgress({
      modelProgress: {
        bytesReceived: modelBytes,
        bytesTotal: model.sizeBytes,
        progress: model.sizeBytes > 0 ? Math.min(1, modelBytes / model.sizeBytes) : 0,
      },
      ...(model.mmproj
        ? {
            mmprojProgress: {
              bytesReceived: mmprojBytes,
              bytesTotal: model.mmproj.sizeBytes,
              progress: model.mmproj.sizeBytes > 0 ? Math.min(1, mmprojBytes / model.mmproj.sizeBytes) : 0,
            },
          }
        : {}),
      overall: Math.min(1, overall),
    });
  };

  const modelOutcome = await downloadFile(model, { file: model.file, sizeBytes: model.sizeBytes }, options, (p) => {
    modelBytes = p.bytesReceived;
    emitBundle();
    options.onProgress?.(p);
  });

  if (modelOutcome.status === "aborted" || !model.mmproj) {
    return { model: modelOutcome };
  }

  const mmprojOutcome = await downloadFile(model, model.mmproj, options, (p) => {
    mmprojBytes = p.bytesReceived;
    emitBundle();
  });

  return { model: modelOutcome, mmproj: mmprojOutcome };
}

export async function deleteModelFiles(model: ModelInfo): Promise<void> {
  // La resume key va calcolata con lo STESSO spec usato in scrittura (vedi
  // downloadFile): per il mmproj questo è model.mmproj (revision propria,
  // spesso diversa da model.revision), non il fallback su model.revision.
  const entries: Array<{ file: string; spec?: ModelFileSpec }> = [
    { file: model.file },
    ...(model.mmproj ? [{ file: model.mmproj.file, spec: model.mmproj }] : []),
  ];
  for (const { file, spec } of entries) {
    await FileSystem.deleteAsync(modelLocalPath(model, file), { idempotent: true }).catch(() => undefined);
    await AsyncStorage.removeItem(resumeKeyFor(model, file, spec)).catch(() => undefined);
  }
}

// ── Orphan cleanup (catalog-prune disk leak, M1) ─────────────────────────────
/**
 * Orphan cleanup for catalog prunes.
 *
 * `MODELS_DIR/<id>/` holds one folder per downloaded model. When the catalog
 * prunes a model (see ModelRegistry), the on-disk folder and its resume blobs
 * survive with no UI delete path — a permanent disk leak (M1). `sweepOrphanModelDirs`
 * removes those folders at boot.
 *
 * The catalog ids that legitimately own a folder: every MODEL_REGISTRY entry
 * (chat LLMs) plus WHISPER_MODEL and EMBEDDING_MODEL, which are downloaded
 * through the same pipeline but are not part of the chat catalog list.
 */
function catalogKeepIds(): ReadonlySet<string> {
  const ids = new Set<string>([WHISPER_MODEL.id, EMBEDDING_MODEL.id]);
  for (const model of MODEL_REGISTRY) ids.add(model.id);
  return ids;
}

export type OrphanSweepResult = {
  /** Orphaned model directory names that were removed (best-effort). */
  removed: string[];
};

/**
 * Subdirectory names under MODELS_DIR whose id is not in the live catalog.
 * Pure and FS-free so it is unit-testable without React Native.
 *
 * `dirNames` are the raw entries returned by `readDirectoryAsync(MODELS_DIR)`
 * (each entry is a model id, since `modelLocalPath` is
 * `${MODELS_DIR}${model.id}/${file}`). `keepIds` is the set of catalog ids that
 * still own a folder. Anything else is an orphan left by a prune.
 */
export function listOrphanModelDirNames(
  dirNames: readonly string[],
  keepIds: ReadonlySet<string>,
): string[] {
  const orphan: string[] = [];
  for (const name of dirNames) {
    if (keepIds.has(name)) continue;
    orphan.push(name);
  }
  return orphan;
}

/**
 * Best-effort boot cleanup of orphaned model directories (M1). Removes any
 * `MODELS_DIR/<id>/` folder whose id is no longer in the catalog, plus its
 * persisted resume blobs. Never throws to the caller — a failed delete on one
 * orphan must not abort the sweep of the others.
 *
 * Fire-and-forget at app boot (see AppShell): it must not block UI.
 */
export async function sweepOrphanModelDirs(): Promise<OrphanSweepResult> {
  const keepIds = catalogKeepIds();

  // MODELS_DIR may be absent (fresh install, or documentDirectory empty). A
  // missing dir is not an error — nothing to sweep.
  let names: string[];
  try {
    names = await FileSystem.readDirectoryAsync(MODELS_DIR);
  } catch {
    return { removed: [] };
  }

  const orphans = listOrphanModelDirNames(names, keepIds);
  if (orphans.length === 0) return { removed: [] };

  const removed: string[] = [];
  for (const id of orphans) {
    const target = `${MODELS_DIR}${id}`;
    // Only ever remove directories: never a stray file that happens to sit
    // directly under MODELS_DIR, and never a live catalog id (guarded by
    // keepIds above).
    try {
      const info = await FileSystem.getInfoAsync(target);
      if (info.exists && info.isDirectory === true) {
        await FileSystem.deleteAsync(target, { idempotent: true }).catch(
          () => undefined,
        );
      }
    } catch {
      // Best-effort: skip this orphan and continue with the rest.
    }
    // Clear any resume blobs for the removed model (cheap, best-effort).
    await clearOrphanResumeKeys(id);
    removed.push(id);
  }
  return { removed };
}

/**
 * Remove persisted resume blobs whose model id no longer exists on disk.
 * Enumerate AsyncStorage keys and drop those matching
 * `kalsa.download.resume.<id>.…`. Best-effort: never throws.
 */
async function clearOrphanResumeKeys(orphanId: string): Promise<void> {
  // getAllKeys is optional on some AsyncStorage builds — bail cleanly if absent.
  if (
    typeof (AsyncStorage as { getAllKeys?: unknown }).getAllKeys !== "function"
  ) {
    return;
  }
  // Every resume key is written as `<prefix><id>.<revision>.<file>`, so the id
  // is always followed by a dot. Matching the trailing dot avoids clearing a
  // longer id that merely starts with this one.
  const prefix = `${RESUME_KEY_PREFIX}${orphanId}`;
  try {
    const keys = await AsyncStorage.getAllKeys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith(prefix))
        .map((key) => AsyncStorage.removeItem(key).catch(() => undefined)),
    );
  } catch {
    // Enumeration/clearing is best-effort here.
  }
}
