/**
 * The logo's asset, and the fact that the STRIP no longer draws it.
 *
 * BEFORE this slice `Shell.tsx` `require`d `assets/icon.png` and painted it as
 * the pill's 28 dp mark; this file pinned that require (path exists, real PNG,
 * `source={LOGO}` in the JSX) because a typo would not fail the node stack —
 * only show a blank disc on device. The capture then measured what the mark
 * COST (28 dp of a 154 dp pill while the name truncated to `LFM2.5 …`), so the
 * mark left the strip: the name is the information, the mark was not.
 *
 * The asset did not go anywhere — still one of the three assets the rebuild
 * keeps (DESIGN.md §1.2), still `app.config.js`'s launcher icon. So the pin
 * MOVED with it — from Shell's `require` to the launcher's config line — and
 * the strip's half of the old contract inverted: Shell.tsx must require no
 * raster and draw no mark, or the name loses its column again. What the column
 * must hold is measured in `stripTextBudget.test.ts`; this file holds the
 * picture.
 */
import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";

const SHELL_PATH = join(__dirname, "Shell.tsx");
const SHELL_STYLES_PATH = join(__dirname, "shellStyles.ts");
const CONFIG_PATH = join(__dirname, "..", "..", "..", "app.config.js");
const ASSET_PATH = join(__dirname, "..", "..", "..", "assets", "icon.png");

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

describe("the strip requires no raster — the name owns the pill", () => {
  const shell = readFileSync(SHELL_PATH, "utf8");

  it("requires exactly zero assets (BEFORE: exactly one — the 28 dp mark)", () => {
    // The mark's removal is only worth anything if it stays removed: any
    // `require` that comes back is chrome that can grow into the name's column.
    expect(requiredPaths(shell)).toHaveLength(0);
  });

  it("draws no <Image> and no mark or where-dot style anywhere in the shell", () => {
    // The assertion INVERTS rather than goes: the empty disc and the ellipsised
    // name are the same defect — a picture eating a string's room.
    expect(shell).not.toContain("<Image");
    expect(shell).not.toMatch(/styles\.(mark|markImage|whereDot)/);
    const styles = readFileSync(SHELL_STYLES_PATH, "utf8");
    expect(styles).not.toMatch(/\bmark(Image)?:/);
    expect(styles).not.toMatch(/\bwhereDot:/);
  });
});

describe("the logo asset itself still ships", () => {
  it("is still named by the launcher config, so removing it from the strip orphaned nothing", () => {
    // The pin that used to live on Shell's `require`, moved: the file exists
    // to be SHIPPED, and the launcher is what ships it now.
    const config = readFileSync(CONFIG_PATH, "utf8");
    expect(config).toContain('icon: "./assets/icon.png"');
  });

  it("is a real, non-empty PNG, not a stub a blank launcher would render", () => {
    expect(existsSync(ASSET_PATH)).toBe(true);
    expect(statSync(ASSET_PATH).isFile()).toBe(true);
    expect(statSync(ASSET_PATH).size).toBeGreaterThan(1024);
    expect(readFileSync(ASSET_PATH).subarray(0, PNG_MAGIC.length)).toEqual(PNG_MAGIC);
  });
});
