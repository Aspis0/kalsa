/**
 * modelEmittedText: prompt replay prefers what the model actually produced;
 * UI-facing text stays the cleaned copy. Pure Node — no React Native.
 */

import {
  HISTORY_NOT_REPRODUCIBLE,
  historyBudgetCharge,
  historyReplayCharLength,
  historyThinkPlacementForModel,
  historyWindowReproducesKv,
  llamaHistoryAssistantFields,
  modelEmittedTextForVisibleReply,
  normalizeModelEmittedTextForSave,
  promptContentForHistoryMessage,
  readModelEmittedText,
} from "./modelEmittedText";
import {
  assembleEngineHistory,
  LEGACY_MAX_CHARS,
  LEGACY_MAX_CHARS_IMAGES,
} from "../context/compactor";

describe("promptContentForHistoryMessage", () => {
  test("assistant with modelEmittedText replays that into the prompt, not cleaned text", () => {
    const cleaned = "Salvato! 👋";
    // Model-visible payload may include template-injected wrappers the UI strips.
    // Test uses opaque markers only — no template-specific tokens hard-coded in prod.
    const emitted = "«EMITTED»\n\nSalvato! 👋";
    const content = promptContentForHistoryMessage({
      role: "assistant",
      content: cleaned,
      modelEmittedText: emitted,
    });
    expect(content).toBe(emitted);
    expect(content).not.toBe(cleaned);
  });

  test("assistant without modelEmittedText falls back to content (back-compat)", () => {
    const cleaned = "Hello from history";
    expect(
      promptContentForHistoryMessage({
        role: "assistant",
        content: cleaned,
      }),
    ).toBe(cleaned);
    expect(
      promptContentForHistoryMessage({
        role: "assistant",
        content: cleaned,
        modelEmittedText: undefined,
      }),
    ).toBe(cleaned);
  });

  test("user messages always use content (modelEmittedText ignored)", () => {
    const userText = "save this please";
    expect(
      promptContentForHistoryMessage({
        role: "user",
        content: userText,
        modelEmittedText: "should-not-appear",
      }),
    ).toBe(userText);
  });

  test("UI-facing text is a separate field — resolver does not mutate inputs", () => {
    const msg = {
      role: "assistant" as const,
      content: "visible",
      modelEmittedText: "raw-emitted",
    };
    const prompt = promptContentForHistoryMessage(msg);
    expect(prompt).toBe("raw-emitted");
    expect(msg.content).toBe("visible");
    expect(msg.modelEmittedText).toBe("raw-emitted");
  });
});

