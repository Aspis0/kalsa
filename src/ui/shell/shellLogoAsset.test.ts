/**
 * The strip's mark is the app's logo, one of the three assets the rebuild keeps
 * (DESIGN.md §1.2). `Shell.tsx` is a component, so the node jest stack cannot
 * render it (DESIGN.md, "proof regime"); a wrong `require` path would not fail
 * this suite, it would only fail Metro's asset resolver at bundle time, and the
 * user would see the plain disc again — the exact defect this file exists to
 * prevent.
 *
 * So this is a SOURCE check: read the component, pull the asset path it
 * requires, and prove the file is on disk, is not empty, and starts with a PNG
 * signature. A typo, a moved asset or a truncated file fails here.
 */
import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";

const SHELL = join(__dirname, "Shell.tsx");
const SOURCE = readFileSync(SHELL, "utf8");

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Every `require("<path>")` literal in the source, in source order. */
function requiredPaths(source: string): string[] {
  const paths: string[] = [];
  const pattern = /require\(\s*["']([^"']+)["']\s*\)/g;
  let match = pattern.exec(source);
  while (match !== null) {
    paths.push(match[1]);
    match = pattern.exec(source);
  }
  return paths;
}

describe("the strip's logo asset", () => {
  const paths = requiredPaths(SOURCE);

  it("requires exactly one asset, so there is one thing to prove", () => {
    expect(paths).toHaveLength(1);
  });

  it("requires a path that exists next to the component", () => {
    const required = paths[0];
    expect(typeof required).toBe("string");
    const asset = join(__dirname, String(required));
    expect(existsSync(asset)).toBe(true);
    expect(statSync(asset).isFile()).toBe(true);
    // A zero-byte or stub file renders as a blank mark just as a typo does.
    expect(statSync(asset).size).toBeGreaterThan(1024);
  });

  it("requires a real PNG, not a file that merely ends in .png", () => {
    const asset = join(__dirname, String(paths[0]));
    const bytes = readFileSync(asset);
    expect(bytes.subarray(0, PNG_MAGIC.length)).toEqual(PNG_MAGIC);
  });

  it("renders that asset inside the mark instead of the old accent disc", () => {
    expect(SOURCE).toMatch(/const LOGO\s*=\s*require\(/);
    expect(SOURCE).toMatch(/source=\{LOGO\}/);
    expect(SOURCE).toMatch(/styles\.markImage/);
    // The regression: `mark` was a filled accent circle with nothing in it.
    expect(SOURCE).not.toMatch(/mark:\s*\{[^}]*backgroundColor:\s*colors\.accent/s);
  });
});
