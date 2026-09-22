// The tier's rows: which numbers reach the Server page, in what words, and —
// above all — when there is NO number: the row must not exist rather than
// show a placeholder, because an invented number in a panel is the worst
// defect this tier can ship. `tierRows` takes the DTO the poll hands it
// (`useBrain`'s `TierFacts`) and returns the cards' text, so every case below
// runs with no app, no door and no network: the real module is compiled by
// `lib/app-bundle.mjs`, never copied (a JavaScript copy would test the copy).
//
// The React half — ServerSurface mapping those rows into cards — cannot run
// here; `npx tsc --noEmit` covers the compile and reading the diff covers the
// rest, the same split `context-size.mjs` declares.
//
// Red first: this harness was run against a stub `tierRows` that returned no
// rows at all — it went red (exit 1) on the first row check — and the module
// then answered the contract: 17 checks, all passing.
//
// Run: node scripts/tier-panel.mjs

import { rm } from "node:fs/promises";
import { loadApp } from "./lib/app-bundle.mjs";

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const { app, dir } = await loadApp();
try {
  const { tierRows, formatBytes } = app;

  // No door, no tier block: no rows at all. A `0 of 0` here would be a fact
  // nobody measured, and a "—" would invite the owner to wait for one.
  {
    check("no tier → no rows (undefined)", tierRows(undefined).length === 0);
    check("no tier → no rows (null, what the IPC carries)", tierRows(null).length === 0);
  }

  // A door, and its two counts: the row says residents OVER the capacity the
  // door built itself with — both numbers from the payload, never a constant.
  {
    const rows = tierRows({ residents: 1, capacity: 4, disk: null });
    check("one row when the directory scan is absent", rows.length === 1, JSON.stringify(rows));
    check("the row reads residents of capacity", rows[0].value === "1 of 4", rows[0].value);
    check("the row names its source", /door/i.test(rows[0].detail), rows[0].detail);
    check(
      "capacity comes from the payload, not a literal",
      tierRows({ residents: 1, capacity: 8, disk: null })[0].value === "1 of 8",
    );
    const zero = tierRows({ residents: 0, capacity: 4, disk: null });
    check(
      "0 residents is a measured fact and still gets its row",
      zero.length === 1 && zero[0].value === "0 of 4",
      zero[0]?.value,
    );
  }

  // The disk row, only when the scan answered: the bytes on disk, the file
  // count, and — when entries had to be skipped — the incompleteness said out
  // loud rather than smoothed into a total.
  {
    const rows = tierRows({
      residents: 2,
      capacity: 4,
      disk: { bytes: 18, files: 2, unreadable: 0 },
    });
    check("the scan adds the disk row", rows.length === 2, JSON.stringify(rows));
    const disk = rows[1];
    check("the disk value is the scanned bytes", disk.value === "18 B", disk.value);
    check("the disk row names the scan and the file count", /2 files/.test(disk.detail) && /scan/i.test(disk.detail), disk.detail);

    const partial = tierRows({
      residents: 2,
      capacity: 4,
      disk: { bytes: 18, files: 2, unreadable: 3 },
    })[1];
    check("an incomplete scan says it is incomplete", /incomplete/i.test(partial.detail), partial.detail);
    check("the incomplete scan still names the skipped entries", /3/.test(partial.detail), partial.detail);
  }

  // The byte formatter: no KB/token coefficient anywhere, just the units.
  {
    check("0 B", formatBytes(0) === "0 B", formatBytes(0));
    check("18 B", formatBytes(18) === "18 B", formatBytes(18));
    check("1024 → 1.0 KB", formatBytes(1024) === "1.0 KB", formatBytes(1024));
    check("5 MiB → 5.0 MB", formatBytes(5 * 1024 * 1024) === "5.0 MB", formatBytes(5 * 1024 * 1024));
    check(
      "1907-token save at the footprint recorded in dev/results/slot-restore-device-path (--swa-full off) reads as MB",
      formatBytes(101_493_292) === "96.8 MB",
      formatBytes(101_493_292),
    );
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? "tier-panel: all checks passed" : `tier-panel: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
