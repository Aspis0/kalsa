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

/** The two-device concurrency measurement, carried as ONE constant: the
    three decode-rate ratios, the identity of the release build they were
    measured on, and the repo-relative path of the artifact they are copied
    from — field for field, `provenance.release` of that file.

    The identity sits WITH the numbers on purpose. A bare `0.73` written
    into an interface has no date and no home: it is believed forever, and
    it lies the day the engine changes. Next to its tag, platform, backend
    and exe hash the number ages VISIBLY — and `scripts/tier-panel.mjs`
    turns red the moment this constant and that artifact disagree: the copy
    is checked against its original, so it cannot drift alone. */
export const CONCURRENCY = {
  /** Where the ratios below come from, repo-relative; the control script
      reads exactly this file with `fs`. */
  sourcePath: "dev/results/concurrency-two-devices/results.json",
  /** The artifact's `provenance.release`: status, tag, platform, backend,
      exe_sha256, copied and never recomputed here. */
  release: {
    status: "matched",
    tag: "kalsa-server-v1.1.1",
    platform: "macos-arm64",
    backend: "metal",
    exe_sha256: "327fb363e5246284a74fe9ee7ed8ea70d121979d65a670caf1d0cdd838e96cde",
  },
  /** The artifact's `ratios`: decode rate while a second device decodes,
      over the solo arm — four decimals as the artifact holds them, shown
      at two. Rates, not wall times: no seconds appear anywhere here. */
  ratios: { slot0: 0.7302, slot1: 0.7302, aggregate: 1.4604 },
} as const;

/** The concurrency row, or `null` when the measurement's provenance is not
    `matched`: a number taken on a fork build or left `unverified` is not a
    release measurement, and a release column never carries one — the panel's
    number is attributed to the release artifact (PLAN-DISK-TIER §9). The
    gate reads the constant, not a live lookup: the row and its source
    identity are the same object, so they cannot drift apart. */
export function concurrencyRow(): TierRow | null {
  const { release, ratios } = CONCURRENCY;
  if (release.status !== "matched") return null;
  const slots = [ratios.slot0, ratios.slot1].map((r) => r.toFixed(2));
  // "each" only while both slots read the same at the shown precision;
  // otherwise the row names both, because one averaged figure would be a
  // number the artifact never wrote down.
  const perDevice =
    slots[0] === slots[1] ? `${slots[0]}x each` : `${slots[0]}x / ${slots[1]}x per slot`;
  return {
    label: "Two devices decoding",
    value: `${perDevice}, ${ratios.aggregate.toFixed(2)}x together — decode rate vs one device, not wall time`,
    detail: `Measured on ${release.tag}, ${release.platform}/${release.backend}`,
  };
}
