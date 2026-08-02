import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";

import type { ModelInfo } from "./ModelRegistry";

/**
 * Download modelli GGUF da HuggingFace con:
 * - progresso reale (callback del task nativo)
 * - resume dopo pausa/riavvio (DownloadResumable.savable() persistito in AsyncStorage)
 * - abort pulito (pauseAsync → stato salvato → nessun init su file parziale)
 * - validazione dimensione ESATTA (sizeBytes dal registry) prima di dichiarare completo
 */

const MODELS_DIR = `${FileSystem.documentDirectory ?? ""}models/`;
const RESUME_KEY_PREFIX = "ai-chat.download.resume.";

export type DownloadProgress = {
  bytesReceived: number;
  bytesTotal: number;
  progress: number; // 0..1
};

export type DownloadOptions = {
  onProgress?: (progress: DownloadProgress) => void;
  signal?: AbortSignal;
};

export type DownloadOutcome =
  | { status: "done"; uri: string }
  | { status: "aborted" };

export function modelLocalPath(model: ModelInfo): string {
  return `${MODELS_DIR}${model.file}`;
}

export function modelDownloadUrl(model: ModelInfo): string {
  const [owner, repo] = model.hfRepo.split("/").map((part) => encodeURIComponent(part));
  return `https://huggingface.co/${owner}/${repo}/resolve/main/${encodeURIComponent(model.file)}`;
}

export async function ensureModelsDir(): Promise<void> {
  await FileSystem.makeDirectoryAsync(MODELS_DIR, { intermediates: true });
}

/** Vero solo se il file esiste con la dimensione esatta del GGUF completo. */
export async function isModelDownloaded(model: ModelInfo): Promise<boolean> {
  const info = await FileSystem.getInfoAsync(modelLocalPath(model));
  if (!info.exists) return false;
  return (info.size ?? 0) >= model.approxBytes;
}

function resumeKeyFor(model: ModelInfo): string {
  return `${RESUME_KEY_PREFIX}${model.id}`;
}

export async function downloadModel(model: ModelInfo, options: DownloadOptions = {}): Promise<DownloadOutcome> {
  await ensureModelsDir();
  const target = modelLocalPath(model);
  const resumeKey = resumeKeyFor(model);

  // Riprendi da uno stato di pausa persistito (sopravvive al riavvio dell'app).
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
      resumeData,
    );

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

  try {
    let result: FileSystem.FileSystemDownloadResult | undefined;
    try {
      result = await task.downloadAsync();
    } catch (error) {
      if (options.signal?.aborted) return { status: "aborted" };
      throw error;
    }
    if (options.signal?.aborted) return { status: "aborted" };
    if (!result?.uri) throw new Error("Download failed");

    // Verifica dimensione esatta: un file parziale non deve mai passare.
    const info = await FileSystem.getInfoAsync(target);
    if (!info.exists || (info.size ?? 0) < model.approxBytes) {
      throw new Error(`Download incomplete (${info.exists ? (info.size ?? 0) : 0} < ${model.approxBytes} bytes)`);
    }

    await AsyncStorage.removeItem(resumeKey).catch(() => undefined);
    return { status: "done", uri: result.uri };
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
  }
}

export async function deleteModelFile(model: ModelInfo): Promise<void> {
  await FileSystem.deleteAsync(modelLocalPath(model), { idempotent: true }).catch(() => undefined);
  await AsyncStorage.removeItem(resumeKeyFor(model)).catch(() => undefined);
}