describe("llamaHistoryAssistantFields", () => {
  test("form B completed: does not duplicate a leading think span", () => {
    const raw = "<think>\n\n</think>\n\nThe KV cache.";
    const fields = llamaHistoryAssistantFields({
      role: "assistant",
      content: "The KV cache.",
      modelEmittedText: raw,
    });
    expect(fields).toEqual({ content: raw });
  });

  test("form A completed: prefixes reasoning before the close", () => {
    const fields = llamaHistoryAssistantFields({
      role: "assistant",
      content: "ANSWER",
      modelEmittedText: "REASONING</think>ANSWER",
    });
    expect(fields).toEqual({ content: "<think>REASONING</think>ANSWER" });
  });

  test("raw empty emits the seeded think prefix", () => {
    expect(
      llamaHistoryAssistantFields({
        role: "assistant",
        content: "",
        modelEmittedText: "",
      }),
    ).toEqual({ content: "<think>" });
  });

  test("strictly prefixes whitespace before a leading think span", () => {
    const raw = "\n<think>REASONING</think>ANSWER";
    expect(
      llamaHistoryAssistantFields({
        role: "assistant",
        content: "ANSWER",
        modelEmittedText: raw,
      }),
    ).toEqual({ content: `<think>${raw}` });
  });

  test("uses content as the source when modelEmittedText is absent", () => {
    const content = "<think>FALLBACK";
    expect(
      llamaHistoryAssistantFields({
        role: "assistant",
        content,
      }),
    ).toEqual({ content });
  });

  test("prefixes plain content when modelEmittedText is absent", () => {
    const content = "plain content";
    expect(
      llamaHistoryAssistantFields({
        role: "assistant",
        content,
      }),
    ).toEqual({ content: `<think>${content}` });
  });

  test("preserves a closing tag at position zero", () => {
    expect(
      llamaHistoryAssistantFields({
        role: "assistant",
        content: "</think>",
        modelEmittedText: "</think>",
      }),
    ).toEqual({ content: "<think></think>" });
  });

  test("preserves a closing tag followed by the answer", () => {
    expect(
      llamaHistoryAssistantFields({
        role: "assistant",
        content: "</think>ANSWER",
        modelEmittedText: "</think>ANSWER",
      }),
    ).toEqual({ content: "<think></think>ANSWER" });
  });

  test("no think tags: content is the seeded prefix plus raw emission", () => {
    const fields = llamaHistoryAssistantFields({
      role: "assistant",
      content: "visible",
      modelEmittedText: "raw-emitted",
    });
    expect(fields).toEqual({ content: "<think>raw-emitted" });
  });

  test("preserves two closing tags and a later opening tag verbatim", () => {
    const raw = "REASONING</think>ANSWER</think>MORE";
    expect(
      llamaHistoryAssistantFields({
        role: "assistant",
        content: raw,
        modelEmittedText: raw,
      }),
    ).toEqual({ content: `<think>${raw}` });
  });

  test("preserves a later opening tag after the true close", () => {
    const raw = "REASONING</think>ANSWER <think>more";
    expect(
      llamaHistoryAssistantFields({
        role: "assistant",
        content: raw,
        modelEmittedText: raw,
      }),
    ).toEqual({ content: `<think>${raw}` });
  });

  test("preserves a quoted think tag in the answer", () => {
    const raw = "a<think>b</think>c";
    expect(
      llamaHistoryAssistantFields({
        role: "assistant",
        content: raw,
        modelEmittedText: raw,
      }),
    ).toEqual({ content: `<think>${raw}` });
  });

  test("form B interrupted: does not duplicate an unclosed leading think span", () => {
    const fields = llamaHistoryAssistantFields({
      role: "assistant",
      content: "",
      modelEmittedText: "<think>unfinished",
    });
    expect(fields).toEqual({ content: "<think>unfinished" });
  });

  test("form A interrupted: prefixes reasoning with no close or leading tag", () => {
    const raw = "unfinished reasoning";
    const fields = llamaHistoryAssistantFields({
      role: "assistant",
      content: "",
      modelEmittedText: raw,
    });
    expect(fields).toEqual({ content: `<think>${raw}` });
  });

  test("content_span keeps the raw think span so Qwen history prefixes KV", () => {
    const raw = "<think>\nplan\n</think>\n\nLa memoria KV è una cache.";
    const fields = llamaHistoryAssistantFields(
      { role: "assistant", content: "La memoria KV è una cache.", modelEmittedText: raw },
      { historyThink: "content_span" },
    );
    expect(fields.content).toBe(raw);
    expect(fields.reasoning_content).toBe("");
  });

  test("content_span without a closed think omits reasoning_content", () => {
    const fields = llamaHistoryAssistantFields(
      { role: "assistant", content: "hi", modelEmittedText: "hi" },
      { historyThink: "content_span" },
    );
    expect(fields.content).toBe("hi");
    expect(fields.reasoning_content).toBeUndefined();
  });

  test("content_span keeps an empty think span", () => {
    const raw = "<think></think>ANSWER";
    expect(
      llamaHistoryAssistantFields(
        { role: "assistant", content: raw, modelEmittedText: raw },
        { historyThink: "content_span" },
      ),
    ).toEqual({ content: raw, reasoning_content: "" });
  });
});

