import { visionInputPresent } from "./attachments";
import type { LocalAttachment } from "./hostMessage";
import type { AttachmentView } from "../ui/shell/composerState";

/** Mark remote vision inputs so a staged chip does not imply they reach the model. */
export function remoteAttachmentChips(
  chips: readonly AttachmentView[],
  attachments: readonly LocalAttachment[],
  remoteBackend: boolean,
): AttachmentView[] {
  if (!remoteBackend) return [...chips];
  const namedAttachments = attachments.filter((item) => item.name.trim().length > 0);
  return chips.map((chip, index) =>
    visionInputPresent(namedAttachments[index] ? [namedAttachments[index]] : [])
      ? { ...chip, key: "shell.composer.remoteImageNotSent" }
      : chip,
  );
}
