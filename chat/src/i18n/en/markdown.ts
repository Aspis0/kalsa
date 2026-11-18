// The answer's markdown: the blocked-image sentence and the code block's
// copy header.

export const MARKDOWN = {
  imageBlocked: "Image blocked",
  withAlt: (alt: string) => `: ${alt}`,
  from: (host: string) => ` (${host}). Images from the network are never loaded.`,
  openAddress: "Open address",
  unknownAddress: "unknown address",
  embeddedData: "embedded data",
  invalidAddress: "invalid address",
  code: "code",
  copied: "Copied",
  copyFailed: "Copy failed",
  copy: "Copy",
};