describe("historyReplayCharLength", () => {
  test("charges the prefix only when the selected replay text lacks it", () => {
    const rawWithoutTag = "REASONING</think>ANSWER";
    const rawWithTag = "<think>REASONING</think>ANSWER";
    const whitespaceBeforeTag = "\n<think>REASONING</think>ANSWER";
    const fallbackContent = "<think>FALLBACK";
    expect(
      historyReplayCharLength(
        { role: "assistant", text: "short", modelEmittedText: rawWithoutTag },
        { historyThink: "reasoning_content" },
      ),
    ).toBe(rawWithoutTag.length + "<think>".length);
    expect(
      historyReplayCharLength(
        { role: "assistant", text: "short", modelEmittedText: rawWithTag },
        { historyThink: "reasoning_content" },
      ),
    ).toBe(rawWithTag.length);
    expect(
      historyReplayCharLength(
        { role: "assistant", text: "short", modelEmittedText: whitespaceBeforeTag },
        { historyThink: "reasoning_content" },
      ),
    ).toBe(whitespaceBeforeTag.length + "<think>".length);
    expect(
      historyReplayCharLength(
        { role: "assistant", content: fallbackContent },
        { historyThink: "reasoning_content" },
      ),
    ).toBe(fallbackContent.length);
    const fallbackText = "plain text";
    const differentContent = "<think>different content";
    expect(
      historyReplayCharLength(
        { role: "assistant", text: fallbackText },
        { historyThink: "reasoning_content" },
      ),
    ).toBe(fallbackText.length + "<think>".length);
    expect(
      historyReplayCharLength(
        { role: "assistant", text: fallbackText, content: differentContent },
        { historyThink: "reasoning_content" },
      ),
    ).toBe(fallbackText.length + "<think>".length);
    expect(
      historyReplayCharLength(
        { role: "assistant", text: "short", modelEmittedText: rawWithoutTag },
        { historyThink: "content_span" },
      ),
    ).toBe(rawWithoutTag.length);
    expect(
      historyReplayCharLength(
        { role: "user", text: "hi" },
        { historyThink: "reasoning_content" },
      ),
    ).toBe(2);
  });

  test("Qwen (no preserveThinking) uses content_span; LFM restores the seed", () => {
    expect(historyThinkPlacementForModel(undefined)).toBe("content_span");
    expect(historyThinkPlacementForModel(true)).toBe("reasoning_content");
  });

  test("normalizer preserves a leading newline before LFM replay", () => {
    const raw = "\nREASONING</think>ANSWER";
    const saved = normalizeModelEmittedTextForSave("assistant", raw);
    expect(saved).toBe(raw);
    expect(
      llamaHistoryAssistantFields({
        role: "assistant",
        content: "ANSWER",
        modelEmittedText: saved,
      }),
    ).toEqual({ content: `<think>${raw}` });
  });

  test("start=0 assemble + content_span keeps think so the prompt prefixes KV", () => {
    const t1 = "<think>\nstep\n</think>\n\nanswer one";
    const t2 = "<think>\nmore\n</think>\n\nanswer two";
    const assembled = assembleEngineHistory(
      [
        { role: "user", text: "u1" },
        { role: "assistant", text: "answer one", modelEmittedText: t1 },
        { role: "user", text: "u2" },
        { role: "assistant", text: "answer two", modelEmittedText: t2 },
      ],
      { compactionEnabled: false, hasImages: false, legacyWindowStart: 0 },
    );
    const placement = historyThinkPlacementForModel(undefined);
    const a1 = llamaHistoryAssistantFields(
      { role: "assistant", content: assembled[1]!.content, modelEmittedText: assembled[1]!.modelEmittedText },
      { historyThink: placement },
    );
    const a2 = llamaHistoryAssistantFields(
      { role: "assistant", content: assembled[3]!.content, modelEmittedText: assembled[3]!.modelEmittedText },
      { historyThink: placement },
    );
    expect(a1.content).toBe(t1);
    expect(a2.content).toBe(t2);
    expect(a1.reasoning_content).toBe("");
    expect(assembled[0]?.content).toBe("u1");
  });
});

