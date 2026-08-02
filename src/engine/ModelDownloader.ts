import * as FileSystem from "expo-file-system/legacy";

import type { ModelInfo } from "./ModelRegistry";

/**
 * Download modelli GGUF da HuggingFace con progresso e resume.
 * I file finiscono in <document>/models/<file>.
 */

const MODELS_DIR = `${FileSystem.documentDirectory ?? ""}models/`;

export type DownloadProgress = {
  bytesReceived: number;
  bytesTotal: number;
  progress: number; // 0..1
};

export type DownloadOptions = {
  onProgress?: (progress: DownloadProgress) => void;
  signal?: AbortSignal;
};

export function modelLocalPath(model: ModelInfo): string {
  return `${MODELS_DIR}${model.file}`;
}

export function modelDownloadUrl(model: ModelInfo): string {
  return `https://huggingface.co/${model.hfRepo}/resolve/main/${model.file}`;
}

export async function ensureModelsDir(): Promise<void> {
  await FileSystem.makeDirectoryAsync(MODELS_DIR, { intermediates: true }).catch(() => undefined);
}

/** Vero se il file esiste ed è sostanzialmente completo (> 1 MB). */
export async function isModelDownloaded(model: ModelInfo): Promise<boolean> {
  const info = await FileSystem.getInfoAsync(modelLocalPath(model));
  return info.exists && (info.size ?? 0) > 1_000_000;
}

export async function downloadModel(model: ModelInfo, options: DownloadOptions = {}): Promise<string> {
  await ensureModelsDir();
  const target = modelLocalPath(model);

  // createDownloadResumable riprende da un file parziale già presente.
  const download = FileSystem.createDownloadResumable(
    modelDownloadUrl(model),
    target,
    {},
    (progress) => {
      const bytesTotal = progress.totalBytesExpectedToWrite > 0 ? progress.totalBytesExpectedToWrite : model.approxBytes;
      options.onProgress?.({
        bytesReceived: progress.totalBytesWritten,
        bytesTotal,
        progress: bytesTotal > 0 ? Math.min(1, progress.totalBytesWritten / bytesTotal) : 0,
      });
    },
  );

  const onAbort = () => {
    void download.pauseAsync().catch(() => undefined);
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const result = await download.downloadAsync();
    if (!result?.uri) throw new Error("Download failed");
    return result.uri;
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
  }
}

export async function deleteModelFile(model: ModelInfo): Promise<void> {
  await FileSystem.deleteAsync(modelLocalPath(model), { idempotent: true }).catch(() => undefined);
}
