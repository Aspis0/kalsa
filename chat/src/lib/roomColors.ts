// The room's name colors: one small palette, handed out in a stable order —
// this computer first, then the paired phones by id — so a member keeps its
// color across a restart. The host's color is its alone: everyone else cycles
// through the remaining four, so however large the household grows, nobody is
// ever dressed as this computer. Kalsa stands outside the rotation in the
// app's own green, and a former member holds no slot at all — they left. The
// values live in tokens.css (one light and one dark tuning per hue, all past
// WCAG AA against the page); scripts/name-contrast.mjs holds them there.

import type { RoomMember } from "../surfaces/roomFeed";

/** The palette's size, tokens.css's --room-name-N count. */
export const NAME_COLOR_SLOTS = 5;

/** The host's exclusive slot: the first color, worn by nobody else. */
const HOST_COLOR_INDEX = 0;

export const KALSA_NAME_COLOR = "var(--room-name-kalsa)";

export function nameColor(index: number): string {
  return `var(--room-name-${(index % NAME_COLOR_SLOTS) + 1})`;
}

/** The color each member's name wears: the host keeps the first slot to
    itself, Kalsa keeps the green, the people cycle through the rest by their
    stable order, and a former member gets nothing. */
export function assignNameColors(members: RoomMember[]): Map<number, string> {
  const colors = new Map<number, string>();
  const people = members
    .filter((member) => member.kind === "host" || member.kind === "phone")
    .filter((member) => !member.former)
    .sort((a, b) => {
      const rank = (member: RoomMember) => (member.kind === "host" ? 0 : 1);
      return rank(a) - rank(b) || a.member_id - b.member_id;
    });
  people.forEach((member, index) => {
    const slot = index === HOST_COLOR_INDEX
      ? HOST_COLOR_INDEX
      : 1 + ((index - 1) % (NAME_COLOR_SLOTS - 1));
    colors.set(member.member_id, nameColor(slot));
  });
  for (const member of members) {
    if (member.kind === "ai") colors.set(member.member_id, KALSA_NAME_COLOR);
  }
  return colors;
}
