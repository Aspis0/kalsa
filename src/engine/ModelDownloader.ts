import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";

import type { ModelInfo, ModelFileSpec } from "./ModelRegistry";

/**
 * Download bundle modelli (GGUF + mmproj vision) da HuggingFace con:
 * - URL pinnati alla revision del repo (immutabili)
 * - progresso reale (throttled) e resume per FILE (savable()/AsyncStorage)
 * - abort pulito per fase (pauseAsync → stato salvato → niente init su file parziale)
 * - validazione dimensione ESATTA per ogni file
 */

const MODELS_DIR = `${FileSystem.documentDirectory ?? ""}models/`;
const RESUME_KEY_PREFIX = "ai-chat.download.resume.";

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
};

export function modelLocalPath(model: ModelInfo, file: string): string {
  // Directory per modello: niente collisioni tra revisioni/condivisione mmproj.
  return `${MODELS_DIR}${model.id}/${file}`;
}

export function hfFileUrl(model: ModelInfo, file: string, spec?: ModelFileSpec): string {
  const repo = spec?.hfRepo ?? model.hfRepo;
  const revision = spec?.revision ?? model.revision;
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
const STALL_TIMEOUT_MS = 30_000; // nessun progresso per 30s → download bloccato
const RESUME_SAVE_INTERVAL_MS = 10_000; // salva il resume state periodicamente

/** Normalizza gli errori di rete nativi in messaggi leggibili. */
export function friendlyNetworkError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/connection abort|socket|ECONNRESET|timed? ?out|timeout/i.test(message)) {
    return new Error("Connection lost — check your network and retry. Il download riprenderà da dove era.");
  }
  if (/failed to connect|unreachable|no route|network is unreachable/i.test(message)) {
    return new Error("Network unreachable — check your connection.");
  }
  return error instanceof Error ? error : new Error(String(error));
}

async function downloadFile(
  model: ModelInfo,
  file: ModelFileSpec,
  options: DownloadOptions,
  onProgress: (progress: DownloadProgress) => void,
): Promise<DownloadOutcome> {
  if (options.signal?.aborted) return { status: "aborted" };
  await ensureModelsDir(model);
  if (options.signal?.aborted) return { status: "aborted" };

  const target = modelLocalPath(model, file.file);
  const resumeKey = resumeKeyFor(model, file.file, file);

  const saved = await AsyncStorage.getItem(resumeKey)
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

  const buildTask = (resumeData?: string) =>
    FileSystem.createDownloadResumable(
      hfFileUrl(model, file.file, file),
      target,
      {},
      (progress) => {
        lastProgressAt = Date.now();
        const now = Date.now();
        const isFinalChunk =
          progress.totalBytesExpectedToWrite > 0 &&
          progress.totalBytesWritten >= progress.totalBytesExpectedToWrite;
        if (now - lastProgressEmit < PROGRESS_THROTTLE_MS && !isFinalChunk) return;
        lastProgressEmit = now;
        const bytesTotal =
          progress.totalBytesExpectedToWrite > 0 ? progress.totalBytesExpectedToWrite : file.sizeBytes;
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
    void task
      .pauseAsync()
      .then((pauseState) => AsyncStorage.setItem(resumeKey, JSON.stringify(pauseState)))
      .catch(() => undefined);
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });

  // Watchdog anti-stallo: se non arriva progresso per STALL_TIMEOUT_MS,
  // interrompi con un errore pulito (salvando il resume per il retry).
  let lastProgressAt = Date.now();
  let stalled = false;
  let retried = false;
  const stallTimer = setInterval(() => {
    if (Date.now() - lastProgressAt > STALL_TIMEOUT_MS) {
      stalled = true;
      void task
        .pauseAsync()
        .then((pauseState) => AsyncStorage.setItem(resumeKey, JSON.stringify(pauseState)))
        .catch(() => undefined);
    }
  }, 5_000);

  // Salvataggio periodico del resume: un kill/inceppamento NON perde il progresso.
  const resumeSaver = setInterval(() => {
    try {
      const state = task.savable();
      if (state?.resumeData) {
        void AsyncStorage.setItem(resumeKey, JSON.stringify(state)).catch(() => undefined);
      }
    } catch {
      // best effort
    }
  }, RESUME_SAVE_INTERVAL_MS);

  try {
    let result: FileSystem.FileSystemDownloadResult | undefined;
    try {
      result = await task.downloadAsync();
    } catch (error) {
      if (options.signal?.aborted) return { status: "aborted" };
      // Retry automatico una volta (rete caduta/ripristinata): ricrea il task
      // con il resumeData corrente (il task non è riutilizzabile dopo un errore).
      if (!retried) {
        retried = true;
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        try {
          const savedNow = task.savable();
          task = buildTask(
            typeof savedNow?.resumeData === "string" ? (savedNow.resumeData as string) : undefined,
          );
          result = await task.downloadAsync();
        } catch (retryError) {
          throw friendlyNetworkError(retryError);
        }
      } else {
        throw friendlyNetworkError(error);
      }
    }
    if (options.signal?.aborted) return { status: "aborted" };
    if (stalled) {
      throw new Error("Download stalled — check your connection. Riprova: riprenderà da dove era.");
    }
    if (!result?.uri) throw new Error("Download failed");

    // Dimensione ESATTA: un file diverso (parziale/corrotto) non passa mai.
    const info = await FileSystem.getInfoAsync(target);
    if (!info.exists || (info.size ?? 0) !== file.sizeBytes) {
      throw new Error(`Download incomplete (${info.exists ? (info.size ?? 0) : 0} != ${file.sizeBytes} bytes)`);
    }

    await AsyncStorage.removeItem(resumeKey).catch(() => undefined);
    return { status: "done", uri: result.uri };
  } finally {
    clearInterval(stallTimer);
    clearInterval(resumeSaver);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

/** Scarica GGUF + mmproj (se presente), con progresso aggregato. */
export async function downloadModelBundle(
  model: ModelInfo,
  options: DownloadOptions = {},
): Promise<{ model: DownloadOutcome; mmproj?: DownloadOutcome }> {
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
  const files = [model.file, ...(model.mmproj ? [model.mmproj.file] : [])];
  for (const file of files) {
    await FileSystem.deleteAsync(modelLocalPath(model, file), { idempotent: true }).catch(() => undefined);
    await AsyncStorage.removeItem(resumeKeyFor(model, file)).catch(() => undefined);
  }
}
