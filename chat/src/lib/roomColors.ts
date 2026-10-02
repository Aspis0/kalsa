// The room's name colors: one small palette, handed out in a stable order —
// this computer first, then the paired phones by id — so a member keeps its
// color across a restart and two members never share one while the house
// fits the palette. Kalsa stands outside the rotation: the assistant's own
// green. The values live in tokens.css (one light and one dark tuning per
// hue, all past WCAG AA against the page); scripts/name-contrast.mjs holds
// them there.

import type { RoomMember } from "../surfaces/roomFeed";

export const NAME_COLOR_SLOTS = 5;

export const KALSA_NAME_COLOR = "var(--room-name-kalsa)";

export function nameColor(index: number): string {
  return `var(--room-name-${(index % NAME_COLOR_SLOTS) + 1})`;
}

function rank(member: RoomMember): number {
  return member.kind === "host" ? 0 : 1;
}

/** The color each member's name wears: the host is first, the phones follow
    by id, Kalsa keeps the green. */
export function assignNameColors(members: RoomMember[]): Map<number, string> {
  const colors = new Map<number, string>();
  for (const member of members) {
    if (member.kind === "ai") colors.set(member.member_id, KALSA_NAME_COLOR);
  }
  const people = members
    .filter((member) => member.kind !== "ai")
    .sort((a, b) => rank(a) - rank(b) || a.member_id - b.member_id);
  people.forEach((member, index) => colors.set(member.member_id, nameColor(index)));
  return colors;
}
