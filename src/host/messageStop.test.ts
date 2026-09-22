/**
 * What a turn that ended early DRAWS as, through the mapper — the rules of
 * DESIGN.md §2.8 (stop's outcomes, the engine's own reason, danger tone) and
 * §2.11 (the streaming caret), plus the sanitize round-trip that keeps the
 * mark alive across a reopen. Split out of `messageMapper.test.ts` when that
 * file crossed the host's 350-line budget: the helpers below are its own, the
 * assertions are the same rules, nothing was weakened in the move.
 *
 * The gap this pins is `docs/PARITY-STATUS.md` gap 2: an interrupted or
 * failed turn used to render exactly like a completed one.
 */
import { en } from "../i18n/en";
import { sanitizeHistoryMessages } from "./historyMessages";
import {
  toTranscriptMessage,
  toTranscriptMessages,
  type MapperOptions,
} from "./messageMapper";
import type { Message } from "./hostMessage";

const THINKING = en.chat.thinkingStatus as string;
const WRITING = en.chat.writingStatus as string;

const opts = (extra?: Partial<MapperOptions>): MapperOptions => ({
  thinkingStatus: THINKING,
  ...extra,
});

const base = (over: Partial<Message>): Message => ({
  id: "m1",
  role: "user",
  text: "hello",
  createdAt: 1_700_000_000_000,
  ...over,
});

describe("§2.11 / §2.8 — the caret and the stop line", () => {
  test("a live answer that already has text carries the caret; a user turn never does", () => {
    const live = toTranscriptMessage(
      base({ role: "assistant", text: "The third", streaming: true, statusLabel: WRITING }),
      opts(),
    );
    expect(live.caret).toBe(true);
    const user = toTranscriptMessage(base({ text: "The third" }), opts());
    expect("caret" in user).toBe(false);
  });

  test("no caret before the first token and none once the turn settles", () => {
    const preToken = toTranscriptMessage(
      base({ role: "assistant", text: "", streaming: true, statusLabel: THINKING }),
      opts(),
    );
    expect("caret" in preToken).toBe(false);
    const settled = toTranscriptMessage(
      base({ role: "assistant", text: "done", streaming: false }),
      opts(),
    );
    expect("caret" in settled).toBe(false);
    expect("stop" in settled).toBe(false);
  });

  test("an interrupted partial draws the user's stop line, quiet — marked, not finished", () => {
    const out = toTranscriptMessage(
      base({ role: "assistant", text: "partial", streaming: false, interrupted: true }),
      opts(),
    );
    expect(out.stop).toEqual({ key: "shell.phase.stoppedByUser", tone: "quiet" });
    expect("caret" in out).toBe(false);
    // The partial's text is untouched: the marker sits beside it, never over it.
    expect(out.text).toBe("partial");
  });

  test("a failure carries the engine's own reason in danger (§2.8)", () => {
    const out = toTranscriptMessage(
      base({
        role: "assistant",
        text: "partial",
        failed: true,
        failureReason: "CUDA out of memory",
      }),
      opts(),
    );
    expect(out.stop).toEqual({
      key: "shell.composer.stopFailed",
      params: { reason: "CUDA out of memory" },
      tone: "danger",
    });
  });

  test("a failure with no reason draws the honest line — never an apology-shaped key", () => {
    for (const failureReason of [undefined, "", "   "]) {
      const out = toTranscriptMessage(
        base({
          role: "assistant",
          text: "⚠️ decode session halted",
          failed: true,
          ...(failureReason !== undefined ? { failureReason } : {}),
        }),
        opts(),
      );
      expect(out.stop).toEqual({ key: "shell.phase.failed", tone: "danger" });
      expect(out.stop?.params).toBeUndefined();
    }
  });

  test("the device's thermal refusal draws §2.8's attention row, not the failed row", () => {
    const out = toTranscriptMessage(
      base({
        role: "assistant",
        text: "⚠️ too warm",
        failed: true,
        failureThermal: true,
        failureReason: "thermal hard gate",
      }),
      opts(),
    );
    expect(out.stop).toEqual({ key: "shell.phase.tooHot", tone: "attention" });
  });

  test("failed beats interrupted when a corrupt payload carries both", () => {
    const out = toTranscriptMessage(
      base({ role: "assistant", text: "x", failed: true, interrupted: true }),
      opts(),
    );
    expect(out.stop?.tone).toBe("danger");
  });
});

describe("sanitize → mapper round trip of a failed turn", () => {
  test("the marker and the engine's own reason survive a reopen", () => {
    const restored = sanitizeHistoryMessages(
      [
        {
          id: "a1",
          role: "assistant",
          text: "⚠️ decode session halted",
          createdAt: 6,
          failed: true,
          failureReason: "decode session halted",
        },
        // Corrupt payloads must never reach the band: a reason with no failure,
        // a marker over empty text, and non-string markers.
        {
          id: "a2",
          role: "assistant",
          text: "fine",
          createdAt: 7,
          failureReason: "decode session halted",
        },
        {
          id: "a3",
          role: "assistant",
          text: "   ",
          createdAt: 8,
          failed: true,
          failureReason: "boom",
        },
        {
          id: "a4",
          role: "assistant",
          text: "bad",
          createdAt: 9,
          failed: "yes",
          failureReason: 42,
        },
      ],
      "en",
    );
    const out = toTranscriptMessages(restored, opts());
    expect(out[0].stop).toEqual({
      key: "shell.composer.stopFailed",
      params: { reason: "decode session halted" },
      tone: "danger",
    });
    expect("stop" in out[1]).toBe(false);
    expect("stop" in out[2]).toBe(false);
    expect("stop" in out[3]).toBe(false);
  });
});
