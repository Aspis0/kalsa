/**
 * Format-helper cases. Loaded by kvTranscript.test.ts.
 */

import { captureEotSuffix, EOT_MARKER } from "./kvTranscriptFormat";

describe("captureEotSuffix", () => {
  test("bytes after MARKER including newline", async () => {
    const engine = {
      getFormattedChat: async (messages: object[]) => {
        const last = messages[messages.length - 1] as {
          role?: string;
          content?: string;
        };
        if (last?.role === "assistant" && last.content === EOT_MARKER) {
          return { type: "jinja", prompt: `PREFIX${EOT_MARKER}<|im_end|>\n` };
        }
        return { type: "jinja", prompt: "PREFIX" };
      },
    };
    await expect(
      captureEotSuffix(engine, [{ role: "user", content: "hi" }], {}),
    ).resolves.toBe("<|im_end|>\n");
  });

  test("capture failure returns empty", async () => {
    const engine = {
      getFormattedChat: async () => ({ type: "jinja", prompt: "NOPE" }),
    };
    await expect(
      captureEotSuffix(engine, [{ role: "user", content: "hi" }], {}),
    ).resolves.toBe("");
  });
});
