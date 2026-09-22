/**
 * The pre-send content gate's localized decline (lifted `AiChatPage:532-558`,
 * carried into the host at `sendHost.ts`). It lives in its own module because
 * `sendHost.ts` crossed the 350-line ratchet when the composer arms landed and
 * the owner's rule is to cut a seam, never raise the number
 * (`src/host/fileSize.test.ts`) — this pure key-mapping function was the seam,
 * moved verbatim: same reasons, same keys, same default.
 *
 * X2, the controller's own note: `classifyChatContent`'s built-in formatter is
 * English-only, so every user-visible line routes through i18n keyed on the
 * same reasons.
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
