/**
 * The rewrite exists because two files grew into 7261 and 6092 lines and nobody
 * could hold either in their head. The owner's rule for the replacement, in his
 * own words: do not recreate a giant chat or app file. This is that rule as a
 * test, because a promise about file size is exactly the kind of promise that
 * survives in a document and dies in a hurry.
 *
 * Two limits, and the second is the load-bearing one:
 *  - every file under `src/host` stays within HOST_FILE_LIMIT;
 *  - `HostRoot.tsx` stays within ROOT_FILE_LIMIT, well under it, because it may
 *    only COMPOSE: state it owns, hooks it calls, children it arranges. Every
 *    slice that lands in the root instead of beside it is how a rewrite becomes
 *    the thing it replaced.
 *
 * The file list itself is asserted non-empty AND large enough to be the real
 * tree: a reader that silently returns nothing would make every other assertion
 * here pass while checking no file at all.
 */
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

/** The project-wide limit for a new file. */
export const HOST_FILE_LIMIT = 350;
/**
 * A tighter, RATCHETING limit for the root, which must stay a composer rather
 * than a home. It is 332 lines today: this number is deliberately just above
 * that, so the root cannot grow at all until it has been split, and every new
 * behaviour must land in a module beside it. Lower this as the root shrinks;
 * never raise it to make room.
 */
export const ROOT_FILE_LIMIT = 340;
/** Below this many files the listing is broken, not the codebase. */
const MIN_FILES = 30;

function lineCount(source: string): number {
  return source.split("\n").length - (source.endsWith("\n") ? 1 : 0);
}

/** Every `.ts`/`.tsx` under `src/host`, tests included: a giant test file is
 *  the same failure wearing a different hat. */
function hostSources(dir: string): Array<{ name: string; lines: number }> {
  const found: Array<{ name: string; lines: number }> = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...hostSources(path));
    else if (/\.tsx?$/.test(entry.name)) {
      found.push({ name: path.slice(dir.length + 1), lines: lineCount(readFileSync(path, "utf8")) });
    }
  }
  return found;
}

const SOURCES = hostSources(__dirname);

describe("no file in the new app grows into the thing it replaced", () => {
  it("found the tree, so the limits below are checking real files", () => {
    // Without this, a wrong directory or a renamed extension makes every
    // assertion in this file vacuous — green while measuring nothing.
    expect(SOURCES.length).toBeGreaterThanOrEqual(MIN_FILES);
    expect(SOURCES.some((s) => s.name === "HostRoot.tsx")).toBe(true);
  });

  it(`holds every file under ${HOST_FILE_LIMIT} lines`, () => {
    const over = SOURCES.filter((s) => s.lines > HOST_FILE_LIMIT).sort((a, b) => b.lines - a.lines);
    expect(over.map((s) => `${s.name} (${s.lines})`)).toEqual([]);
  });

  it(`holds the root under ${ROOT_FILE_LIMIT} lines, because it may only compose`, () => {
    const root = SOURCES.find((s) => s.name === "HostRoot.tsx");
    expect(root).toBeDefined();
    expect(root!.lines).toBeLessThanOrEqual(ROOT_FILE_LIMIT);
  });

  it("would fail both limits on a file that broke them", () => {
    // The predicates above must be able to fail: a sample one line over each
    // limit is checked here so a broken counter cannot pass as compliance.
    const over = Array.from({ length: HOST_FILE_LIMIT + 1 }, () => "x").join("\n");
    const atLimit = Array.from({ length: HOST_FILE_LIMIT }, () => "x").join("\n");
    expect(lineCount(over)).toBeGreaterThan(HOST_FILE_LIMIT);
    expect(lineCount(atLimit)).toBe(HOST_FILE_LIMIT);
    expect(lineCount(atLimit)).not.toBeGreaterThan(HOST_FILE_LIMIT);
    // And the root's tighter limit is strictly inside the project limit, so the
    // two cannot quietly become the same number.
    expect(ROOT_FILE_LIMIT).toBeLessThan(HOST_FILE_LIMIT);
  });
});
