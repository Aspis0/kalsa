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
 * - verifica SHA-256 per gli artefatti che dichiarano un digest nel catalogo
 */

const MODELS_DIR = `${FileSystem.documentDirectory ?? ""}models/`;
export { MODELS_DIR };
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

export class Sha256VerificationUnavailableError extends Error {
  constructor() {
    super("SHA-256 verification unavailable");
    this.name = "Sha256VerificationUnavailableError";
  }
}

export class InvalidSha256DigestError extends Error {
  constructor() {
    super("SHA-256 verifier returned an invalid digest");
    this.name = "InvalidSha256DigestError";
  }
}

class IntegrityMismatchError extends Error {
  constructor() {
    super("SHA-256 integrity mismatch");
    this.name = "IntegrityMismatchError";
  }
}

const SHA256_MARKER_SUFFIX = ".sha256-ok";

export function modelLocalPath(model: ModelInfo, file: string): string {
  // Directory per modello: niente collisioni tra revisioni/condivisione mmproj.
  return `${MODELS_DIR}${model.id}/${file}`;
}

export function fileSpecFor(model: ModelInfo): ModelFileSpec {
  return {
    file: model.file,
    sizeBytes: model.sizeBytes,
    ...(model.sha256 ? { sha256: model.sha256 } : {}),
  };
}

export function sha256MarkerPath(target: string): string {
  return `${target}${SHA256_MARKER_SUFFIX}`;
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

export async function hasValidSha256Marker(target: string, expected?: string): Promise<boolean> {
  if (!expected) return true;
  const marker = sha256MarkerPath(target);
  const info = await FileSystem.getInfoAsync(marker);
  if (!info.exists) return false;
  try {
    const contents = await FileSystem.readAsStringAsync(marker);
    return contents.trim().toLowerCase() === expected.toLowerCase();
  } catch {
    return false;
  }
}

export async function fileMatchesSha256(target: string, expected?: string): Promise<boolean> {
  if (!expected) return true;
  if (!/^[0-9a-f]{64}$/i.test(expected)) {
    console.warn("[download] catalog contains an invalid SHA-256 digest", expected);
    throw new InvalidSha256DigestError();
  }
  let actual: string;
  try {
    // expo-file-system has no streaming digest; RNFS hashes Android in 10 KB chunks.
    // iOS reads the whole file, which is acceptable because Android is the target here.
    const { hash } = await import("react-native-fs");
    actual = await hash(target, "sha256");
  } catch (error) {
    console.warn("[download] SHA-256 verification unavailable", error);
    throw new Sha256VerificationUnavailableError();
  }
  if (typeof actual !== "string" || !/^[0-9a-f]{64}$/i.test(actual)) {
    console.warn("[download] SHA-256 verifier returned an invalid digest", actual);
    throw new InvalidSha256DigestError();
  }
  return actual.toLowerCase() === expected.toLowerCase();
}

export async function isVerifiedFile(target: string, file: ModelFileSpec): Promise<boolean> {
  return (await isFileComplete(target, file.sizeBytes)) &&
    (await hasValidSha256Marker(target, file.sha256));
}

export async function writeSha256Marker(target: string, expected?: string): Promise<void> {
  if (!expected) return;
  await FileSystem.writeAsStringAsync(sha256MarkerPath(target), expected.toLowerCase());
}

export async function isModelBundleDownloaded(model: ModelInfo): Promise<boolean> {
  if (!(await verifyFileForPresence(model, fileSpecFor(model)))) return false;
  if (model.mmproj) {
    return verifyFileForPresence(model, model.mmproj);
  }
  return true;
}

function resumeKeyFor(model: ModelInfo, file: string, spec?: ModelFileSpec): string {
  // Revision-aware: un resume di una revisione diversa non deve essere riusato.
  const revision = spec?.revision ?? model.revision;
  return `${RESUME_KEY_PREFIX}${model.id}.${revision}.${file}`;
}

async function discardDownloadedFile(
  target: string,
  resumeKey: string,
  expectedSha256?: string,
): Promise<void> {
  await AsyncStorage.removeItem(resumeKey).catch(() => undefined);
  await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => undefined);
  if (expectedSha256) {
    await FileSystem.deleteAsync(sha256MarkerPath(target), { idempotent: true }).catch(() => undefined);
  }
}

type CompleteFileVerification = "verified" | "mismatch" | "aborted";

async function verifyCompleteFile(
  target: string,
  file: ModelFileSpec,
  signal?: AbortSignal,
): Promise<CompleteFileVerification> {
  if (signal?.aborted) return "aborted";
  if (!file.sha256 || (await hasValidSha256Marker(target, file.sha256))) return "verified";
  if (!(await fileMatchesSha256(target, file.sha256))) return "mismatch";
  if (signal?.aborted) return "aborted";
  await writeSha256Marker(target, file.sha256);
  return signal?.aborted ? "aborted" : "verified";
}

