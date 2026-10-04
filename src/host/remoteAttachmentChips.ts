import { visionInputPresent } from "./attachments";
import type { LocalAttachment } from "./hostMessage";
import type { AttachmentView } from "../ui/shell/composerState";

/** Mark remote vision inputs so a staged chip does not imply they reach the
 *  model: in remote mode they do, but only while the desk's `/props` says its
 *  model can see — a picture staged when it could not is exactly what the
 *  chip must disclose. */
export function remoteAttachmentChips(
  chips: readonly AttachmentView[],
  attachments: readonly LocalAttachment[],
  remoteActive: boolean,
  remoteVision: boolean,
): AttachmentView[] {
  if (!remoteActive || remoteVision) return [...chips];
  const namedAttachments = attachments.filter((item) => item.name.trim().length > 0);
  return chips.map((chip, index) =>
    visionInputPresent(namedAttachments[index] ? [namedAttachments[index]] : [])
      ? { ...chip, key: "shell.composer.remoteImageNotSent" }
      : chip,
  );
}
