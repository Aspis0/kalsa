/**
 * Text-to-speech via expo-speech (~57).
 * Preference key: kalsa.tts.enabled (default true).
 *
 * Docs: https://docs.expo.dev/versions/v57.0.0/sdk/speech/
 *
 * Robustness:
 * - setTtsEnabled(false) always calls stop() in finally (even if setItem fails).
 * - Long text is split into ~500-char segments spoken in sequence (onDone → next).
 * - Voice fallback: preferred BCP-47 tag → any voice matching language prefix → en.
 * - onError surfaces engine/voice failures to the caller (map to voice.ttsError in UI).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Speech from "expo-speech";

import type { Locale } from "../i18n";

export const TTS_ENABLED_KEY = "kalsa.tts.enabled";

/** Soft segment length — well under platform maxSpeechInputLength on Android. */
const SEGMENT_CHARS = 500;

const LANG: Record<Locale, string> = {
  en: "en-US",
  it: "it-IT",
};

export type SpeakHandlers = {
  onStart?: () => void;
  onDone?: () => void;
  onStopped?: () => void;
  onError?: (error: Error) => void;
};

/** Read TTS preference; default true when unset. */
export async function isTtsEnabled(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(TTS_ENABLED_KEY);
    if (raw === null) return true;
    return raw === "1" || raw === "true";
  } catch {
    return true;
  }
}

/**
 * Persist the TTS preference. When disabling, always stop speech in `finally`
 * so a storage failure cannot leave the engine speaking.
 */
export async function setTtsEnabled(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(TTS_ENABLED_KEY, enabled ? "1" : "0");
  } finally {
    if (!enabled) {
      await stop().catch(() => undefined);
    }
  }
}

export async function isSpeaking(): Promise<boolean> {
  try {
    return await Speech.isSpeakingAsync();
  } catch {
    return false;
  }
}

export async function stop(): Promise<void> {
  try {
    await Speech.stop();
  } catch {
    // ignore
  }
}

/**
 * Pick a voice for the locale:
 * 1. exact BCP-47 match (e.g. it-IT)
 * 2. any voice whose language starts with the primary subtag (e.g. "it")
 * 3. first English voice
 * 4. undefined → let the OS pick
 */
async function resolveVoice(
  locale: Locale,
): Promise<{ language: string; voice?: string }> {
  const preferred = LANG[locale] ?? LANG.en;
  const primary = preferred.split("-")[0]?.toLowerCase() ?? "en";

  try {
    const voices = await Speech.getAvailableVoicesAsync();
    if (!voices?.length) {
      return { language: preferred };
    }

    const exact = voices.find(
      (v) => v.language?.toLowerCase() === preferred.toLowerCase(),
    );
    if (exact) {
      return { language: exact.language, voice: exact.identifier };
    }

    const langMatch = voices.find((v) =>
      v.language?.toLowerCase().startsWith(primary),
    );
    if (langMatch) {
      return { language: langMatch.language, voice: langMatch.identifier };
    }

    // Fallback: any English voice, then first available.
    const enVoice =
      voices.find((v) => v.language?.toLowerCase().startsWith("en")) ??
      voices[0];
    if (enVoice) {
      return { language: enVoice.language, voice: enVoice.identifier };
    }
  } catch {
    // Voice enumeration failed — use language tag only.
  }
  return { language: preferred };
}

/** Split text into segments of roughly `maxChars`, preferring whitespace breaks. */
function splitSegments(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const segments: string[] = [];
  let rest = text;
  while (rest.length > maxChars) {
    let cut = rest.lastIndexOf(" ", maxChars);
    if (cut < maxChars * 0.4) {
      // No good break — hard cut.
      cut = maxChars;
    }
    segments.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) segments.push(rest);
  return segments.filter((s) => s.length > 0);
}

/**
 * Speak one segment; chains to the next via onDone.
 * Uses a generation token so stop() mid-sequence abandons remaining segments.
 */
let speakGeneration = 0;

function speakSegmentChain(
  segments: string[],
  index: number,
  language: string,
  voice: string | undefined,
  generation: number,
  handlers?: SpeakHandlers,
): void {
  if (generation !== speakGeneration) {
    handlers?.onStopped?.();
    return;
  }
  if (index >= segments.length) {
    handlers?.onDone?.();
    return;
  }

  const isFirst = index === 0;
  const isLast = index === segments.length - 1;

  Speech.speak(segments[index], {
    language,
    voice,
    rate: 1.0,
    pitch: 1.0,
    onStart: isFirst ? handlers?.onStart : undefined,
    onDone: () => {
      if (generation !== speakGeneration) {
        handlers?.onStopped?.();
        return;
      }
      if (isLast) {
        handlers?.onDone?.();
      } else {
        speakSegmentChain(
          segments,
          index + 1,
          language,
          voice,
          generation,
          handlers,
        );
      }
    },
    onStopped: () => {
      // User/stop() interrupted — abandon remaining segments.
      speakGeneration += 1;
      handlers?.onStopped?.();
    },
    onError: (error) => {
      speakGeneration += 1;
      handlers?.onError?.(
        error instanceof Error ? error : new Error(String(error)),
      );
    },
  });
}

/**
 * Speak text in the settings locale language.
 * No-ops on empty text. Does NOT check the enabled preference
 * (caller decides — Settings toggle gates the UI).
 *
 * Long text is spoken as sequential ~500-char segments (not silently truncated).
 * Voice selection falls back when the preferred locale voice is missing.
 */
export function speak(
  text: string,
  locale: Locale,
  handlers?: SpeakHandlers,
): void {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    handlers?.onDone?.();
    return;
  }

  const generation = ++speakGeneration;
  const platformMax =
    typeof Speech.maxSpeechInputLength === "number"
      ? Speech.maxSpeechInputLength
      : 4000;
  const segmentSize = Math.min(SEGMENT_CHARS, platformMax);

  // Resolve voice asynchronously, then start the chain.
  void (async () => {
    try {
      if (generation !== speakGeneration) return;
      const { language, voice } = await resolveVoice(locale);
      if (generation !== speakGeneration) return;
      const segments = splitSegments(cleaned, segmentSize);
      if (!segments.length) {
        handlers?.onDone?.();
        return;
      }
      speakSegmentChain(segments, 0, language, voice, generation, handlers);
    } catch (error) {
      if (generation !== speakGeneration) return;
      handlers?.onError?.(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  })();
}

/**
 * Toggle: if currently speaking → stop; else start speaking.
 * Returns the action taken.
 */
export async function toggleSpeak(
  text: string,
  locale: Locale,
  handlers?: SpeakHandlers,
): Promise<"started" | "stopped"> {
  if (await isSpeaking()) {
    await stop();
    handlers?.onStopped?.();
    return "stopped";
  }
  speak(text, locale, handlers);
  return "started";
}
