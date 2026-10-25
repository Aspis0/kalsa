/**
 * Canonical engine signature from a native error message. Only fixed tokens
 * leave the device; the message itself never does.
 */
import { DIAG_SIGNATURE_MAX_CHARS } from "./diagnosticsContract";

const ASSERT_LOCATION =
  /(?:^|[/\\\s])(ggml(?:-vulkan|-metal|-cuda|-opencl|-backend)?|llama(?:-context)?|server-(?:context|slot))\.(cpp|c|m|cu):([0-9]{1,7})\b/;

const ENGINE_ERRORS: readonly { re: RegExp; token: (match: string) => string }[] = [
  { re: /\bvk::(?:DeviceLostError|OutOfDeviceMemoryError|OutOfHostMemoryError|InitializationFailedError)\b/, token: (m) => m },
  { re: /\bCUDA error\b/, token: () => "CUDA error" },
  { re: /\bout of memory\b/i, token: () => "out of memory" },
  { re: /\bsegmentation fault\b/i, token: () => "segmentation fault" },
];

export function signatureFromMessage(message: string | undefined): string | undefined {
  if (!message) return undefined;
  if (message.includes("GGML_ASSERT")) {
    const location = ASSERT_LOCATION.exec(message);
    if (location) {
      const token = `GGML_ASSERT ${location[1]}.${location[2]}:${location[3]}`;
      return token.length <= DIAG_SIGNATURE_MAX_CHARS ? token : undefined;
    }
  }
  for (const { re, token } of ENGINE_ERRORS) {
    const match = re.exec(message);
    if (match) return token(match[0]);
  }
  return undefined;
}
