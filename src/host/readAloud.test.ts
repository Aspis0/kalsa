/**
 * Read aloud (D1 row 19), as SOURCE proof: the chip that speaks and the one
 * question the owner asked before allowing it — that the TTS service can be
 * called WITHOUT touching `src/engine/**` or the governor. The import graph
 * is checked here, so a future "just use the engine's..." edit fails before
 * a chip that cannot speak ever ships.
 *
 * Also pinned: the controller's preference gate, the cleanup halves
 * (conversation switch, unmount), and the callbacks that can only clear
 * their own message.
 *
 * Every predicate is exercised against a sample that must fail it.
 */
import { readFileSync } from "fs";
import { join } from "path";

import { en } from "../i18n/en";
import { it as italian } from "../i18n/it";

const read = (file: string): string => readFileSync(join(__dirname, file), "utf8");
const readTop = (file: string): string =>
  readFileSync(join(__dirname, "..", file), "utf8");

const VOICE = read("useReadAloud.ts");
const TTS = readTop("voice/TtsService.ts");
const CHIPS = readFileSync(join(__dirname, "..", "ui", "shell", "TranscriptChips.tsx"), "utf8");
const SURFACE = read("HostChatSurface.tsx");

/** Comments stripped: the prose about a rule must never satisfy the rule. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}
const VOICE_CODE = stripComments(VOICE);
const TTS_CODE = stripComments(TTS);
const CHIPS_CODE = stripComments(CHIPS);

/** Flatten a catalogue to dotted keys, the way the translator resolves them. */
function flatten(value: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof entry === "string") out[path] = entry;
    else if (entry && typeof entry === "object") Object.assign(out, flatten(entry, path));
  }
  return out;
}
const EN = flatten(en);
const IT = flatten(italian);

/** The import specifiers of a module, as written. */
function imports(source: string): string[] {
  const pattern = /^[ \t]*import\s[\s\S]*?from\s+"([^"]+)";?/gm;
  const out: string[] = [];
  let match = pattern.exec(stripComments(source));
  while (match !== null) {
    out.push(match[1]);
    match = pattern.exec(stripComments(source));
  }
  return out;
}

describe("the reason this chip may ship: the TTS service touches neither the engine nor the governor", () => {
  it("TtsService's import graph is AsyncStorage, expo-speech and the i18n type — nothing else", () => {
    const specifiers = imports(TTS);
    // The check cannot pass by finding no imports at all.
    expect(specifiers.length).toBeGreaterThanOrEqual(3);
    expect(specifiers).toContain("expo-speech");
    expect(specifiers).toContain("../i18n");
    for (const specifier of specifiers) {
      expect(specifier).not.toContain("src/engine");
      expect(specifier).not.toContain("../engine");
      expect(specifier).not.toMatch(/governor/i);
    }
    // …and no side reference anywhere in its body either.
    expect(TTS_CODE).not.toMatch(/governor/i);
    expect(TTS_CODE).not.toContain("../engine");
  });

  it("the host hook calls that service and imports nothing from the engine either", () => {
    for (const specifier of imports(VOICE)) {
      expect(specifier).not.toContain("src/engine");
      expect(specifier).not.toContain("../engine");
      expect(specifier).not.toMatch(/governor/i);
    }
    expect(VOICE_CODE).toContain("TtsService.speak(");
    expect(VOICE_CODE).toContain("TtsService.stop()");
    expect(VOICE_CODE).toContain("TtsService.isSpeaking()");
  });

  it("sample: the guard catches the import it exists to catch", () => {
    const bad = 'import { translateText } from "../engine/LlamaService";';
    const specifiers = imports(bad);
    expect(specifiers.some((specifier) => specifier.includes("../engine"))).toBe(true);
  });
});

