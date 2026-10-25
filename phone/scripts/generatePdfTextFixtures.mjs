/**
 * Regenerate VERBATIM golden PDF item-stream fixtures under scripts/fixtures/pdf/.
 *
 * Only page selection + item-count truncation. Does not write synthetic/ fixtures
 * (those are hand-maintained under scripts/fixtures/pdf/synthetic/ with their own
 * headers). Shells out to the spike dump-golden.js when present.
 *
 * Usage (from project root):
 *   node scripts/generatePdfTextFixtures.mjs
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const localAppData =
  process.env.LOCALAPPDATA ||
  path.join(process.env.USERPROFILE || "", "AppData", "Local");
const dumpScript = path.join(
  localAppData,
  "Temp",
  "claude",
  "C--Users-gualt-Desktop-Kalsa",
  "8e332d1a-fdb9-4976-a152-34e44d9d40c0",
  "scratchpad",
  "agents",
  "spike-pdf",
  "dump-golden.js",
);

if (!existsSync(dumpScript)) {
  console.error(
    "Spike dump-golden.js not found.\n" +
      "Expected:\n  " +
      dumpScript +
      "\n\nCommitted fixtures under scripts/fixtures/pdf/ remain the source of truth.\n" +
      "Do not invent synthetic item streams.",
  );
  process.exit(1);
}

console.log("Running spike dump-golden.js → scripts/fixtures/pdf/ …");
const r = spawnSync(process.execPath, [dumpScript], {
  cwd: projectRoot,
  encoding: "utf8",
  stdio: "inherit",
});
process.exit(r.status ?? 1);
