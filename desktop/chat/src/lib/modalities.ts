/**
 * What the served model can receive, as the engine's `/props` answers it:
 * `modalities: { "vision": bool, "audio": bool, "video": bool }`. No model
 * list lives anywhere in the chat — the server's own word is the whole
 * capability.
 */
export interface Modalities {
  vision: boolean;
  audio: boolean;
  video: boolean;
}

export const NO_MODALITIES: Modalities = { vision: false, audio: false, video: false };

/**
 * Anything absent, non-object or not exactly `true` is "cannot": an answer
 * this page cannot read is never taken as permission.
 */
export function parseModalities(props: unknown): Modalities {
  if (typeof props !== "object" || props === null) return NO_MODALITIES;
  const raw = (props as { modalities?: unknown }).modalities;
  if (typeof raw !== "object" || raw === null) return NO_MODALITIES;
  const record = raw as Record<string, unknown>;
  return {
    vision: record.vision === true,
    audio: record.audio === true,
    video: record.video === true,
  };
}
