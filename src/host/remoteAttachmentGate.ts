/**
 * What an attach entry may run, by which brain the host is on. Documents and
 * rendered pages are refused outright in remote mode — the door takes no file
 * parts. A PICTURE may go remotely, but only while the desk's own fresh
 * `/props` says its model can see: the picker asks for that verdict first
 * (`runRemoteImagePick`), so a model without eyes is never handed one. Local
 * mode is untouched by both rules; the phone model's own mmproj gate decides
 * there, upstream of this file.
 */
import type { RemoteVisionVerdict } from "../engine/remote/modalities";

export function runHostAttachment<T>(
  remoteActive: boolean,
  onRemoteRefusal: () => void,
  action: () => T,
): T | undefined {
  if (remoteActive) {
    onRemoteRefusal();
    return undefined;
  }
  return action();
}

export interface RemoteImagePickInput {
  /** Whether the press landed on the remote brain, read by the caller. */
  remoteActive: boolean;
  /** The desk's /props verdict, re-read for this press. Only called remotely. */
  probeVision: () => Promise<RemoteVisionVerdict>;
  /** Which refusal to speak: the desk answered "cannot see", or it did not
      answer at all — two different sentences the caller owns. */
  onRefusal: (verdict: "cannot" | "unreachable") => void;
  run: () => void;
}

/**
 * The picture road, whose permission is a live answer rather than a cached
 * one: the desk may have restarted or switched model since the last probe.
 * That probe runs BEFORE the picker opens — a picture picked and then refused
 * would have been a picker the user walked through for nothing.
 */
export async function runRemoteImagePick(input: RemoteImagePickInput): Promise<void> {
  if (!input.remoteActive) {
    input.run();
    return;
  }
  const verdict = await input.probeVision();
  if (verdict === "sees") {
    input.run();
    return;
  }
  input.onRefusal(verdict);
}
