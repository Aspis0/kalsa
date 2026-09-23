import * as FileSystem from "expo-file-system/legacy";

/** Reject binary mislabel: NUL in first 8 KB of a supposed text file. */
export async function hasNulInPrefix(uri: string): Promise<boolean> {
  try {
    const raw = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    if (typeof raw !== "string") return true;
    return raw.slice(0, 8192).includes("\u0000");
  } catch {
    return false;
  }
}

export function nextDocId(): string {
  return `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
