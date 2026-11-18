import type { Review } from "./types";

/** The Kalsa review record, stated plainly: a review lowers risk, not to zero. */
export function reviewText(review: Review | null): string {
  if (review) {
    return `No suspicious changes found in the diff against ${review.upstream} at ${review.commit}. A review lowers the risk; it cannot remove it.`;
  }
  return "Not reviewed yet. Being in the catalogue means it passes the rules; the code has not been checked by Kalsa.";
}

/** Only reviewed engines carry a pill; absence means not reviewed. */
export function EngineBadge({ reviewed }: { reviewed: Review | null }) {
  if (!reviewed) return null;
  return <span className="eg-badge">{`Reviewed ${reviewed.commit}`}</span>;
}
