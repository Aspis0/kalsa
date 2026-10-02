// The room's name colors must be readable: every slot — and Kalsa's green —
// clears WCAG AA (4.5:1) against the page each theme actually paints behind
// the names. This reads BOTH sides from the real files, so a value that
// drifts in tokens.css fails here and not on someone's screen: the colors
// from `styles/tokens.css`, the backgrounds from the same file's `--page`,
// which is what base.css paints the app with. The light and dark values of a
// slot are the same hue with the lightness tuned, and no slot's hue may come
// close to Kalsa's green — the assistant is the only green in the room.
// Run: node scripts/name-contrast.mjs

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const TOKENS = fileURLToPath(new URL("../src/styles/tokens.css", import.meta.url));

// sRGB -> linear -> Oklab, relative luminance per WCAG 2.1. The same math
// scripts/palette.mjs carries; not shared because that script is a design
// tool and this one is a check.
function hexToLinear(hex) {
  const n = hex.replace("#", "");
  const c = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
  return c.map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
}
function luminance(hex) {
  const [r, g, b] = hexToLinear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}
function oklchOf(hex) {
  const [r, g, b] = hexToLinear(hex);
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const lp = Math.cbrt(l);
  const mp = Math.cbrt(m);
  const sp = Math.cbrt(s);
  const A = 0.2104542553 * lp + 0.793617785 * mp - 0.0040720468 * sp;
  const B = 1.9779984951 * lp - 2.428592205 * mp + 0.4505937099 * sp;
  const C = 0.0259040371 * lp + 0.7827717662 * mp - 0.808675766 * sp;
  return { hue: ((Math.atan2(C, B) * 180) / Math.PI + 360) % 360, chroma: Math.hypot(B, C) };
}

const css = await readFile(TOKENS, "utf8");
const problems = [];

// The `:root` block is the light theme; the `[data-theme="dark"]` block the
// dark one. A value any theme forgets is a failure before contrast is even
// asked.
function block(scope) {
  const at = css.indexOf(scope);
  if (at < 0) problems.push(`tokens.css has no ${scope} block`);
  const end = css.indexOf("}", at);
  return css.slice(at, end);
}
const lightBlock = block(":root");
const darkBlock = block('[data-theme="dark"]');

function valueOf(source, name, theme) {
  const match = source.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) problems.push(`${theme} theme carries no --${name}`);
  return match?.[1] ?? null;
}

const lightPage = valueOf(lightBlock, "page", "light");
const darkPage = valueOf(darkBlock, "page", "dark");
// The ink is the text a tinted bubble carries: it must clear AA on the wash
// as surely as a name clears it on the page.
const lightInk = valueOf(lightBlock, "ink", "light");
const darkInk = valueOf(darkBlock, "ink", "dark");
const slots = ["kalsa", 1, 2, 3, 4, 5];
const lightColors = new Map();
const darkColors = new Map();
const lightTints = new Map();
const darkTints = new Map();
for (const slot of slots) {
  lightColors.set(slot, valueOf(lightBlock, `room-name-${slot}`, "light"));
  darkColors.set(slot, valueOf(darkBlock, `room-name-${slot}`, "dark"));
  lightTints.set(slot, valueOf(lightBlock, `room-tint-${slot}`, "light"));
  darkTints.set(slot, valueOf(darkBlock, `room-tint-${slot}`, "dark"));
}

const AA = 4.5;
for (const slot of slots) {
  const light = lightColors.get(slot);
  const dark = darkColors.get(slot);
  if (light && lightPage) {
    const value = ratio(light, lightPage);
    if (value < AA) problems.push(`light --room-name-${slot} on --page is ${value.toFixed(2)}:1, below ${AA}`);
  }
  if (dark && darkPage) {
    const value = ratio(dark, darkPage);
    if (value < AA) problems.push(`dark --room-name-${slot} on --page is ${value.toFixed(2)}:1, below ${AA}`);
  }
  // The bubble's wash: the message's own text — the theme's ink — sits on
  // it, so the tint is checked where its reader sits, not against the page.
  const lightTint = lightTints.get(slot);
  const darkTint = darkTints.get(slot);
  if (lightTint && lightInk) {
    const value = ratio(lightInk, lightTint);
    if (value < AA) problems.push(`light ink on --room-tint-${slot} is ${value.toFixed(2)}:1, below ${AA}`);
  }
  if (darkTint && darkInk) {
    const value = ratio(darkInk, darkTint);
    if (value < AA) problems.push(`dark ink on --room-tint-${slot} is ${value.toFixed(2)}:1, below ${AA}`);
  }
}

// One hue per slot across the themes, only the lightness moving; a slot
// whose hue drifted would not be the same color in both themes.
function hueDrift(a, b) {
  const d = Math.abs(a - b);
  return Math.min(d, 360 - d);
}
if (lightPage && darkPage) {
  for (const slot of slots) {
    const light = lightColors.get(slot);
    const dark = darkColors.get(slot);
    if (!light || !dark) continue;
    const drift = hueDrift(oklchOf(light).hue, oklchOf(dark).hue);
    if (drift > 8) {
      problems.push(
        `--room-name-${slot} changed hue between themes: ${oklchOf(light).hue.toFixed(0)} vs ${oklchOf(dark).hue.toFixed(0)}`,
      );
    }
  }

  // The palette is the room's people; the green is Kalsa's alone. Nothing
  // in the rotation may sit near it (the accent's oklch hue, ~165): the
  // hues of a household are blue, violet, rose, gold, cyan.
  const kalsaHue = oklchOf(lightColors.get("kalsa")).hue;
  for (const slot of [1, 2, 3, 4, 5]) {
    const light = lightColors.get(slot);
    if (!light) continue;
    const distance = hueDrift(oklchOf(light).hue, kalsaHue);
    if (distance < 40) {
      problems.push(
        `--room-name-${slot} sits ${distance.toFixed(0)}° from Kalsa's green — too close to the assistant's color`,
      );
    }
  }
}

if (problems.length > 0) {
  console.log("ROOM NAME COLOR FAILURES:");
  for (const problem of problems) console.log(`  - ${problem}`);
  process.exitCode = 1;
} else {
  const shown = slots
    .map((slot) => {
      const value = Math.min(
        ratio(lightColors.get(slot), lightPage),
        ratio(darkColors.get(slot), darkPage),
      );
      return `${slot} ${value.toFixed(2)}:1`;
    })
    .join(", ");
  const washes = slots
    .map((slot) => {
      const value = Math.min(
        ratio(lightInk, lightTints.get(slot)),
        ratio(darkInk, darkTints.get(slot)),
      );
      return `${slot} ${value.toFixed(2)}:1`;
    })
    .join(", ");
  console.log(`ok: every room name color clears ${AA}:1 on both themes' --page (worst: ${shown}), ` +
    `the ink clears it on every bubble wash (worst: ${washes}), each slot keeps one hue across ` +
    `the themes, and no slot sits within 40° of Kalsa's green`);
}
