/**
 * Format-helper tests: eot dummy, role-pair pPrev cut, ChatML fixture.
 */

import {
  captureEotSuffix,
  cutPPrevFromRolePair,
  EOT_MARKER,
  formatTranscriptPair,
  PREV_SENTINEL,
} from "./kvTranscriptFormat";

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

/** Minimal ChatML: same delimiters Qwen uses, no jinja conditionals. */
function chatml(
  messages: Array<{ role: string; content: string }>,
  addGen = false,
): string {
  let s = "";
  for (const m of messages) {
    s += `<|im_start|>${m.role}\n${m.content}<|im_end|>\n`;
  }
  if (addGen) s += `<|im_start|>assistant\n`;
  return s;
}

function chatmlEngine() {
  return {
    getFormattedChat: async (
      messages: object[],
      _t?: string | null,
      params?: { add_generation_prompt?: boolean },
    ) => ({
      type: "jinja",
      prompt: chatml(
        messages as Array<{ role: string; content: string }>,
        params?.add_generation_prompt === true,
      ),
    }),
  };
}

describe("cutPPrevFromRolePair", () => {
  test("missing sentinel on either side is a miss", () => {
    expect(cutPPrevFromRolePair("abcUSER", "abcASST", PREV_SENTINEL)).toBeNull();
    expect(
      cutPPrevFromRolePair(`abcU${PREV_SENTINEL}`, "abcASST", PREV_SENTINEL),
    ).toBeNull();
  });

  test("empty common prefix is a miss", () => {
    expect(
      cutPPrevFromRolePair(`U${PREV_SENTINEL}`, `A${PREV_SENTINEL}`, PREV_SENTINEL),
    ).toBeNull();
  });

  test("sentinel immediately after LCP (merged assistants) is a miss", () => {
    const hist = "SYS\nuser\nU0\nassistant\nA0";
    expect(
      cutPPrevFromRolePair(
        `${hist}\nuser\n${PREV_SENTINEL}`,
        `${hist}${PREV_SENTINEL}`,
        PREV_SENTINEL,
      ),
    ).toBeNull();
  });
});

describe("ChatML pPrev cut — the dropped-header fixture", () => {
  const sys = { role: "system", content: "S" };
  const user0 = { role: "user", content: "U0" };
  const asst0Gen = { role: "assistant", content: "<think>\nT\n</think>\n\nA0" };
  const asst0Hist = { role: "assistant", content: "A0" };
  const user1 = { role: "user", content: "U1" };

  test("delta starts with the user block; T+delta keeps the header", async () => {
    const throughAsst = [sys, user0, asst0Hist];
    const full = [sys, user0, asst0Hist, user1];
    const out = await formatTranscriptPair(chatmlEngine(), throughAsst, full, {});
    expect(out.pPrevSentinelFound).toBe(true);

    const pPrev = out.pPrev.prompt;
    const pNew = out.pNew.prompt;
    expect(pNew.startsWith(pPrev)).toBe(true);
    expect(pPrev.endsWith("<|im_end|>\n")).toBe(true);
    expect(pPrev.includes("<|im_start|>user\nU1")).toBe(false);

    const delta = pNew.slice(pPrev.length);
    expect(delta.startsWith("<|im_start|>user\n")).toBe(true);
    expect(delta).toBe(
      `<|im_start|>user\nU1<|im_end|>\n<|im_start|>assistant\n`,
    );

    const t = chatml([sys, user0, asst0Gen]);
    expect(t + delta).toBe(
      t + `<|im_start|>user\nU1<|im_end|>\n<|im_start|>assistant\n`,
    );
    expect(t + delta).toContain("<|im_start|>user\nU1");
    // Previous cut-at-sentinel produced a delta that started with raw U1.
    expect(delta.startsWith("U1")).toBe(false);
  });

  test("no system block: cut still ends at assistant N eot", async () => {
    const throughAsst = [user0, asst0Hist];
    const full = [user0, asst0Hist, user1];
    const out = await formatTranscriptPair(chatmlEngine(), throughAsst, full, {});
    expect(out.pPrevSentinelFound).toBe(true);
    expect(out.pPrev.prompt).toBe(chatml(throughAsst));
    expect(out.pNew.prompt.slice(out.pPrev.prompt.length).startsWith("<|im_start|>user\n")).toBe(
      true,
    );
  });

  test("escaped sentinel does not guess a cut", async () => {
    const engine = {
      getFormattedChat: async () => ({
        type: "jinja",
        prompt: "ESCAPED_NO_MARKER",
      }),
    };
    const out = await formatTranscriptPair(
      engine,
      [{ role: "assistant", content: "a" }],
      [{ role: "user", content: "hi" }],
      {},
    );
    expect(out.pPrevSentinelFound).toBe(false);
    expect(out.pPrev.prompt).toBe(out.pNew.prompt);
  });
});
