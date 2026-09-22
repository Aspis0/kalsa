/**
 * The pre-send content gate's localized decline, carried into the host at
 * `sendHost.ts`. Own module because `sendHost.ts` crossed the 350-line
 * ratchet and the owner's rule is to cut a seam, never raise the number —
 * this pure key-mapping function was the seam, moved verbatim: same reasons,
 * same keys, same default.
 *
 * `classifyChatContent`'s built-in formatter is English-only, so every
 * user-visible line routes through i18n keyed on the same reasons.
 */
import type { ContentFilterReason } from "../domain/contentFilter";
import type { TranslateFn } from "../i18n";

export function contentFilterMessage(reason: ContentFilterReason | null, t: TranslateFn): string {
  switch (reason) {
    case "self_harm":
      return t("contentFilter.selfHarm");
    case "child_exploitation":
    case "sex_crimes":
      return t("contentFilter.sexualAbuse");
    case "unsafe_bio":
    case "unsafe_chem":
      return t("contentFilter.unsafeScience");
    case "privacy":
      return t("contentFilter.privacy");
    case "prompt_injection":
      return t("contentFilter.promptInjection");
    case "non_violent_crime":
    case "violent_crime":
      return t("contentFilter.illegalActivity");
    default:
      return t("contentFilter.generic");
  }
}
