/**
 * The timing model behind the thought cloud: the rolling window of token
 * arrivals, the bubble period derived from the measured rate, the throttling of
 * the pace writes, the phase machine, and the two forms of the label.
 *
 * No React and no React Native imports on purpose. Everything below is a number
 * or a phase, so it can be asserted directly.
 *
 * Every constant is the desktop's own number, taken from
 * kalsa-brain/chat/src/components/ThoughtCloud.tsx or ThoughtCloud.css; the
 * comment next to each names the rule it comes from.
 */

/** `now - t < 2000`: the arrivals that still count towards the rate. */
export const TOKEN_WINDOW_MS = 2000;
/** `now - lastTempoWrite < 350` skips the write: at most three writes a second. */
export const TEMPO_WRITE_MS = 350;
/** `--bubble-period: 1.8s` and `Math.min(2.4, Math.max(0.7, 1.8 / rate))`. */
export const BASE_PERIOD_S = 1.8;
export const MIN_PERIOD_S = 0.7;
export const MAX_PERIOD_S = 2.4;
/** `Math.max(rate, 0.6)`: a slow stream stops slowing the pace down here. */
export const FLOOR_RATE_PER_S = 0.6;
/** The desktop clears `settling` 1500 ms after the rise -> answer transition. */
export const SETTLE_MS = 1500;
/** `bubble-settle 0.9s`, with `animation-delay` 0 / 0.12s / 0.24s. */
export const SETTLE_DURATION_MS = 900;
export const SETTLE_STAGGER_MS = [0, 120, 240] as const;
/** RISE_STAGGER_TURNS lives in ./thoughtMotion.ts: the third-of-a-turn offset moves a pose, not the clock. */
/** `.slice(-140)` on the live tail. */
export const TICKER_MAX_CHARS = 140;
export const TICKER_FALLBACK = "Thinking…";
/** `summary()` when no duration was measured, and below one second. */
export const SUMMARY_PENDING = "Thinking";
export const SUMMARY_UNDER_A_SECOND = "Thought for less than a second";

export type ThinkingPhase = "rise" | "settle" | "rest";

/** What the caller knows: tokens still arriving, answer started. */
export interface ThinkingMode {
  /** Reasoning tokens are still arriving. */
  working: boolean;
  /** Answer text has started arriving. */
  answered: boolean;
}

export interface TimingState {
  /** Arrival clocks inside the window, oldest first. */
  readonly arrivals: readonly number[];
  /** Clock of the last pace write; `-Infinity` until the first one. */
  readonly lastWrite: number;
  /** Bubble period in seconds, clamped and quantised. */
  readonly period: number;
  /** The mode last handed to `onMode`; the phase is derived from it. */
  readonly rising: boolean;
  /** The rise has run since the last settle (the desktop's `rose` ref). */
  readonly rose: boolean;
  /** Clock at which the settle gesture ends; null when none is owed. */
  readonly settlingUntil: number | null;
}

export interface TokenTick {
  state: TimingState;
  /** True when this sample passed the throttle: adopt `state.period` then. */
  wrote: boolean;
}

/** `working && !answered`. */
export function risingIn(mode: ThinkingMode): boolean {
  return mode.working && !mode.answered;
}

export function createTimingState(): TimingState {
  return {
    arrivals: [],
    // Not 0: `performance.now()` in the desktop starts far above the throttle,
    // so its first sample always writes. A model clock starting at zero would
    // silently swallow that first write.
    lastWrite: -Infinity,
    period: BASE_PERIOD_S,
    rising: false,
    rose: false,
    settlingUntil: null,
  };
}

/** Drops what fell out of the window and records the arrival. */
export function recordArrival(arrivals: readonly number[], now: number): number[] {
  return [...arrivals.filter((t) => now - t < TOKEN_WINDOW_MS), now];
}

/** `arrivals.length / (window in seconds)` — tokens per second. */
export function tokenRatePerSecond(arrivals: readonly number[]): number {
  return arrivals.length / (TOKEN_WINDOW_MS / 1000);
}

export function shouldWriteTempo(lastWrite: number, now: number): boolean {
  return now - lastWrite >= TEMPO_WRITE_MS;
}

/**
 * `Math.min(2.4, Math.max(0.7, 1.8 / Math.max(rate, 0.6)))`, quantised to two
 * decimals because the desktop writes the value with `toFixed(2)`. A non-finite
 * rate is treated as zero: it would otherwise put NaN into a transform.
 */
export function bubblePeriodSeconds(ratePerSecond: number): number {
  const rate = Number.isFinite(ratePerSecond) ? ratePerSecond : 0;
  const raw = BASE_PERIOD_S / Math.max(rate, FLOOR_RATE_PER_S);
  const clamped = Math.min(MAX_PERIOD_S, Math.max(MIN_PERIOD_S, raw));
  return Math.round(clamped * 100) / 100;
}

/**
 * One token arrived while reasoning. The window is extended on every sample;
 * the period is only recomputed when the throttle lets the sample through,
 * exactly as the desktop's throttled DOM write does.
 */
export function onToken(state: TimingState, now: number): TokenTick {
  const arrivals = recordArrival(state.arrivals, now);
  if (!shouldWriteTempo(state.lastWrite, now)) {
    return { state: { ...state, arrivals }, wrote: false };
  }
  return {
    state: { ...state, arrivals, lastWrite: now, period: bubblePeriodSeconds(tokenRatePerSecond(arrivals)) },
    wrote: true,
  };
}

/**
 * The rise -> answer transition. A repeated mode is a no-op: the settle is armed
 * once per rise, which is why this returns the same object for an unchanged
 * mode, and why a rise clears a deadline that is still running.
 */
export function onMode(state: TimingState, now: number, mode: ThinkingMode): TimingState {
  const rising = risingIn(mode);
  if (state.rising === rising) return state;
  if (rising) return { ...state, rising: true, rose: true, settlingUntil: null };
  if (!state.rose) return { ...state, rising: false, settlingUntil: null };
  if (!mode.answered) return { ...state, rising: false, rose: false, settlingUntil: null };
  return { ...state, rising: false, rose: false, settlingUntil: now + SETTLE_MS };
}

export function phaseAt(state: TimingState, now: number): ThinkingPhase {
  if (state.rising) return "rise";
  if (state.settlingUntil !== null && now < state.settlingUntil) return "settle";
  return "rest";
}

/** Last non-empty line, trimmed, capped at the ticker width. */
export function lastLine(reasoning: string): string {
  const lines = reasoning.split("\n").map((line) => line.trim()).filter(Boolean);
  return (lines.at(-1) ?? "").slice(-TICKER_MAX_CHARS);
}

/** The collapsed face while reasoning: the upstream tail when it has one. */
export function tickerText(tail: string | undefined, reasoning: string): string {
  return (tail ?? lastLine(reasoning)).replace(/\s+$/, "").slice(-TICKER_MAX_CHARS) || TICKER_FALLBACK;
}

/** The collapsed face once reasoning stopped: `Math.round(ms / 100) / 10`. */
export function thinkingSummary(reasoningMs?: number): string {
  if (reasoningMs === undefined) return SUMMARY_PENDING;
  if (reasoningMs < 1000) return SUMMARY_UNDER_A_SECOND;
  const seconds = Math.round(reasoningMs / 100) / 10;
  return `Thought for ${seconds} s`;
}
