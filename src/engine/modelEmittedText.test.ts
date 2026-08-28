/**
 * modelEmittedText: prompt replay prefers what the model actually produced;
 * UI-facing text stays the cleaned copy. Pure Node — no React Native.
 */

import {
  HISTORY_NOT_REPRODUCIBLE,
  historyWindowReproducesKv,
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
    expect(normalizeModelEmittedTextForSave("assistant", "  hello  ")).toBe("hello");
    expect(normalizeModelEmittedTextForSave("user", "  hello  ")).toBeUndefined();
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

  test("legacy history (no field) → refused with named reason", () => {
    const window = [
      { role: "user", text: "hi" },
      { role: "assistant", text: "hello" },
    ];
    expect(historyWindowReproducesKv(window)).toEqual({
      accept: false,
      reason: HISTORY_NOT_REPRODUCIBLE,
    });
  });

  test("interrupted assistant without emitted text → refused with named reason", () => {
    const window = [
      { role: "user", text: "hi" },
      {
        role: "assistant",
        text: "partial…",
        interrupted: true,
      },
    ];
    expect(historyWindowReproducesKv(window)).toEqual({
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
    expect(historyWindowReproducesKv(poisoned)).toEqual({
      accept: false,
      reason: HISTORY_NOT_REPRODUCIBLE,
    });

    // Full long emission is accepted.
    expect(historyWindowReproducesKv(window)).toEqual({ accept: true });
  });
});