describe("historyBudgetCharge", () => {
  const base = { historyThink: "reasoning_content" as const, baseMessageCap: 4000 };

  test("an emission longer than the cap is charged at its FULL replay length", () => {
    // Assembly never caps the replay field (toEngineHistoryMessage: it must
    // stay byte-identical to what fed the KV), so the budget must not cap its
    // charge either. LFM2.5 declares nPredict 2048 tokens (~7k chars, think
    // span included) — crossing the 4000-char cap is reachable, not theory.
    const emission = `REASONING</think>${"x".repeat(5000)}`;
    const charge = historyBudgetCharge(
      { role: "assistant", text: "short ui", modelEmittedText: emission },
      base,
    );
    expect(charge).toBe(emission.length + "<think>".length);
    expect(charge).toBeGreaterThan(4000);
  });

  test("a short emission and fallback content are charged capped, as assembly builds them", () => {
    const short = "answer";
    expect(
      historyBudgetCharge(
        { role: "assistant", text: "ui", modelEmittedText: short },
        base,
      ),
    ).toBe(short.length + "<think>".length);
    // Stored text IS capped by assembly, so the charge is capped too — the
    // cap keeps the job it still has.
    const longUser = "u".repeat(9000);
    expect(
      historyBudgetCharge({ role: "user", text: longUser }, base),
    ).toBe(4000);
    expect(
      historyBudgetCharge({ role: "user", text: longUser }, { ...base, userTailChars: 180 }),
    ).toBe(4180);
  });

  test("user tail rides only user messages, exactly as assembly applies it", () => {
    const opts = { ...base, userTailChars: 120 };
    expect(
      historyBudgetCharge({ role: "user", text: "hello" }, opts),
    ).toBe(5 + 120);
    expect(
      historyBudgetCharge(
        { role: "assistant", text: "hello", modelEmittedText: "hello" },
        opts,
      ),
    ).toBe(5 + "<think>".length);
  });
});

describe("emissionSource (provenance of a stored emission)", () => {
  test("raw accumulation: the seed is restored unconditionally, even over an echoed tag", () => {
    // The model echoed the seeded tag itself: the KV holds TWO opens, so the
    // replay must render seed + echo. The syntactic predicate alone rendered
    // one — the divergence this flag exists to close.
    expect(
      llamaHistoryAssistantFields({
        role: "assistant",
        content: "",
        modelEmittedText: "<think>unfinished",
        emissionSource: "raw",
      }),
    ).toEqual({ content: "<think><think>unfinished" });
    // Common abort shape: no tag in the accumulation; seed restored anyway.
    expect(
      llamaHistoryAssistantFields({
        role: "assistant",
        content: "",
        modelEmittedText: "partial answer",
        emissionSource: "raw",
      }),
    ).toEqual({ content: "<think>partial answer" });
    expect(
      historyReplayCharLength(
        {
          role: "assistant",
          text: "ui",
          modelEmittedText: "<think>unfinished",
          emissionSource: "raw",
        },
        { historyThink: "reasoning_content" },
      ),
    ).toBe("<think>unfinished".length + "<think>".length);
  });

  test("parsed: the parser kept the seed tag — never duplicated", () => {
    const raw = "<think>\n\n</think>answer";
    expect(
      llamaHistoryAssistantFields({
        role: "assistant",
        content: "answer",
        modelEmittedText: raw,
        emissionSource: "parsed",
      }),
    ).toEqual({ content: raw });
    expect(
      historyReplayCharLength(
        { role: "assistant", text: "ui", modelEmittedText: raw, emissionSource: "parsed" },
        { historyThink: "reasoning_content" },
      ),
    ).toBe(raw.length);
  });

  test("unknown provenance (no flag) keeps the pre-flag syntactic behaviour", () => {
    // Stored turns without the flag stay valid — no migration, no invalidation.
    expect(
      llamaHistoryAssistantFields({
        role: "assistant",
        content: "",
        modelEmittedText: "<think>kept",
      }),
    ).toEqual({ content: "<think>kept" });
    expect(
      llamaHistoryAssistantFields({
        role: "assistant",
        content: "",
        modelEmittedText: "prefixed",
      }),
    ).toEqual({ content: "<think>prefixed" });
    expect(
      historyReplayCharLength(
        { role: "assistant", text: "ui", modelEmittedText: "<think>kept" },
        { historyThink: "reasoning_content" },
      ),
    ).toBe("<think>kept".length);
  });
});

