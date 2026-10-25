/**
 * What a blocked send answers in place of the model: the decline in the
 * person's language, keyed on the reason the classifier gave. A send the
 * classifier lets through gets no decline.
 */
import { classifyChatContent, type ContentFilterReason } from "./contentFilter";
import type { ContentFilterCopy } from "../i18n/en/contentFilter";

export function contentDecline(text: string, copy: ContentFilterCopy): string | null {
  const result = classifyChatContent(text);
  if (result.shouldCallProvider) return null;
  return declineFor(result.reason, copy);
}

function declineFor(reason: ContentFilterReason | null, copy: ContentFilterCopy): string {
  switch (reason) {
    case "self_harm":
      return copy.selfHarm;
    case "child_exploitation":
    case "sex_crimes":
      return copy.sexualAbuse;
    case "unsafe_bio":
    case "unsafe_chem":
      return copy.unsafeScience;
    case "privacy":
      return copy.privacy;
    case "prompt_injection":
      return copy.promptInjection;
    case "non_violent_crime":
    case "violent_crime":
      return copy.illegalActivity;
    default:
      return copy.generic;
  }
}
