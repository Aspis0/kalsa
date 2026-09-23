/** The 349 dp composer width after the chip row and its width budget were removed. */
import { readFileSync } from "fs";
import { join } from "path";
import { COMPOSER_FIELD_HEIGHT, COMPOSER_SIDE_PADDING, MIN_TOUCH_TARGET, shellGeometry } from "./shellGeometry";

const STYLES = readFileSync(join(__dirname, "shellStyles.ts"), "utf8");
const FIELD = readFileSync(join(__dirname, "ShellComposer.tsx"), "utf8");
const FIELD_CODE = FIELD.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

describe("the single field fits the measured phone width", () => {
  it("uses the v2 gutter and preserves 48 dp finger targets", () => {
    const geometry = shellGeometry(349, 621, { top: 24, bottom: 16 });
    expect(COMPOSER_SIDE_PADDING).toBe(16);
    expect(geometry.touchTargets.composerField.width).toBe(317);
    expect(geometry.touchTargets.composerField.height).toBe(MIN_TOUCH_TARGET);
    expect(COMPOSER_FIELD_HEIGHT).toBe(56);
  });

  it("the 40 dp send paint stays inside its real 48 dp press target", () => {
    expect(STYLES).toContain("width: MIN_TOUCH_TARGET");
    expect(STYLES).toContain("height: 40");
    expect(FIELD).toContain('testID="shell.composer.send"');
    expect(FIELD_CODE).not.toContain("hitSlop");
  });
});
