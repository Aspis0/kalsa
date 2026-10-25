/**
 * Unit tests for the think-tag stream cleaner + round-end arbitration
 * (src/engine/thinkStream.ts). Pure Node — no React Native.
 *
 * Focus: the template-opened think block (`templateOpensThink`, the LFM2.5
 * turn-1 defect — the chat template opens `<think>` in the generation prompt,
 * so the completion carries only the CLOSING tag), plus the display capture
 * (`thinkingText`) and the pre-existing policies (regression pins).
 */

import {
  arbitrateThinkTags,
  createThinkStreamCleaner,
  decideTemplateOpensThink,
  type ThinkStreamCleaner,
} from "./thinkStream";

/** Feed deltas through cleanDelta; return { stream, thinking, final }. */
function runRound(
  deltas: string[],
  rawFullText: string,
  opts?: Parameters<typeof createThinkStreamCleaner>[0],
): { stream: string; thinking: string; final: string } {
  const cleaner: ThinkStreamCleaner = createThinkStreamCleaner(opts);
  let stream = "";
  for (const delta of deltas) stream += cleaner.cleanDelta(delta);
  const final = cleaner.finalize(rawFullText);
  return { stream, thinking: cleaner.thinkingText(), final };
}

describe("thinkStream forced-open rounds (template opened <think>)", () => {
  // The measured turn-1 defect shape: 752 chars of reasoning, then a lone
  // close, then the real answer.
  const reasoning = "The user wants me to plan a 7-day trip to Portugal.";
  const answer = "\n\nCiao! Ecco il tuo itinerario di 7 giorni.";
  const turn1Raw = `${reasoning}</think>${answer}`;

  test("finalize treats everything before the first close as thinking", () => {
    expect(arbitrateThinkTags(turn1Raw, { templateOpensThink: true })).toBe(
      answer,
    );
  });

  test("without the flag, today's conservative rule holds (reasoning kept, tag swept)", () => {
    // Documented trade-off: prompt-side detection OFF → a lone close costs
    // only the tag itself; the text before it stays (that WAS the bug).
    expect(arbitrateThinkTags(turn1Raw)).toBe(`${reasoning}${answer}`);
  });

  test("stream with a split close: reasoning never paints, answer does", () => {
    const { stream, thinking, final } = runRound(
      [reasoning.slice(0, 20), reasoning.slice(20), "</th", `ink>${answer}`],
      turn1Raw,
      { templateOpensThink: true },
    );
    expect(stream).toBe(answer);
    expect(thinking).toBe(reasoning);
    expect(final).toBe(answer);
  });

  test("truncated inside the template-opened block → empty final, reasoning kept", () => {
    const { stream, thinking, final } = runRound(
      [reasoning.slice(0, 30)],
      reasoning,
      { templateOpensThink: true },
    );
    expect(stream).toBe("");
    expect(thinking).toBe(reasoning);
    expect(final).toBe("");
  });

  test("empty reasoning (close at once) → answer only, empty thinking", () => {
    const { stream, thinking, final } = runRound(
      ["</think>", answer],
      `</think>${answer}`,
      { templateOpensThink: true },
    );
    expect(stream).toBe(answer);
    expect(thinking).toBe("");
    expect(final).toBe(answer);
  });

  test("model echoing its own leading <think> still parses (normal path)", () => {
    const raw = `<think>echoed reasoning</think>Answer.`;
    const { stream, thinking, final } = runRound([raw], raw, {
      templateOpensThink: true,
    });
    expect(stream).toBe("Answer.");
    expect(thinking).toBe("echoed reasoning");
    expect(final).toBe("Answer.");
  });

  test("model-echoed leading <think> never lands in the pre-finalize buffer", () => {
    // The abort handler and the tool-round flush read the STREAM buffer, not
    // the finalize reconcile — the echo must be skipped at capture time,
    // including when it is split across deltas.
    const cleaner = createThinkStreamCleaner({ templateOpensThink: true });
    let stream = "";
    for (const delta of ["<thi", "nk>echoed reasoning</think>Answer."]) {
      stream += cleaner.cleanDelta(delta);
    }
    expect(stream).toBe("Answer.");
    expect(cleaner.thinkingText()).toBe("echoed reasoning");
    expect(cleaner.thinkingText()).not.toContain("<think>");
    // Whitespace before the echo is markup-adjacent too, not reasoning.
    const cleanerWs = createThinkStreamCleaner({ templateOpensThink: true });
    stream = "";
    for (const delta of ["\n ", "<think>why</think>Answer."]) {
      stream += cleanerWs.cleanDelta(delta);
    }
    expect(stream).toBe("Answer.");
    expect(cleanerWs.thinkingText()).toBe("why");
  });

  test("empty template block must not swallow the model's own reasoning block", () => {
    const raw = `</think><think>real reasoning</think>Answer.`;
    const { stream, thinking, final } = runRound([raw], raw, {
      templateOpensThink: true,
    });
    expect(final).toBe("Answer.");
    expect(thinking).toBe("real reasoning");
    expect(stream).toBe("Answer.");
  });

  test("literal </think> before the boundary becomes thinking (template contract)", () => {
    // With the flag the parse follows the template grammar, like llama.cpp:
    // everything before the first close is inside the template's block; the
    // second close (now orphaned in the answer) still costs just the tag.
    const raw = `plan:</think>Write </think> to close.`;
    expect(arbitrateThinkTags(raw, { templateOpensThink: true })).toBe(
      "Write  to close.",
    );
  });
});

