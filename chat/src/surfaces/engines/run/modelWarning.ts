import type { SuggestedModel } from "../types";
import { memoryText } from "../model";
import { megabytes } from "./format";

/** A typed entry is a local path only when it is absolute. Anything else is taken as a Hugging Face id. */
export function isLocalPath(entry: string): boolean {
  return entry.startsWith("/");
}

/** The size Kalsa can know without guessing: a suggested model's recorded size, or a local path's measured size. */
export function knownSize(entry: string, suggested: SuggestedModel[], localSize: number | null): number | null {
  if (isLocalPath(entry)) return localSize;
  return suggested.find((model) => model.id === entry)?.sizeBytes ?? null;
}

/** A warning only when a known size is larger than this Mac's memory. No size, no warning, no number. */
export function sizeWarning(size: number | null, ramBytes: number): string | null {
  if (size === null || ramBytes <= 0 || size <= ramBytes) return null;
  return `This model is ${megabytes(size)} and this Mac has ${memoryText(ramBytes)} of memory. It is unlikely to load, and the Mac may slow down badly while trying. You can still start it.`;
}
