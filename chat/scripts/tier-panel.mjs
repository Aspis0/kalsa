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
// The concurrency row is checked against the artifact it names, read with
// `fs` from a path relative to this file — this script states that path
// independently of the constant (the way it already cites
// `dev/results/slot-restore-device-path`), so a path edited in the constant
// cannot quietly aim the check at some other file. Constant and artifact
// must say the same thing: status, tag, platform, backend, exe_sha256; the
// three ratios EXACTLY (the constant carries the artifact's four decimals,
// so the copy is checked against its original digit for digit — a drift
// below the rounding cannot hide); the rounding the panel SHOWS (2 decimals
// in the value), as its own check with its own message; a detail carrying
// the qualification and naming the artifact; and a row that exists exactly
// while the artifact's status is
// `matched`. The committed JSON is only ever read — the two mutation proofs
// run on in-memory copies, and the third was run against the constant
// itself at commit time: bumping `aggregate` in `tierPanel.ts` by a tenth
// turned this red (exit 1, 2 failures — the exact-ratio check, and the
// value that stopped showing the artifact's number), then was reverted.
// Dropping `not wall time` from the row's detail goes red on the detail
// check. Full run: 30 checks, all passing.
//
// Run: node scripts/tier-panel.mjs

import { readFile, rm } from "node:fs/promises";
import { loadApp } from "./lib/app-bundle.mjs";

// The artifact behind the concurrency row, repo-relative, named here and
// not read out of the constant: two sources that must agree cannot be one.
const ARTIFACT = "dev/results/concurrency-two-devices/results.json";

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

