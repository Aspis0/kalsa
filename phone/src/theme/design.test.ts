/**
 * The palette is the one asset that survives the rebuild, so it is the one
 * asset that is checked arithmetically. These tests fail the moment a value is
 * changed by eye: the target is a 3-inch 220 dpi panel (349x621 dp) and "it
 * looks fine" is not available to us.
 *
 * The negative assertions are the important half: they pin down why a value is
 * confined to one role, so the rule cannot be quietly broken later.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { e2, e3, families, measure, modes, radius, space, type, type DesignColors, type ThemeMode } from "./design";

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`not a 6-digit hex colour: ${hex}`);
  return [
    parseInt(m[1].slice(0, 2), 16),
    parseInt(m[1].slice(2, 4), 16),
    parseInt(m[1].slice(4, 6), 16),
  ];
}

function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function atLeast(a: string, b: string, floor: number, pair: string): void {
  const r = contrast(a, b);
  if (r < floor) throw new Error(`${pair}: ${r.toFixed(2)}:1, needs ${floor}:1 (${a} on ${b})`);
}

function atMost(a: string, b: string, ceiling: number, pair: string): void {
  const r = contrast(a, b);
  if (r > ceiling) throw new Error(`${pair}: ${r.toFixed(2)}:1, expected at most ${ceiling}:1 (${a} on ${b})`);
}

const allModes: Array<[ThemeMode, DesignColors]> = [
  ["light", modes.light],
  ["dark", modes.dark],
];
const SEND_COMPOSER = readFileSync(join(__dirname, "..", "ui", "shell", "ShellComposer.tsx"), "utf8");

describe("contrast arithmetic", () => {
  it("matches the two reference values", () => {
    expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrast("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
  });
});

describe("palette shape", () => {
  it("declares the same keys in both modes", () => {
    expect(Object.keys(modes.light).sort()).toEqual(Object.keys(modes.dark).sort());
  });

  it("carries the v2 roles at their measured values", () => {
    expect(modes.light).toMatchObject({
      page: "#eef5f0", surface: "#fbfdfb", tint: "#e6f1e9", line: "#dfe9e2",
      ink: "#12171a", ink2: "#2b3330", ink3: "#5f6b66", brand: "#1f5f4e",
      accent: "#1f5f4e", selection: "#cfe3d6", danger: "#8a3b32", wait: "#f8f2e4", waitInk: "#6a5729",
    });
    expect(modes.dark).toMatchObject({
      page: "#0f1512", surface: "#161d19", tint: "#1d2722", line: "#26302b",
      ink: "#eaf1ec", ink2: "#ccd7d1", ink3: "#96a49c", brand: "#2b7a63",
      accent: "#7fbfa6", selection: "#25423a", danger: "#e0a49b", wait: "#241f14", waitInk: "#e6cf9a",
    });
  });

  it("uses plain hex, so every value can be measured", () => {
    for (const [mode, colors] of allModes) {
      for (const [key, value] of Object.entries(colors)) {
        expect([mode, key, /^#[0-9a-f]{6}$/i.test(value)]).toEqual([mode, key, true]);
      }
    }
  });
});

describe.each(allModes)("%s palette", (_mode, c) => {
  it("carries the answer at AAA on every surface", () => {
    atLeast(c.ink, c.page, 7, "ink on page");
    atLeast(c.ink, c.surface, 7, "ink on surface");
    atLeast(c.ink, c.surfaceMuted, 7, "ink on surfaceMuted");
    atLeast(c.ink, c.bubbleUser, 7, "ink on the user's turn");
  });

  it("carries secondary text at AA everywhere it may appear", () => {
    atLeast(c.inkSoft, c.page, 7, "inkSoft on page");
    atLeast(c.inkSoft, c.surface, 7, "inkSoft on surface");
    atLeast(c.inkSoft, c.bubbleUser, 4.5, "inkSoft on the user's turn");
  });

  it("carries tertiary text at AA on the reading surfaces", () => {
    atLeast(c.silence, c.page, 4.5, "silence on page");
    atLeast(c.silence, c.surface, 4.5, "silence on surface");
  });

  it("carries the accent as text and as a fill", () => {
    atLeast(c.accent, c.page, 4.5, "accent on page");
    atLeast(c.accent, c.surface, 4.5, "accent on surface");
    atLeast(c.onBrand, c.brand, 4.5, "white on the brand fill");
  });

  it("carries destructive text", () => {
    atLeast(c.danger, c.page, 4.5, "danger on page");
    atLeast(c.danger, c.surface, 4.5, "danger on surface");
    atLeast(c.danger, c.bubbleUser, 4.5, "danger on the user's turn");
    atLeast(c.danger, c.dangerSoft, 4.5, "danger on dangerSoft");
  });

  it("draws hairlines you can see", () => {
    atLeast(c.border, c.page, 1.1, "line on page");
    atLeast(c.borderStrong, c.page, 1.2, "borderStrong on page");
  });

  it("steps the user's turn off the page enough to be felt", () => {
    atLeast(c.bubbleUser, c.page, 1.2, "the user's turn against the page");
  });
});

describe("what each mode has to compensate for", () => {
  it("gives the dark theme a larger step, because a small one smudges", () => {
    const light = contrast(modes.light.bubbleUser, modes.light.page);
    const dark = contrast(modes.dark.bubbleUser, modes.dark.page);
    expect(dark).toBeGreaterThan(light);
  });

  it("keeps the light theme's user turn inside the conventional band", () => {
    // ChatGPT's own bubble is about a 1.24:1 step against its page. Below 1.2 it
    // stops being felt; a large step turns the transcript into a card wall.
    const step = contrast(modes.light.bubbleUser, modes.light.page);
    expect(step).toBeGreaterThanOrEqual(1.2);
    expect(step).toBeLessThanOrEqual(1.45);
  });
});

describe("roles a value must not be moved into", () => {
  it("does not treat a surface as a boundary", () => {
    // surface against page is 1.07:1 in light: a surface cannot be told apart
    // from the page by a border, so elevation and whitespace carry it instead.
    atMost(modes.light.surface, modes.light.page, 1.15, "surface on page");
  });

  it("keeps the dark user's turn on the two allowed ink roles", () => {
    atLeast(modes.dark.ink, modes.dark.selection, 4.5, "ink on the dark user turn");
    atLeast(modes.dark.ink2, modes.dark.selection, 4.5, "ink2 on the dark user turn");
    expect(modes.dark.bubbleUser).toBe(modes.dark.selection);
  });
});

describe("type ladder", () => {
  const order: Array<keyof typeof type> = ["display", "title", "headline", "body", "secondary", "label"];

  it("descends without ties", () => {
    const sizes = order.map((role) => type[role].fontSize);
    for (let i = 1; i < sizes.length; i += 1) {
      expect(sizes[i]).toBeLessThan(sizes[i - 1]);
    }
  });

  it("gives every reading role room for its own leading", () => {
    for (const role of order) {
      const style = type[role];
      if (style.lineHeight <= style.fontSize) {
        throw new Error(`${role}: lineHeight ${style.lineHeight} <= fontSize ${style.fontSize}`);
      }
    }
  });

  it("never pairs a custom family with a numeric weight", () => {
    // The Android trap: weight must come from the face name, or the device
    // silently ignores it and the two platforms disagree.
    for (const [role, style] of Object.entries(type)) {
      expect([role, (style as { fontWeight?: unknown }).fontWeight]).toEqual([role, undefined]);
    }
  });

  it("draws every family from the loaded set", () => {
    const loaded = new Set<string>(Object.values(families));
    for (const [role, style] of Object.entries(type)) {
      expect([role, loaded.has(style.fontFamily)]).toEqual([role, true]);
    }
  });
});

describe("measure", () => {
  it("clears the 48 dp minimum", () => {
    expect(measure.touchTarget).toBeGreaterThanOrEqual(48);
  });

  it("uses the v2 16 dp content gutter in both shell widths", () => {
    expect(measure.gutter).toBe(16);
    expect(measure.gutterCompact).toBe(16);
  });

  it("leaves a band above the composer", () => {
    expect(measure.composerLift).toBeGreaterThan(0);
  });
});

describe("v2 shape and space tokens", () => {
  it("names the Sheet's floating shadow role e3", () => {
    expect(e3).toBe(e2);
  });

  it("uses the v2 spacing ladder and semantic radii", () => {
    expect(Object.values(space)).toEqual([4, 8, 12, 16, 20, 24, 32]);
    expect(radius).toMatchObject({
      button: 14,
      field: 14,
      row: 14,
      iconButton: 14,
      card: 16,
      image: 16,
      sheet: 22,
      chip: 999,
      badge: 999,
      toggle: 999,
      composer: 999,
    });
  });
});


describe("DESIGN-V2.md §1.1 role constraints", () => {
  it("keeps surface and page so close that whitespace and elevation must separate them", () => {
    for (const [mode, colors] of allModes) atMost(colors.surface, colors.page, 1.15, `${mode} surface/page`);
  });

  it("keeps ink3 at metadata contrast while prose roles use ink or ink2", () => {
    for (const [mode, colors] of allModes) {
      atLeast(colors.ink3, colors.page, 4.5, `${mode} ink3 on page`);
      atLeast(colors.ink3, colors.surface, 4.5, `${mode} ink3 on surface`);
      atLeast(colors.ink, colors.page, 7, `${mode} ink on page`);
      atLeast(colors.ink2, colors.page, 4.5, `${mode} ink2 on page`);
    }
    expect(type.body.fontFamily).toBe(families.sans);
    expect(type.secondary.fontFamily).toBe(families.sans);
  });

  it("reserves white foreground for the brand fill", () => {
    for (const [mode, colors] of allModes) {
      expect(colors.onBrand).toBe("#ffffff");
      atLeast(colors.onBrand, colors.brand, 4.5, `${mode} white on brand`);
    }
    expect(contrast(modes.dark.onBrand, modes.dark.accent)).toBeLessThan(4.5);
  });

  it("uses brand and onBrand for the send circle in both schemes", () => {
    expect(SEND_COMPOSER).toContain("backgroundColor: canActivate ? colors.brand : colors.tint");
    expect(SEND_COMPOSER).toContain("const faceColor = canActivate ? colors.onBrand : colors.ink3;");
    expect(SEND_COMPOSER).toContain('<ActivityIndicator size="small" color={faceColor} />');
    for (const [mode, colors] of allModes) {
      atLeast(colors.onBrand, colors.brand, 4.5, `${mode} send glyph on brand fill`);
    }
  });

  it("allows only the two ink roles on a user's turn", () => {
    for (const [mode, colors] of allModes) {
      atLeast(colors.ink, colors.selection, 4.5, `${mode} ink on selection`);
      atLeast(colors.ink2, colors.selection, 4.5, `${mode} ink2 on selection`);
      expect(colors.bubbleUser).toBe(colors.selection);
    }
  });

  it("keeps dark brand as a fill and accent as the readable text/icon role", () => {
    expect(modes.dark.brand).not.toBe(modes.dark.accent);
    atLeast(modes.light.accent, modes.light.page, 4.5, "light accent on page");
    atLeast(modes.dark.accent, modes.dark.page, 4.5, "dark accent on page");
    atLeast(modes.dark.onBrand, modes.dark.brand, 4.5, "dark white on brand");
  });
});
