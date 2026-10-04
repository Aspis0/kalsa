/**
 * What the served model can receive, as the desk's `/props` answers it:
 * `modalities: {vision, audio, video}`. Nothing else in the app decides
 * capability, and nothing absent, malformed or not exactly `true` is ever
 * read as permission — an answer this code failed to understand means the
 * model cannot see, so a picture never rides on a guess.
 */
export interface Modalities {
  vision: boolean;
  audio: boolean;
  video: boolean;
}

export const NO_MODALITIES: Modalities = { vision: false, audio: false, video: false };

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

/**
 * What a fresh `/props` read answered about seeing. The distinction matters
 * where the answer becomes UI copy: "cannot see" and "could not be reached"
 * are different sentences, and one never stands in for the other.
 */
export type RemoteVisionVerdict = "sees" | "cannot" | "unreachable";

let remoteVision = false;

/**
 * The last `/props` verdict, for the composer's chips. It is never persisted
 * and never survives the door it describes: the engine resets it to false
 * whenever it leaves the remote brain or its address or model changes.
 */
export function setRemoteVision(vision: boolean): void {
  remoteVision = vision === true;
}

export function getRemoteVision(): boolean {
  return remoteVision;
}
