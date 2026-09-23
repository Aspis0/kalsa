/** Measured band and touch-box contract for the v2 conversation shell. */
import { readFileSync } from "fs";
import { join } from "path";
import {
  COMPOSER_HEIGHT,
  MIN_TOUCH_TARGET,
  MODEL_NAME_COLUMN_NEED_DP,
  SHELL_NOTICE_GAP,
  SHELL_NOTICE_HEIGHT,
  SOURCE_CHIP_BOX_COST,
  SOURCE_CHIP_PAINTED_HEIGHT,
  SOURCE_CHIP_TOUCH_BOX,
  STRIP_CHEVRON_SIZE,
  STRIP_HEIGHT,
  STRIP_LOCATION_BUDGET_DP,
  STRIP_PILL_HEIGHT,
  bottomInsetFor,
  shellGeometry,
  stripPillTextColumn,
  type Insets,
  type ShellGeometry,
} from "./shellGeometry";
import { measure, space, spacing, type as designType } from "../../theme/design";

type Case = { name: string; width: number; height: number; insets: Insets };

const CASES: Case[] = [
  { name: "Jelly Star 349x621", width: 349, height: 621, insets: { top: 24, bottom: 16 } },
  { name: "Galaxy S23 360x780", width: 360, height: 780, insets: { top: 28, bottom: 24 } },
  { name: "Jelly Star 349x325", width: 349, height: 325, insets: { top: 0, bottom: 0 } },
];
const geometryFor = (device: Case) => shellGeometry(device.width, device.height, device.insets);

describe.each(CASES)("$name", (device) => {
  const geometry = geometryFor(device);

  it("partitions the usable height without gaps or overflow", () => {
    expect(geometry.usableHeight).toBe(device.height - device.insets.top - device.insets.bottom);
    expect(geometry.strip.top).toBe(device.insets.top);
    expect(geometry.transcript.top).toBe(geometry.strip.top + geometry.strip.height);
    expect(geometry.composer.top).toBe(geometry.transcript.top + geometry.transcript.height);
    expect(geometry.strip.height + geometry.transcript.height + geometry.composer.height).toBe(geometry.usableHeight);
    expect(geometry.composer.top + geometry.composer.height).toBe(device.height - device.insets.bottom);
  });

  it("keeps the composer above the bottom inset", () => {
    expect(geometry.composerBottomOffset).toBe(device.insets.bottom);
    expect(geometry.composer.top + geometry.composer.height).toBeLessThanOrEqual(device.height - device.insets.bottom);
  });

  it("keeps every interactive target at least 48 dp in both axes", () => {
    for (const [name, box] of Object.entries(geometry.touchTargets)) {
      expect([name, box.width >= MIN_TOUCH_TARGET, box.height >= MIN_TOUCH_TARGET]).toEqual([name, true, true]);
    }
  });

  it("uses a 56 dp strip and a 44 dp pill inside its 48 dp target", () => {
    expect(STRIP_HEIGHT).toBe(56);
    expect(geometry.strip.height).toBe(STRIP_HEIGHT);
    expect(STRIP_PILL_HEIGHT).toBe(44);
    expect(geometry.touchTargets.stripPill.height).toBe(MIN_TOUCH_TARGET);
  });

  it("leaves a positive transcript band", () => {
    expect(geometry.transcript.height).toBeGreaterThan(0);
    expect(geometry.transcriptUsableHeight).toBe(geometry.transcript.height);
  });

  it("echoes its input dimensions and floor", () => {
    expect(geometry.width).toBe(device.width);
    expect(geometry.height).toBe(device.height);
    expect(geometry.minTouchTarget).toBe(MIN_TOUCH_TARGET);
    expect(MIN_TOUCH_TARGET).toBe(48);
  });
});

describe("short and keyboard-limited heights", () => {
  it("keeps the strip at 56 dp at the 325 dp app height", () => {
    const geometry = shellGeometry(349, 325, { top: 0, bottom: 0 });
    expect(geometry.strip.height).toBe(56);
    expect(geometry.transcript.height).toBe(191);
    expect(geometry.composer.height).toBe(COMPOSER_HEIGHT);
  });

  it("keeps the same strip while the live window is partitioned by the IME", () => {
    const geometry = shellGeometry(349, 621, bottomInsetFor({ top: 24, bottom: 16 }, 296));
    expect(geometry.strip.height).toBe(56);
    expect(geometry.composerBottomOffset).toBe(296);
    expect(geometry.transcript.height).toBe(167);
  });

  it("treats the keyboard and the safe area as one obstruction", () => {
    expect(bottomInsetFor({ top: 24, bottom: 16 }, 296)).toEqual({ top: 24, bottom: 296 });
    expect(bottomInsetFor({ top: 24, bottom: 16 }, 12)).toEqual({ top: 24, bottom: 16 });
    expect(bottomInsetFor({ top: 24, bottom: 16 }, -1)).toEqual({ top: 24, bottom: 16 });
    expect(bottomInsetFor({ top: 24, bottom: 16 }, NaN)).toEqual({ top: 24, bottom: 16 });
  });
});

