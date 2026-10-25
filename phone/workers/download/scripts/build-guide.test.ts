import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SCRIPT = path.resolve(__dirname, "build-guide.mjs");

// The script runs on import, so it is driven as a CLI over a temporary pair:
// CI has no sibling kalsa-brain checkout, and the parity rule must run there.
function checkPair(english: string, italian: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "guide-parity-"));
  try {
    const source = path.join(dir, "ALPHA-TESTERS.md");
    writeFileSync(source, english);
    writeFileSync(path.join(dir, "ALPHA-TESTERS.it.md"), italian);
    return spawnSync(process.execPath, [SCRIPT, source, "--check"], { encoding: "utf8" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("EN/IT structural parity", () => {
  test("a section with a different paragraph count fails, naming the section and both counts", () => {
    const res = checkPair(
      "## 1. Requirements\n\nOne paragraph.\n\nSecond paragraph.\n",
      "## 1. Requisiti\n\nUn paragrafo.\n",
    );
    expect(res.status).toBe(1);
    expect(res.stderr).toContain(
      "section 1 differs: English has 2 paragraphs, 0 list items, 0 quotes, 0 code spans; Italian has 1 paragraphs, 0 list items, 0 quotes, 0 code spans",
    );
  });

  test("a section with a different code-span count fails", () => {
    const res = checkPair("## 1. Requirements\n\nRun `kalsa` now.\n", "## 1. Requisiti\n\nAvvia kalsa adesso.\n");
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("section 1 differs: English has 1 paragraphs, 0 list items, 0 quotes, 1 code spans");
  });
});

describe("the command line", () => {
  test.each([
    ["a bare --out", ["guide.md", "--out"]],
    ["--out followed by another flag", ["guide.md", "--out", "--check"]],
  ])("%s prints usage and exits 2", (_label, args) => {
    const res = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("usage: build-guide.mjs");
  });
});