// The concurrency row against the artifact it names. Every finding goes
// through `emit`, so the mutation proofs below can run this exact logic on
// an in-memory copy and prove it still turns red — a check that cannot fail
// is not a check. Nothing here writes the artifact.
function concurrencyChecks(app, artifact, emit) {
  const { CONCURRENCY } = app;
  const release = artifact.provenance.release;
  const row = app.concurrencyRow();
  const pairs = [
    ["slot0", CONCURRENCY.ratios.slot0, artifact.ratios.per_stream_slot0_over_A],
    ["slot1", CONCURRENCY.ratios.slot1, artifact.ratios.per_stream_slot1_over_A],
    ["aggregate", CONCURRENCY.ratios.aggregate, artifact.ratios.aggregate_over_A],
  ];
  const both = (label, c, a) => emit(`concurrency: ${label}`, c === a, `constant ${c} vs artifact ${a}`);

  emit(
    "concurrency: the constant names the artifact path this script reads",
    CONCURRENCY.sourcePath === ARTIFACT,
    `${CONCURRENCY.sourcePath} vs ${ARTIFACT}`,
  );
  both("status", CONCURRENCY.release.status, release.status);
  both("tag", CONCURRENCY.release.tag, release.tag);
  both("platform", CONCURRENCY.release.platform, release.platform);
  both("backend", CONCURRENCY.release.backend, release.backend);
  both("exe_sha256", CONCURRENCY.release.exe_sha256, release.exe_sha256);
  // The artifact's status/tag were derived from the LAUNCHER's hash alone,
  // and that launcher is byte-identical in v1.1.0 and v1.1.1 - so the file
  // could say `matched / kalsa-server-v1.1.1` for a v1.1.0 tree and none of
  // the checks above would notice. The separating fact is already IN the
  // file, unread until now: provenance.engine_version carries
  // `commit a7d2cec79`, release.commit carries `a7d2cec79e7d...`.
  //
  // H1: the agreement rule is the SAME as engine-harness's commits_agree
  // (>=9 lowercase hex each; two shorts EQUAL; prefix only against a full
  // 40-hex commit), pinned by the same vectors as
  // dev/test-running-engine.py - the old >=7-prefix rule accepted
  // `deadbee9` vs `deadbee`.
  const commitShape = (s) => typeof s === "string" && /^[0-9a-f]{9,}$/.test(s);
  const commitsAgree = (a, b) => {
    if (!commitShape(a) || !commitShape(b)) return false;
    if (a === b) return true;
    if (a.length === 40 && a.startsWith(b)) return true;
    if (b.length === 40 && b.startsWith(a)) return true;
    return false;
  };
  const engineCommit = /commit ([0-9a-f]{7,40})/.exec(
    artifact.provenance.engine_version ?? "",
  )?.[1];
  const releaseCommit = release.commit;
  const commitsOk = commitsAgree(engineCommit, releaseCommit);
  emit(
    "concurrency: the engine_version commit agrees with release.commit (the tag rests on the commit that ran)",
    commitsOk,
    `engine_version ${engineCommit ?? "none"} vs release.commit ${releaseCommit ?? "none"}`,
  );
  // The rule's own vectors - the same list dev/test-running-engine.py runs,
  // so a drift between the two implementations is caught here too.
  const H1_VECTORS = [
    ["deadbee9", "deadbee", false],
    ["a7d2cec79", "a7d2cec79", true],
    ["a7d2cec79", "a7d2cec79e7d495cbfa3e6b3a78bd4af3fab44b1", true],
    ["a7d2cec79e7d495cbfa3e6b3a78bd4af3fab44b1", "a7d2cec79", true],
    ["a7d2cec7", "a7d2cec79", false],
    ["a7d2cec79", "a7d2cec70", false],
  ];
  const vectorFails = H1_VECTORS.filter(([a, b, want]) => commitsAgree(a, b) !== want);
  emit(
    "concurrency: the H1 commit-rule vectors (same as dev/test-running-engine.py)",
    vectorFails.length === 0,
    vectorFails.map(([a, b]) => `${a}/${b}`).join(", ") || "all 6 match",
  );
  emit(
    "concurrency: the three ratios are exactly the artifact's, digit for digit",
    pairs.every(([, c, a]) => c === a),
    pairs.map(([, c, a]) => `${c} vs ${a}`).join(", "),
  );
  // PLAN-DISK-TIER §9: the panel's number is attributed to the release
  // artifact — so the row's existence follows the ARTIFACT's status, not
  // only the constant's own claim about itself.
  emit(
    "concurrency: the row exists exactly when the artifact says matched",
    (release.status === "matched") === (row !== null),
    `status ${release.status}, row ${row ? "shown" : "withheld"}`,
  );
  if (row) {
    emit(
      "concurrency: the value rounds the artifact's ratios to the 2 decimals shown",
      pairs.every(([, , a]) => row.value.includes(`${a.toFixed(2)}x`)),
      row.value,
    );
    // The qualification lives in the detail, not in the value: the value is
    // the number's line. Checking it where it actually sits, or the check
    // would go green (or red) on a string that is no longer there.
    emit(
      "concurrency: the detail says decode rate, not wall time",
      /decode rate/i.test(row.detail) && /not wall time/i.test(row.detail),
      row.detail,
    );
    emit(
      "concurrency: the detail names the artifact",
      row.detail.includes(release.tag) &&
        row.detail.includes(`${release.platform}/${release.backend}`),
      row.detail,
    );
  }
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

  // The concurrency row and the artifact behind it: the constant may say
  // only what the committed JSON says, and the row may exist only while
  // that JSON's status is `matched` - and the JSON's own tag may rest only
  // on a release.commit its engine_version agrees with (the launcher two
  // releases share can match either tree's hash and separate neither).
  const artifact = JSON.parse(await readFile(new URL(`../../${ARTIFACT}`, import.meta.url), "utf8"));
  concurrencyChecks(app, artifact, check);

  // MUTATIONS, both in memory — the committed artifact is never written.
  // Each copy must turn this script red through the checks above: a status
  // that is not `matched` must withhold the row, a platform the artifact
  // does not carry must break the identity, and a release.commit the
  // engine_version does not have must break the tag's anchor (only the
  // new commit check reads that field - this mutation is ITS proof).
  for (const [field, value] of [
    ["status", "not-the-release"],
    ["platform", "linux-x64"],
    ["commit", "0000000000000000000000000000000000000000"],
  ]) {
    const copy = structuredClone(artifact);
    copy.provenance.release[field] = value;
    const caught = [];
    concurrencyChecks(app, copy, (name, ok, detail) => {
      if (!ok) caught.push(`${name}${detail ? ` — ${detail}` : ""}`);
    });
    check(
      `concurrency MUTATION (in-memory copy): ${field} = ${value} → the check goes red`,
      caught.length > 0,
      caught[0] ?? "nothing caught it",
    );
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? "tier-panel: all checks passed" : `tier-panel: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