describe("degenerate heights", () => {
  it("never creates a negative band", () => {
    const geometry = shellGeometry(349, 120, { top: 24, bottom: 24 });
    for (const [name, band] of Object.entries({ strip: geometry.strip, transcript: geometry.transcript, composer: geometry.composer })) {
      expect([name, band.height >= 0, band.top >= 0]).toEqual([name, true, true]);
    }
  });

  it("lets the transcript yield when only 60 dp remain", () => {
    const geometry = shellGeometry(349, 108, { top: 24, bottom: 24 });
    expect(geometry.usableHeight).toBe(60);
    expect(geometry.transcript.height).toBe(0);
    expect(geometry.strip.height + geometry.composer.height).toBe(60);
  });

  it("returns empty bands when the insets consume the whole window", () => {
    const geometry = shellGeometry(349, 20, { top: 24, bottom: 24 });
    expect(geometry.usableHeight).toBe(0);
    expect(geometry.strip.height).toBe(0);
    expect(geometry.transcript.height).toBe(0);
    expect(geometry.composer.height).toBe(0);
  });
});

describe("one-line pill width", () => {
  const geometry = shellGeometry(349, 621, { top: 24, bottom: 16 });
  const pillWidth = geometry.touchTargets.stripPill.width;
  const nameColumn = stripPillTextColumn(pillWidth);

  it("leaves one flexible pill beside the nude menu target", () => {
    expect(pillWidth).toBe(261);
    expect(geometry.touchTargets.stripButton.width).toBe(48);
  });

  it("reserves the device glyph, short location label and chevron before the model name", () => {
    expect(STRIP_LOCATION_BUDGET_DP).toBe(72);
    expect(nameColumn).toBe(pillWidth - 2 * space.sm - 3 * space.xs - 13 - 72 - 16);
  });

  it("clears the measured model-name width", () => {
    expect(nameColumn).toBeGreaterThanOrEqual(MODEL_NAME_COLUMN_NEED_DP);
  });

  it("does not let the chevron consume the whole touch target", () => {
    expect(STRIP_CHEVRON_SIZE).toBeGreaterThan(0);
    expect(STRIP_CHEVRON_SIZE).toBeLessThan(MIN_TOUCH_TARGET);
  });

  it("has a real 44 dp capsule while its pressable remains a 48 dp target", () => {
    expect(STRIP_PILL_HEIGHT).toBe(44);
    expect(geometry.touchTargets.stripPill.height).toBe(48);
  });
});

describe("the composer and content chips", () => {
  it("keeps the composer band large enough for its 56 dp field", () => {
    expect(COMPOSER_HEIGHT).toBeGreaterThanOrEqual(56);
  });

  it("keeps attachment and source controls on real 48 dp targets", () => {
    expect(SOURCE_CHIP_TOUCH_BOX).toBe(48);
    expect(geometryFor(CASES[0]).touchTargets.composerAttach.height).toBe(48);
  });

  it("derives the source-chip paint and the space its touch box costs", () => {
    expect(SOURCE_CHIP_PAINTED_HEIGHT).toBe(designType.meta.lineHeight + 2 * spacing.xs);
    expect(SOURCE_CHIP_BOX_COST).toBe(SOURCE_CHIP_TOUCH_BOX - SOURCE_CHIP_PAINTED_HEIGHT);
    expect(SOURCE_CHIP_BOX_COST).toBe(20);
  });

  it("holds the composer refusal line outside the transcript band", () => {
    expect(SHELL_NOTICE_HEIGHT).toBe(2 * SHELL_NOTICE_GAP + designType.meta.lineHeight);
    const geometry = shellGeometry(349, 325 - SHELL_NOTICE_HEIGHT, { top: 0, bottom: 0 });
    expect(geometry.strip.height + geometry.transcript.height + geometry.composer.height).toBe(325 - SHELL_NOTICE_HEIGHT);
  });

  it("keeps the permanent toolbar out of the mounted composer", () => {
    const source = readFileSync(join(__dirname, "Shell.tsx"), "utf8");
    expect(source).not.toMatch(/ComposerToolbar|COMPOSER_TOOLBAR_HEIGHT/);
  });
});

describe("the device pill seam", () => {
  const source = readFileSync(join(__dirname, "ShellStrip.tsx"), "utf8");

  it("draws the actual strip geometry and capsule from the shared constants", () => {
    expect(source).toContain("height: STRIP_HEIGHT");
    expect(source).toContain("height: STRIP_PILL_HEIGHT");
    expect(source).toContain("STRIP_DEVICE_SIZE");
    expect(source).toContain("STRIP_CHEVRON_SIZE");
  });

  it("keeps the compact layout at the v2 16 dp gutter", () => {
    expect(measure.gutter).toBe(16);
    expect(shellGeometry(349, 621, { top: 24, bottom: 16 }).touchTargets.stripPill.width).toBeGreaterThan(MIN_TOUCH_TARGET);
  });
});