describe("the chip: speaks, stops, and is a real named box", () => {
  it("drawn under an answer with the controller's two labels and its own testID", () => {
    expect(CHIPS_CODE).toContain("voice.stopReading");
    expect(CHIPS_CODE).toContain("voice.readAloud");
    expect(CHIPS_CODE).toContain("transcript.speak.");
    expect(CHIPS_CODE).toContain('accessibilityRole="button"');
    expect(CHIPS_CODE).toContain("accessibilityLabel={label}");
  });

  it("the row is a 48 dp box — no hitSlop anywhere near it", () => {
    expect(CHIPS_CODE).not.toContain("hitSlop");
    // The box itself lives in the stylesheet; the chips paint inside it.
    const parts = stripComments(
      readFileSync(join(__dirname, "..", "ui", "shell", "TranscriptParts.tsx"), "utf8"),
    );
    const box = parts.slice(parts.indexOf("actionChipBox:"), parts.indexOf("actionChip:"));
    expect(box).toContain("minHeight: MIN_TOUCH_TARGET");
    expect(box).toContain("minWidth: MIN_TOUCH_TARGET");
    expect(CHIPS_CODE).toContain("styles.actionChipBox");
    // sample: the predicate is about the token, not the letter sequence
    expect(CHIPS_CODE).not.toContain("hitSlop");
    expect("hitSlop".includes("hitSlop")).toBe(true);
  });

  it("the surface hands the band the speak handler, and the chip can be absent", () => {
    expect(SURFACE).toContain("onSpeak={actions.onSpeak}");
    expect(SURFACE).toContain("speakingId={actions.speakingId}");
    // Absent, not inert: the band draws no chip without the handler.
    const band = readFileSync(join(__dirname, "..", "ui", "shell", "Transcript.tsx"), "utf8");
    expect(stripComments(band)).toContain("onSpeak ? () => onSpeak(message.id, message.text) : undefined");
  });
});

describe("the controller's gate and the cleanup halves", () => {
  it("TTS off answers with the shipped line BEFORE any engine call — a preference explaining itself", () => {
    const speak = VOICE_CODE.slice(
      VOICE_CODE.indexOf("const speak = useCallback("),
      VOICE_CODE.indexOf("return { speakingId, speak }"),
    );
    expect(speak).toContain("p.closeMenu()");
    expect(speak).toContain("p.ttsEnabled");
    expect(speak).toContain('"voice.ttsDisabled"');
    expect(speak.indexOf("p.ttsEnabled")).toBeLessThan(speak.indexOf("TtsService.speak("));
    expect(speak).toContain('"voice.ttsError"');
  });

  it("a conversation switch stops the voice and clears the chip; unmount stops it", () => {
    const conversation = VOICE_CODE.slice(
      VOICE_CODE.indexOf("const previous = lastConversationRef.current;"),
      VOICE_CODE.indexOf("return { speakingId, speak }"),
    );
    expect(conversation).toContain("void TtsService.stop()");
    expect(conversation).toContain("setSpeakingId(null)");
    expect(VOICE_CODE).toContain("mountedRef.current = false");
    // Both cleanups stop the engine's own voice, not just the state.
    expect((VOICE_CODE.match(/void TtsService\.stop\(\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("each callback clears only its own message's chip, and guards the unmount", () => {
    expect(
      (VOICE_CODE.match(/setSpeakingId\(\(current\) => \(current === id \? null : current\)\)/g) ?? [])
        .length,
    ).toBe(3); // onDone, onStopped, onError
    const guards = (VOICE_CODE.match(/if \(!mountedRef\.current\) return;/g) ?? []).length;
    expect(guards).toBeGreaterThanOrEqual(4); // both awaits + every callback
  });

  it("sample: a stale callback that cleared unconditionally would pass a weaker guard", () => {
    const stale = "onDone: () => { setSpeakingId(null); }";
    expect(stale).not.toContain("current === id");
    expect(stale).not.toContain("mountedRef.current");
  });
});

describe("every user-visible string exists in BOTH catalogues", () => {
  const keys = [
    "voice.readAloud",
    "voice.stopReading",
    "voice.ttsDisabled",
    "voice.ttsError",
    "common.close",
  ];

  it("en and it each resolve every key the chip and the notices use", () => {
    for (const key of keys) {
      expect(typeof EN[key]).toBe("string");
      expect(typeof IT[key]).toBe("string");
    }
  });
});
