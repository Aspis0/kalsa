/**
 * The Web switch's persistence (D1 row 5 / D2 row 14), as source plus the pure
 * parser: the toggle itself needs AsyncStorage, which the node stack cannot
 * run, so what is proven is the part a typo would break silently — the new
 * toggle writes the CONTROLLER'S OWN key (`kalsa.web.enabled`, old
 * `AppShell:882`) with the controller's own `"1"`/`"0"` encoding, both files
 * importing that key from the same module, and the skip-once notify rule that
 * makes a toggle announce itself while mount does not (the notify machinery is
 * `staticPrefixNotify.ts`, already tested in `staticPrefixNotify.test.ts`).
 */
import { readFileSync } from "fs";
import { join } from "path";
import { WEB_TOOLS_ENABLED_KEY, parseToolToggle } from "../agent/toolToggles";

const read = (path: string): string => readFileSync(path, "utf8");
const TOOL_FLAGS = read(join(__dirname, "toolFlags.ts"));
const CONTROLLER = read(join(__dirname, "..", "app", "AppShell.tsx"));
const PREFIX = read(join(__dirname, "staticPrefixNotify.ts"));

/** The module each file takes `WEB_TOOLS_ENABLED_KEY` from, by walking its
 *  import statements — the check is "same module", not "same spelling". */
function keyImportModule(source: string): string[] {
  const modules: string[] = [];
  const pattern = /import\s*\{([\s\S]*?)\}\s*from\s*"([^"]+)"/g;
  let match = pattern.exec(source);
  while (match !== null) {
    if (match[1].includes("WEB_TOOLS_ENABLED_KEY")) modules.push(match[2]);
    match = pattern.exec(source);
  }
  return modules;
}

describe("the persisted key is the controller's own (AppShell:866, 882)", () => {
  it("is kalsa.web.enabled — the value the old app booted from", () => {
    expect(WEB_TOOLS_ENABLED_KEY).toBe("kalsa.web.enabled");
  });

  it("both the controller and the new host import it from the same module", () => {
    expect(keyImportModule(TOOL_FLAGS)).toEqual(["../agent/toolToggles"]);
    expect(keyImportModule(CONTROLLER)).toEqual(["../agent/toolToggles"]);
  });

  it("the toggle persists with the controller's `1`/`0` encoding (AppShell:882)", () => {
    expect(TOOL_FLAGS).toMatch(
      /AsyncStorage\.setItem\(\s*WEB_TOOLS_ENABLED_KEY,\s*next \? "1" : "0"\s*\)/,
    );
  });

  it("flips state AND ref together — the engine reads the ref mid-run (D2 row 14)", () => {
    const toggle = TOOL_FLAGS.slice(TOOL_FLAGS.indexOf("toggleWebTools = useCallback"));
    expect(toggle.indexOf("webToolsEnabledRef.current = next")).toBeGreaterThan(-1);
    expect(toggle.indexOf("setItem")).toBeGreaterThan(-1);
    expect(toggle.indexOf("webToolsEnabledRef.current = next")).toBeGreaterThan(
      toggle.indexOf("setWebToolsEnabled("),
    );
  });
});

describe("the load defaults stay the controller's (default ON)", () => {
  it("an absent key reads ON, and `0`/`false` read OFF", () => {
    expect(parseToolToggle(null, true)).toBe(true);
    expect(parseToolToggle(undefined, true)).toBe(true);
    expect(parseToolToggle("", true)).toBe(true);
    expect(parseToolToggle("0", true)).toBe(false);
    expect(parseToolToggle("false", true)).toBe(false);
    expect(parseToolToggle("1", false)).toBe(true);
    // A corrupt value falls back to the default rather than guessing.
    expect(parseToolToggle("banana", true)).toBe(true);
  });
});

describe("notify on change, never on mount (old AppShell:2357-2366)", () => {
  it("the skip-first-run flag still exists and starts true", () => {
    // The wiring itself: `useHostEffects` runs this factory with the three
    // flags as deps, so a real toggle announces and mount does not.
    expect(PREFIX).toMatch(/skipNext\s*=\s*true/);
    expect(PREFIX).toContain("skipNext");
  });
});