describe("thinkStream no-think rounds", () => {
  test("no think markers at all passes through unchanged (flag off)", () => {
    const raw = "Just a plain answer, no markup.";
    const { stream, thinking, final } = runRound([raw], raw);
    expect(stream).toBe(raw);
    expect(final).toBe(raw);
    expect(thinking).toBe("");
  });

  test("no think markers at all passes through unchanged (flag on)", () => {
    // Flag on but the model DID close the block earlier rounds-style is
    // covered above; here: plain content with no markers and no close while
    // the probe says the template opened → truncated think, per the grammar.
    const raw = "Just a plain answer, no markup.";
    expect(arbitrateThinkTags(raw, { templateOpensThink: true })).toBe("");
  });
});

describe("thinkStream normal <think>…</think> rounds (must not regress)", () => {
  const raw = `<think>Let me think about it.</think>Final answer.`;

  test("closed leading block stripped, thinking captured (flag off)", () => {
    const { stream, thinking, final } = runRound(
      ["<think>Let me think", " about it.</think>Final answer."],
      raw,
    );
    expect(stream).toBe("Final answer.");
    expect(thinking).toBe("Let me think about it.");
    expect(final).toBe("Final answer.");
  });

  test("closed leading block stripped, thinking captured (flag on)", () => {
    expect(arbitrateThinkTags(raw, { templateOpensThink: true })).toBe(
      "Final answer.",
    );
  });

  test("mid-text closed pair stripped", () => {
    expect(arbitrateThinkTags(`A <think>x</think> B`)).toBe("A  B");
  });

  test("degenerate multi-open loop still strips from the first open", () => {
    const degenerate = `Answer<think><think><think>`;
    expect(arbitrateThinkTags(degenerate)).toBe("Answer");
  });

  test("truncated leading block still empties the final", () => {
    expect(arbitrateThinkTags("  <think>cut mid-way")).toBe("");
  });
});

describe("thinkStream literal mentions (flag off)", () => {
  test("lone </think> mention in content costs only the tag, never the text", () => {
    const raw = `To close the block you write </think> and nothing else.`;
    const { stream, thinking, final } = runRound([raw], raw);
    // The sweep removes the tag itself, leaving the two spaces around it.
    expect(final).toBe("To close the block you write  and nothing else.");
    expect(stream).toBe(final);
    expect(thinking).toBe("");
  });

  test("single unclosed <think> mention kept verbatim at finalize, not thinking", () => {
    const raw = `Use <think> tags like this`;
    const { stream, thinking, final } = runRound([raw], raw);
    // Stream emits the prefix before the open ("Use ") and holds the span
    // after it (conservative); finalize pops the whole raw in verbatim —
    // and the reconcile must REMOVE the held span from the thinking buffer.
    expect(stream).toBe("Use ");
    expect(final).toBe(raw);
    expect(thinking).toBe("");
  });
});

describe("thinkStream decideTemplateOpensThink (pure prompt-side decision)", () => {
  test("jinja result with the flag → true", () => {
    expect(
      decideTemplateOpensThink({
        type: "jinja",
        thinking_forced_open: true,
        prompt: "…<|im_start|>assistant\n<think>",
      }),
    ).toBe(true);
  });

  test("jinja result without forced-open → false (never a prompt-tail guess)", () => {
    expect(
      decideTemplateOpensThink({
        type: "jinja",
        thinking_forced_open: false,
        prompt: "…assistant\n<think>",
      }),
    ).toBe(false);
    expect(decideTemplateOpensThink({ type: "jinja" })).toBe(false);
  });

  test("non-jinja rendering path → false regardless of prompt shape", () => {
    expect(
      decideTemplateOpensThink({
        type: "llama-chat",
        thinking_forced_open: true as unknown as undefined,
        prompt: "…<think>",
      }),
    ).toBe(false);
  });
});