async function verifyFileForPresence(model: ModelInfo, file: ModelFileSpec): Promise<boolean> {
  const target = modelLocalPath(model, file.file);
  if (!(await isFileComplete(target, file.sizeBytes))) return false;
  try {
    const verification = await verifyCompleteFile(target, file);
    if (verification === "mismatch") {
      await discardDownloadedFile(target, resumeKeyFor(model, file.file, file), file.sha256);
      return false;
    }
    return verification === "verified";
  } catch {
    return false;
  }
}

export async function finalizeDownloadedFile(
  target: string,
  file: ModelFileSpec,
  resumeKey: string,
  options: Pick<DownloadOptions, "locale" | "signal">,
): Promise<DownloadOutcome> {
  const strings = getStrings(options.locale);
  try {
    const verification = await verifyCompleteFile(target, file, options.signal);
    if (verification === "aborted") return { status: "aborted" };
    if (verification === "mismatch") {
      throw new IntegrityMismatchError();
    }
  } catch (error) {
    if (options.signal?.aborted) return { status: "aborted" };
    if (error instanceof IntegrityMismatchError) {
      await discardDownloadedFile(target, resumeKey, file.sha256);
      throw new Error(strings.download.integrityMismatch);
    }
    throw error;
  }
  if (options.signal?.aborted) return { status: "aborted" };
  await AsyncStorage.removeItem(resumeKey).catch(() => undefined);
  return { status: "done", uri: target };
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
  if (error instanceof Sha256VerificationUnavailableError || error instanceof InvalidSha256DigestError) {
    return error;
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
    strings.download.integrityMismatch,
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

  // Complete and sidecar-verified file: never re-download or touch stale resume data.
  const complete = await isFileComplete(target, file.sizeBytes);
  if (complete) {
    const verification = await verifyCompleteFile(target, file, options.signal);
    if (verification === "aborted") return { status: "aborted" };
    if (verification === "verified") {
      await AsyncStorage.removeItem(resumeKey).catch(() => undefined);
      onProgress({
        bytesReceived: file.sizeBytes,
        bytesTotal: file.sizeBytes,
        progress: 1,
      });
      return { status: "done", uri: target };
    }
    await discardDownloadedFile(target, resumeKey, file.sha256);
  } else if (file.sha256) {
    await FileSystem.deleteAsync(sha256MarkerPath(target), { idempotent: true }).catch(() => undefined);
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
      await discardDownloadedFile(target, resumeKey, file.sha256);
      throw new Error(
        strings.download.incompleteBytes
          .replace("{got}", String(info.exists ? (info.size ?? 0) : 0))
          .replace("{expected}", String(file.sizeBytes)),
      );
    }

    const finalized = await finalizeDownloadedFile(target, file, resumeKey, options);
    return finalized.status === "done" ? { status: "done", uri: result.uri } : finalized;
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

  const modelOutcome = await downloadFile(
    model,
    fileSpecFor(model),
    options,
    (p) => {
      modelBytes = p.bytesReceived;
      emitBundle();
      options.onProgress?.(p);
    },
  );

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
    { file: model.file, spec: fileSpecFor(model) },
    ...(model.mmproj ? [{ file: model.mmproj.file, spec: model.mmproj }] : []),
  ];
  for (const { file, spec } of entries) {
    await discardDownloadedFile(
      modelLocalPath(model, file),
      resumeKeyFor(model, file, spec),
      spec?.sha256,
    );
  }
}

// ── Orphan migration (catalog-prune disk leak, M1) ───────────────────────────
/**
 * Orphan cleanup for catalog prunes.
 *
 * `MODELS_DIR/<id>/` holds one folder per downloaded model. When the catalog
 * prunes a model (see ModelRegistry), the on-disk folder and its resume blobs
 * survive with no UI delete path — a permanent disk leak (M1).
 *
 * We NEVER delete at boot anymore. Detection lives in
 * `ModelDownloader.orphanMigration.ts` (`detectOrphansAtBoot`), which persists a
 * pending migration for a one-time "Delete / Keep" notice in Settings. The
 * currently selected model id is never flagged; autonomous boot deletion is
 * removed.
 *
 * The catalog ids that legitimately own a folder: every MODEL_REGISTRY entry
 * (chat LLMs) plus WHISPER_MODEL and EMBEDDING_MODEL, which are downloaded
 * through the same pipeline but are not part of the chat catalog list.
 */
export function catalogKeepIds(): ReadonlySet<string> {
  const ids = new Set<string>([WHISPER_MODEL.id, EMBEDDING_MODEL.id]);
  for (const model of MODEL_REGISTRY) ids.add(model.id);
  return ids;
}

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
 * Remove persisted resume blobs whose model id no longer exists on disk.
 * Enumerate AsyncStorage keys and drop those matching
 * `kalsa.download.resume.<id>.…`. Best-effort: never throws.
 */
export async function clearOrphanResumeKeys(orphanId: string): Promise<void> {
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