describe("emissionSource writer audit", () => {
  // The flag describes a string JS itself produced; it becomes a lie the
  // moment anything mutates the string without rewriting it. Assistant text
  // has NO in-place edit path today (editing re-sends and produces a NEW
  // turn), so the invariant is structural: the audit enumerates EVERY writer
  // of modelEmittedText in src and requires it to handle emissionSource in
  // the same region. In-place editing of assistant text would add a write —
  // this audit fails naming the file until that writer sets or clears the
  // flag and the expected counts are updated on purpose.
  const fs = require("fs") as typeof import("fs");
  const path = require("path") as typeof import("path");
  const srcRoot = path.join(__dirname, "..");
  // Writes only: excludes `===` / `!==` / `>=` comparisons and reads.
  const assignRe = /\w+\.modelEmittedText\s*=(?![=>])/g;
  const literalRe = /\{\s*modelEmittedText:/g;
  // Per-file expectation: [property assignments, object-literal writes].
  const expected: Record<string, [number, number]> = {
    "screens/AiChatPage.tsx": [1, 1], // hydration restore; finalize spread
    "app/AppShell.tsx": [2, 0], // validateHistoryMessages; engine-message copy
    "context/compactor.ts": [1, 0], // toEngineHistoryMessage
    "engine/historyPersistable.ts": [1, 0], // persistence normaliser
  };

  function listSources(dir: string): string[] {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .flatMap((e) => {
        const p = path.join(dir, e.name);
        return e.isDirectory() ? listSources(p) : /\.tsx?$/.test(e.name) ? [p] : [];
      })
      .filter((p) => !/\.test\./.test(p));
  }

  test("every writer of modelEmittedText handles emissionSource beside it", () => {
    for (const [rel, [assigns, literals]] of Object.entries(expected)) {
      const src = fs.readFileSync(path.join(srcRoot, rel), "utf8");
      const assignsFound = src.match(assignRe) ?? [];
      const literalsFound = src.match(literalRe) ?? [];
      expect(assignsFound.length).toBe(assigns);
      expect(literalsFound.length).toBe(literals);
      for (const m of [...assignsFound, ...literalsFound]) {
        const at = src.indexOf(m);
        const region = src.slice(Math.max(0, at - 200), at + m.length + 400);
        expect(region).toContain("emissionSource");
      }
    }
  });

  test("no seventh writer exists anywhere in src without registering itself", () => {
    let total = 0;
    let unregistered: string[] = [];
    for (const file of listSources(srcRoot)) {
      const src = fs.readFileSync(file, "utf8");
      const hits = [...(src.match(assignRe) ?? []), ...(src.match(literalRe) ?? [])];
      total += hits.length;
      if (hits.length > 0 && expected[path.relative(srcRoot, file)] === undefined) {
        unregistered.push(`${path.relative(srcRoot, file)}: ${hits.length}`);
      }
    }
    expect(unregistered).toEqual([]);
    expect(total).toBe(6);
  });
});

describe("readModelEmittedText (persist/restore field)", () => {
  test("survives a persist-shaped round-trip for assistant messages", () => {
    const cleaned = "Salvato! 👋";
    const emitted = "«EMITTED»\n\nSalvato! 👋";
    // Shape mirrors buildPersistableMessages (spread + strip transients) then
    // sanitizeHistoryMessages restore via readModelEmittedText.
    const live = {
      id: "a1",
      role: "assistant" as const,
      text: cleaned,
      modelEmittedText: emitted,
      streaming: true,
      statusLabel: "Writing",
      createdAt: 1,
    };
    const persisted = {
      ...live,
      streaming: undefined,
      statusLabel: undefined,
      statusHistory: undefined,
    };
    const restoredText = persisted.text;
    const restoredEmitted = readModelEmittedText(
      persisted.role,
      persisted.modelEmittedText,
    );
    expect(restoredEmitted).toBe(emitted);
    expect(restoredText).toBe(cleaned);
  });

  test("empty / non-assistant / non-string → undefined (no field)", () => {
    expect(readModelEmittedText("assistant", "")).toBeUndefined();
    expect(readModelEmittedText("assistant", "   ")).toBeUndefined();
    expect(readModelEmittedText("user", "x")).toBeUndefined();
    expect(readModelEmittedText("assistant", 42)).toBeUndefined();
    expect(readModelEmittedText("assistant", null)).toBeUndefined();
  });
});

describe("normalizeModelEmittedTextForSave", () => {
  test("whitespace-only emission normalises to absent at save", () => {
    expect(normalizeModelEmittedTextForSave("assistant", "   \n\t  ")).toBeUndefined();
    expect(normalizeModelEmittedTextForSave("assistant", "")).toBeUndefined();
    expect(normalizeModelEmittedTextForSave("assistant", "  hello  ")).toBe("  hello  ");
    expect(normalizeModelEmittedTextForSave("user", "  hello  ")).toBeUndefined();
  });

  test("save and load are one policy: a leading newline survives both", () => {
    // The abort path stores the raw token accumulation, which can begin with
    // "\n". Save preserves it; the load path (AppShell validateHistoryMessages)
    // once trimmed it, so the replay lost the newline the KV holds and the
    // turn diverged at its first token.
    const raw = "\nREASONING</think>ANSWER";
    const saved = normalizeModelEmittedTextForSave("assistant", raw);
    expect(saved).toBe(raw);
    expect(readModelEmittedText("assistant", saved)).toBe(raw);
  });

  test("load refuses whitespace-only exactly like save — no third rule", () => {
    for (const value of ["", "   ", "\n\t "]) {
      expect(readModelEmittedText("assistant", value)).toBeUndefined();
      expect(normalizeModelEmittedTextForSave("assistant", value)).toBeUndefined();
    }
  });
});

describe("modelEmittedTextForVisibleReply (fallback / canned)", () => {
  test("fallback round that produces only markup → no modelEmittedText", () => {
    const rawMarkup = "<think>planning</think><tool_call>noop</tool_call>";
    // Cleaned visible text empty → canned message path; raw scraps must not attach.
    expect(modelEmittedTextForVisibleReply("", rawMarkup)).toBeUndefined();
    expect(modelEmittedTextForVisibleReply("   ", rawMarkup)).toBeUndefined();
  });

  test("fallback with surviving cleaned text keeps raw emission", () => {
    const raw = "<think>x</think>\n\nHello user";
    expect(modelEmittedTextForVisibleReply("Hello user", raw)).toBe(raw);
  });
});

describe("historyWindowReproducesKv", () => {
  test("normal window with captured emitted text → accepted", () => {
    const window = [
      { role: "user", text: "hi" },
      { role: "assistant", text: "hello", modelEmittedText: "hello raw" },
    ];
    expect(historyWindowReproducesKv(window)).toEqual({ accept: true });
  });

  test("legacy history (no field) with text → accepted", () => {
    const window = [
      { role: "user", text: "hi" },
      { role: "assistant", text: "hello" },
    ];
    expect(historyWindowReproducesKv(window)).toEqual({ accept: true });
  });

  test("empty assistant (no text, no content, no emitted) → refused", () => {
    expect(
      historyWindowReproducesKv([{ role: "assistant", text: "" }]),
    ).toEqual({
      accept: false,
      reason: HISTORY_NOT_REPRODUCIBLE,
    });
  });

  test("interrupted assistant with text and no emitted → accepted", () => {
    const window = [
      { role: "user", text: "hi" },
      {
        role: "assistant",
        text: "partial…",
        interrupted: true,
      },
    ];
    expect(historyWindowReproducesKv(window)).toEqual({ accept: true });
  });

  test("interrupted assistant with empty text and no emitted → refused", () => {
    expect(
      historyWindowReproducesKv([
        { role: "assistant", text: "", interrupted: true },
      ]),
    ).toEqual({
      accept: false,
      reason: HISTORY_NOT_REPRODUCIBLE,
    });
  });

  test("interrupted assistant WITH emitted text → accepted", () => {
    const window = [
      {
        role: "assistant",
        text: "partial…",
        interrupted: true,
        modelEmittedText: "partial raw",
      },
    ];
    expect(historyWindowReproducesKv(window)).toEqual({ accept: true });
  });

  test("emission longer than any content cap → never replayed short; full text kept", () => {
    // Generation ceiling can exceed LEGACY_MAX_CHARS (and always exceeds
    // LEGACY_MAX_CHARS_IMAGES). Old code sliced modelEmittedText → KV diverge.
    // Fix: keep full field; window remains reproducible.
    const long = "x".repeat(LEGACY_MAX_CHARS + 500);
    const longerThanImageCap = "y".repeat(LEGACY_MAX_CHARS_IMAGES + 100);
    const window = [
      { role: "user", text: "q" },
      { role: "assistant", text: "short ui", modelEmittedText: long },
      { role: "user", text: "img?" },
      {
        role: "assistant",
        text: "img ui",
        modelEmittedText: longerThanImageCap,
      },
    ];
    // Old silent-truncate would have made replay short — assert full length.
    expect(long.length).toBeGreaterThan(LEGACY_MAX_CHARS);
    expect(longerThanImageCap.length).toBeGreaterThan(LEGACY_MAX_CHARS_IMAGES);

    const assembledNoImg = assembleEngineHistory(
      [
        { role: "user", text: "q" },
        { role: "assistant", text: "short ui", modelEmittedText: long },
      ],
      { compactionEnabled: false, hasImages: false },
    );
    expect(assembledNoImg[1]?.modelEmittedText).toBe(long);
    expect(assembledNoImg[1]?.modelEmittedText?.length).toBe(long.length);

    const assembledImg = assembleEngineHistory(
      [
        { role: "user", text: "img?" },
        {
          role: "assistant",
          text: "img ui",
          modelEmittedText: longerThanImageCap,
        },
      ],
      { compactionEnabled: false, hasImages: true },
    );
    expect(assembledImg[1]?.modelEmittedText).toBe(longerThanImageCap);
    // content still capped; replay field must not be
    expect(assembledImg[1]?.content.length).toBeLessThanOrEqual(LEGACY_MAX_CHARS_IMAGES);
    expect(assembledImg[1]?.modelEmittedText?.length).toBe(longerThanImageCap.length);

    // Truncated emission (simulating the old poison) cannot reproduce KV.
    const poisoned = [
      {
        role: "assistant",
        text: "ui",
        // Empty after a "cap marked non-reproducible" policy would drop the field;
        // missing field → named refusal (never silently replay short).
        modelEmittedText: undefined,
      },
    ];
    expect(historyWindowReproducesKv(poisoned)).toEqual({ accept: true });

    // Full long emission is accepted.
    expect(historyWindowReproducesKv(window)).toEqual({ accept: true });
  });
});
