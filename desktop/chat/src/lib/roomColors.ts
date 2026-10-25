// The room's name colors: one small palette, handed out in a stable order —
// this computer first, then the paired phones by id — so a member keeps its
// color across a restart. The host's color is its alone: everyone else cycles
// through the remaining four, so however large the household grows, nobody is
// ever dressed as this computer. Kalsa stands outside the rotation in the
// app's own green, and a former member holds no slot at all — they left. Each
// slot is two values in tokens.css: the full color (names, dots, borders) and
// a tint of the same hue (bubble washes), both past WCAG AA where their text
// sits; scripts/name-contrast.mjs holds them there.

import type { RoomMember } from "../surfaces/roomFeed";

/** The palette's size, tokens.css's --room-name-N count. */
export const NAME_COLOR_SLOTS = 5;

/** The host's exclusive slot: the first color, worn by nobody else. */
const HOST_COLOR_INDEX = 0;

export const KALSA_NAME_COLOR = "var(--room-name-kalsa)";
export const KALSA_TINT = "var(--room-tint-kalsa)";

export function nameColor(index: number): string {
  return `var(--room-name-${(index % NAME_COLOR_SLOTS) + 1})`;
}

export function nameTint(index: number): string {
  return `var(--room-tint-${(index % NAME_COLOR_SLOTS) + 1})`;
}

/** The slot each member holds, in the stable order: the host first, then
    the phones by id. Formers and the assistant hold none. */
function slotsOf(members: RoomMember[]): Map<number, number> {
  const slots = new Map<number, number>();
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
    slots.set(member.member_id, slot);
  });
  return slots;
}

/** The color each member's name wears. */
export function assignNameColors(members: RoomMember[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const [id, slot] of slotsOf(members)) out.set(id, nameColor(slot));
  for (const member of members) {
    if (member.kind === "ai") out.set(member.member_id, KALSA_NAME_COLOR);
  }
  return out;
}

/** The tint each member's messages wash with — the same slot, the other
    value of it. */
export function assignNameTints(members: RoomMember[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const [id, slot] of slotsOf(members)) out.set(id, nameTint(slot));
  for (const member of members) {
    if (member.kind === "ai") out.set(member.member_id, KALSA_TINT);
  }
  return out;
}
