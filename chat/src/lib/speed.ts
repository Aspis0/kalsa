import type { English } from "../i18n/en/all";

/** A measured speed as words and its figure together: quick, steady, or a
    moment, each resting on the tokens/s it was taken at. One helper, so the
    Models page and the Power page can never describe the same number
    differently. */
export function speedLine(t: English["machine"], tag: string, tokensPerSecond: number): string {
  const rate = new Intl.NumberFormat(tag, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(tokensPerSecond);
  if (tokensPerSecond >= 20) return t.speedFast(rate);
  if (tokensPerSecond >= 10) return t.speedSteady(rate);
  return t.speedSlow(rate);
}
