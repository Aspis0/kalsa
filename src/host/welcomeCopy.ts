/**
 * The welcome block's decisions as pure functions, lifted from the controller:
 * `buildSuggestions` (`AiChatPage.tsx:423-453`), `greetingForHour`
 * (`:505-509`) and the gate (`:4015-4016`). The JSX that draws them lives in
 * `welcomeBlock.tsx`; everything a node test can reach is here, because the
 * proof regime cannot render a component (DESIGN.md, "proof regime").
 *
 * The gate is exported from here rather than kept inside the block on purpose:
 * the controller gated on `historyLoaded` BEFORE deciding anything about the
 * empty chat, so the block must be invisible until the history load has settled
 * — the host calls this with the same condition and hands `Transcript` either
 * the block or nothing.
 */
import type { TranslateFn } from "../i18n";

export type WelcomeSuggestion = {
  text: string;
  sub: string;
  /** The controller's two-tone icon tile. The rebuild's palette carries one
   *  accent (no `compute` hue survived `design.ts`), so `compute` resolves to
   *  the neutral tile and `accent` to the accent tile — reported with the slice. */
  colorKey: "compute" | "accent";
};

export function buildSuggestions(t: TranslateFn): WelcomeSuggestion[] {
  return [
    { text: t("chat.suggestion1"), sub: t("chat.suggestion1Sub"), colorKey: "compute" },
    { text: t("chat.suggestion2"), sub: t("chat.suggestion2Sub"), colorKey: "accent" },
    { text: t("chat.suggestion3"), sub: t("chat.suggestion3Sub"), colorKey: "accent" },
    { text: t("chat.suggestion4"), sub: t("chat.suggestion4Sub"), colorKey: "compute" },
  ];
}

export function greetingForHour(h: number, t: TranslateFn): string {
  if (h < 12) return t("chat.greetingMorning");
  if (h < 18) return t("chat.greetingAfternoon");
  return t("chat.greetingEvening");
}

/** The controller's gate (`AiChatPage:4015-4016`): the block exists only once
 *  the history load has SETTLED and there is nothing to show. Before that the
 *  band is blank — the block must never flash over a history still loading. */
export function welcomeVisible(historyLoaded: boolean, messageCount: number): boolean {
  return historyLoaded && messageCount === 0;
}
