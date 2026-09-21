/**
 * The palette is the one asset that survives the rebuild, so it is the one
 * asset that is checked arithmetically. These tests fail the moment a value is
 * changed by eye: the target is a 3-inch 220 dpi panel (349x621 dp) and "it
 * looks fine" is not available to us.
 *
 * The negative assertions are the important half: they pin down why a value is
 * confined to one role, so the rule cannot be quietly broken later.
 */

import { families, measure, modes, type, type DesignColors, type ThemeMode } from "./design";

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
    atLeast(c.onAccent, c.accent, 4.5, "onAccent on a filled accent control");
  });

  it("carries destructive text", () => {
    atLeast(c.danger, c.page, 4.5, "danger on page");
    atLeast(c.danger, c.surface, 4.5, "danger on surface");
    atLeast(c.danger, c.bubbleUser, 4.5, "danger on the user's turn");
    atLeast(c.danger, c.dangerSoft, 4.5, "danger on dangerSoft");
  });

  it("draws hairlines you can see", () => {
    atLeast(c.border, c.page, 1.15, "border on page");
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

  it("forbids tertiary text and the accent inside the dark user turn", () => {
    // 4.22:1 and 4.49:1 — both under AA. Inside the user's turn only ink and
    // inkSoft may be used, and this is the assertion that keeps it that way.
    atMost(modes.dark.silence, modes.dark.bubbleUser, 4.5, "silence on the dark user turn");
    atMost(modes.dark.accent, modes.dark.bubbleUser, 4.5, "accent on the dark user turn");
  });
});

describe("type ladder", () => {
  const order: Array<keyof typeof type> = ["display", "title", "body", "label", "mono", "meta"];

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

  it("narrows the gutter on the small screen", () => {
    expect(measure.gutterCompact).toBeLessThan(measure.gutter);
  });

  it("leaves a band above the composer", () => {
    expect(measure.composerLift).toBeGreaterThan(0);
  });
});
