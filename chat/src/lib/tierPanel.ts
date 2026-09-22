import type { TierFacts } from "../surfaces/useBrain";

/** One card's text: the Server page maps these into cards, React stays out
    of this module so the words can be tested without an app. */
export interface TierRow {
  label: string;
  value: string;
  detail: string;
}

/** Bytes as a short line, base 1024. No KB-per-token anything: this formats
    what the directory scan measured, and derives nothing from it. */
export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${value} B` : `${value.toFixed(1)} ${units[unit]}`;
}

/**
 * The tier's rows, or none. No tier block (no door to ask) → no rows: a
 * placeholder would put a number in the owner's head that no process
 * produced. A `0` inside a tier block, by contrast, is a measurement and
 * gets its row.
 *
 * Every value comes straight from the payload: the residents are the door's
 * residency map, the capacity is the slots that same door was built with,
 * the disk figures are one scan of the save directory. Nothing here computes,
 * converts or completes them — `unreadable` only ever adds a warning that the
 * total is short.
 */
export function tierRows(tier: TierFacts | null | undefined): TierRow[] {
  if (!tier) return [];
  const rows: TierRow[] = [
    {
      label: "Resident chats",
      value: `${tier.residents} of ${tier.capacity}`,
      // The source, named: the door's own map — not `active_devices`, which
      // counts requests in flight and answers 0 at rest.
      detail: "In the door's slot map",
    },
  ];
  if (tier.disk) {
    rows.push({
      label: "Saved on disk",
      value: formatBytes(tier.disk.bytes),
      detail:
        tier.disk.unreadable > 0
          ? `${tier.disk.files} files read, ${tier.disk.unreadable} unreadable — total incomplete`
          : `${tier.disk.files} files, from a scan of the save directory`,
    });
  }
  return rows;
}
