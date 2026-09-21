/**
 * The cloud animates on Reanimated's UI runtime, where a plain JavaScript
 * easing callback is not callable. The first time this component was mounted on
 * a device it died instantly with
 *
 *   com.facebook.jni.CppException: [Worklets] Tried to synchronously call a
 *   Remote Function ... at timing, at repeat, at AndroidUIScheduler.triggerUI
 *
 * because `Easing` was imported from `react-native` instead of
 * `react-native-reanimated`. Fifty timing tests passed while that was true: they
 * cover the pure modules, and the trap lived in the import line.
 *
 * This is a source check, not a render test, and it says so: the node jest stack
 * cannot import this component (it pulls in react-native and reanimated), and the
 * defect is a wrong import, which is exactly what reading the source catches
 * (DESIGN.md, "proof regime"). If a render harness ever lands, this file is
 * replaced by a real assertion.
 */
import { readFileSync } from "fs";
import { join } from "path";

const SOURCE = readFileSync(join(__dirname, "ThoughtCloud.tsx"), "utf8");

/**
 * The whole text of the import statement that ends in `from "<module>";`,
 * starting at its `import`. Reading the file line by line does not work here:
 * this file's imports span several lines, and the line that carries the module
 * name is the closing one.
 */
function importFrom(source: string, module: string): string | null {
  const marker = `from "${module}";`;
  const end = source.indexOf(marker);
  if (end < 0) return null;
  const start = source.lastIndexOf("import", end);
  return start < 0 ? null : source.slice(start, end + marker.length);
}

describe("the cloud's animation easings", () => {
  it("takes Easing from react-native-reanimated, where it is a worklet", () => {
    const imported = importFrom(SOURCE, "react-native-reanimated");
    expect(imported).not.toBeNull();
    expect(imported).toContain("Easing");
  });

  it("never takes Easing from react-native, whose easings cannot run on the UI thread", () => {
    const imported = importFrom(SOURCE, "react-native");
    expect(imported).not.toBeNull();
    expect(imported).not.toContain("Easing");
  });

  it("hands withTiming only a named easing, never a closure built on the spot", () => {
    const easings = SOURCE.split("\n").filter((line) => line.includes("easing:"));
    expect(easings.length).toBeGreaterThan(0);
    for (const line of easings) {
      // An identifier or a member expression. A function literal starts with `(`
      // or `function` and would crash exactly like the wrong import did.
      expect(line).toMatch(/easing:\s*[A-Za-z_$][\w$]*(?:\.[\w$]+)*/);
    }
  });
});
