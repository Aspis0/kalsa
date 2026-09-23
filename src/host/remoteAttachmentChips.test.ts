import { remoteAttachmentChips } from "./remoteAttachmentChips";
import { readFileSync } from "fs";
import { join } from "path";
import type { AttachmentView } from "../ui/shell/composerState";
import type { LocalAttachment } from "./hostMessage";

const chips: AttachmentView[] = [
  { key: "shell.composer.attachment", params: { name: "photo.jpg" } },
  { key: "shell.composer.attachment", params: { name: "pages.pdf" } },
  { key: "shell.composer.attachment", params: { name: "manual.docx" } },
];
const items: LocalAttachment[] = [
  { id: "i", kind: "image", name: "photo.jpg", uri: "file:///photo" },
  { id: "p", kind: "pdf", name: "pages.pdf", uri: "file:///pages", pages: ["file:///page"] },
  { id: "d", kind: "document", name: "manual.docx", uri: "file:///manual", libraryDocId: "doc" },
];

describe("remote vision attachment chips disclose the serializer's text-only behavior", () => {
  test("remote image and rendered PDF chips say they will not be sent; documents keep their label", () => {
    const surface = readFileSync(join(__dirname, "HostChatSurface.tsx"), "utf8");
    expect(remoteAttachmentChips(chips, items, true)).toEqual([
      { key: "shell.composer.remoteImageNotSent", params: { name: "photo.jpg" } },
      { key: "shell.composer.remoteImageNotSent", params: { name: "pages.pdf" } },
      chips[2],
    ]);
    expect(surface).toContain("remoteAttachmentChips(view.attachmentChips, attachments.items, modelHost.remoteActive)");
  });

  test("local chips retain their normal attachment labels", () => {
    expect(remoteAttachmentChips(chips, items, false)).toEqual(chips);
  });
});
