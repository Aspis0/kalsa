/**
 * The file-size ratchet. The rewrite this replaces had two files at 7261 and
 * 6092 lines; a promise about file size is exactly the kind of promise that
 * survives in a document and dies in a hurry, so this is that promise as a
 * test.
 *
 * Three limits, each ratcheting (lower as the tree shrinks; never raise to
 * make room):
 *  - every file under `src/host` stays within HOST_FILE_LIMIT;
 *  - `HostRoot.tsx` stays within ROOT_FILE_LIMIT, well under it, because it may
 *    only COMPOSE: state it owns, hooks it calls, children it arranges. Every
 *    slice that lands in the root instead of beside it is how a rewrite becomes
 *    the thing it replaced;
 *  - every `*.ts`/`*.tsx` under `src/ui/shell` stays within SHELL_FILE_LIMIT —
 *    a second directory earning its own limit when its largest file sat over
 *    the project guideline.
 *
 * Each file list is asserted non-empty AND large enough to be the real tree:
 * a reader that silently returns nothing would make every other assertion
 * here pass while checking no file at all.
 */
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

/** The project-wide limit for a new file. */
export const HOST_FILE_LIMIT = 350;
/**
 * A tighter, RATCHETING limit for the root, which must stay a composer rather
 * than a home. Deliberately just above the root's size, so it cannot grow at
 * all until it has been split further and every new behaviour lands in a
 * module beside it. Lower this as the root shrinks; never raise it.
 */
export const ROOT_FILE_LIMIT = 250;
/**
 * The shell's RATCHETING limit: the largest file the tree held when it was
 * set, so the first line added fails and the seam gets cut instead. Lower it
 * as the shell shrinks; never raise it.
 */
export const SHELL_FILE_LIMIT = 342;
/** Below this many files the listing is broken, not the codebase. */
const MIN_HOST_FILES = 30;
const MIN_SHELL_FILES = 20;

function lineCount(source: string): number {
  return source.split("\n").length - (source.endsWith("\n") ? 1 : 0);
}

/** Every `.ts`/`.tsx` under `dir`, tests included: a giant test file is
 *  the same failure wearing a different hat. Names are relative to `dir`. */
function sourcesUnder(dir: string): Array<{ name: string; lines: number }> {
  const found: Array<{ name: string; lines: number }> = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourcesUnder(path));
    else if (/\.tsx?$/.test(entry.name)) {
      found.push({ name: path.slice(dir.length + 1), lines: lineCount(readFileSync(path, "utf8")) });
    }
  }
  return found;
}

/** Files over a limit, largest first, formatted for the assertion diff. */
function over(
  sources: Array<{ name: string; lines: number }>,
  limit: number,
): string[] {
  return sources
    .filter((s) => s.lines > limit)
    .sort((a, b) => b.lines - a.lines)
    .map((s) => `${s.name} (${s.lines})`);
}

const HOST_SOURCES = sourcesUnder(__dirname);
const SHELL_SOURCES = sourcesUnder(join(__dirname, "..", "ui", "shell"));

describe("no file in the new app grows into the thing it replaced", () => {
  it("found both trees, so the limits below are checking real files", () => {
    // Without this, a wrong directory or a renamed extension makes every
    // assertion in this file vacuous — green while measuring nothing.
    expect(HOST_SOURCES.length).toBeGreaterThanOrEqual(MIN_HOST_FILES);
    expect(HOST_SOURCES.some((s) => s.name === "HostRoot.tsx")).toBe(true);
    expect(SHELL_SOURCES.length).toBeGreaterThanOrEqual(MIN_SHELL_FILES);
    expect(SHELL_SOURCES.some((s) => s.name === "Shell.tsx")).toBe(true);
  });

  it(`holds every file under ${HOST_FILE_LIMIT} lines`, () => {
    expect(over(HOST_SOURCES, HOST_FILE_LIMIT)).toEqual([]);
  });

  it(`holds every shell file under ${SHELL_FILE_LIMIT} lines`, () => {
    expect(over(SHELL_SOURCES, SHELL_FILE_LIMIT)).toEqual([]);
  });

  it(`holds the root under ${ROOT_FILE_LIMIT} lines, because it may only compose`, () => {
    const root = HOST_SOURCES.find((s) => s.name === "HostRoot.tsx");
    expect(root).toBeDefined();
    expect(root!.lines).toBeLessThanOrEqual(ROOT_FILE_LIMIT);
  });

  it("would fail every limit on a file that broke it", () => {
    // The predicates above must be able to fail: a sample one line over each
    // limit is checked here so a broken counter cannot pass as compliance.
    for (const limit of [HOST_FILE_LIMIT, ROOT_FILE_LIMIT, SHELL_FILE_LIMIT]) {
      const overLimit = Array.from({ length: limit + 1 }, () => "x").join("\n");
      const atLimit = Array.from({ length: limit }, () => "x").join("\n");
      expect(lineCount(overLimit)).toBeGreaterThan(limit);
      expect(lineCount(atLimit)).toBe(limit);
      expect(lineCount(atLimit)).not.toBeGreaterThan(limit);
    }
    // And the three limits are strictly ordered, so they cannot quietly
    // become the same number.
    expect(ROOT_FILE_LIMIT).toBeLessThan(SHELL_FILE_LIMIT);
    expect(SHELL_FILE_LIMIT).toBeLessThan(HOST_FILE_LIMIT);
  });
});
