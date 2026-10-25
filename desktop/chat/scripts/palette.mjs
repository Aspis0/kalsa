// Palette derivation + WCAG contrast verification for crescent-chat.
// No dependencies: sRGB <-> OKLCH math inline, relative luminance per WCAG 2.1.
// Run: node scripts/palette.mjs
// Accent states move ONLY in lightness within the same hue (oklch L).

function hexToLinear(hex) {
  const n = hex.replace("#", "");
  const c = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
  return c.map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
}

function linearToHex(rgb) {
  const enc = (v) => {
    v = Math.min(1, Math.max(0, v));
    const s = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return Math.round(s * 255).toString(16).padStart(2, "0");
  };
  return `#${enc(rgb[0])}${enc(rgb[1])}${enc(rgb[2])}`.toUpperCase();
}

function linearToOklab([r, g, b]) {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const lp = Math.cbrt(l), mp = Math.cbrt(m), sp = Math.cbrt(s);
  return [
    0.2104542553 * lp + 0.7936177850 * mp - 0.0040720468 * sp,
    1.9779984951 * lp - 2.4285922050 * mp + 0.4505937099 * sp,
    0.0259040371 * lp + 0.7827717662 * mp - 0.8086757660 * sp,
  ];
}

function oklabToLinear([L, a, b]) {
  const lp = L + 0.3963377774 * a + 0.2158037573 * b;
  const mp = L - 0.1055613458 * a - 0.0638541728 * b;
  const sp = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = lp ** 3, m = mp ** 3, s = sp ** 3;
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}

function hexToOklch(hex) {
  const [L, a, b] = linearToOklab(hexToLinear(hex));
  return { L, C: Math.hypot(a, b), h: Math.atan2(b, a) };
}

function oklchToHex({ L, C, h }) {
  return linearToHex(oklabToLinear([L, C * Math.cos(h), C * Math.sin(h)]));
}

function withLightness(hex, L) {
  const { C, h } = hexToOklch(hex);
  return oklchToHex({ L, C, h });
}

function luminance(hex) {
  const [r, g, b] = hexToLinear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(fg, bg) {
  const a = luminance(fg), b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

const ACCENT = "#1F5F4E";
const base = hexToOklch(ACCENT);
console.log(`accent ${ACCENT} -> oklch(L=${base.L.toFixed(4)} C=${base.C.toFixed(4)} h=${base.h.toFixed(4)})`);

// States: same hue, lightness steps only.
const hover = withLightness(ACCENT, base.L - 0.035);
const pressed = withLightness(ACCENT, base.L - 0.07);
// Dark-theme accent: same hue, lifted until it reads on near-black green.
let darkAccent = withLightness(ACCENT, 0.72);
console.log(`accent-hover   ${hover}`);
console.log(`accent-pressed ${pressed}`);
console.log(`accent-dark    ${darkAccent}`);

// Candidate dark surfaces / inks around #17201C / #2C3630.
const D = {
  page: "#111613",
  surface: "#1A211C",
  surfaceMuted: "#232C26",
  ink: "#E9F0EA",
  inkSoft: "#C2CFC5",
  silence: "#97A59C",
  border: "#2E3833",
  borderStrong: "#414E46",
};
for (const [k, v] of Object.entries(D)) console.log(`dark-${k} ${v}`);

const dangerLight = "#8A3B32";
const dangerDark = "#D89C92";

const checks = [
  // [label, fg, bg, min]
  ["light ink/page", "#17201C", "#F4F8F3", 4.5],
  ["light ink-soft/page", "#2C3630", "#F4F8F3", 4.5],
  ["light silence/page", "#58615B", "#F4F8F3", 4.5],
  ["light ink/surface-white", "#17201C", "#FFFFFF", 4.5],
  ["light silence/surface-white", "#58615B", "#FFFFFF", 4.5],
  ["light ink/surface-muted", "#17201C", "#E8EAE7", 4.5],
  ["light ink-soft/surface-muted", "#2C3630", "#E8EAE7", 4.5],
  ["light accent-text/page (links)", ACCENT, "#F4F8F3", 4.5],
  ["light white/accent (send btn)", "#FFFFFF", ACCENT, 4.5],
  ["light white/accent-hover", "#FFFFFF", hover, 4.5],
  ["light white/accent-pressed", "#FFFFFF", pressed, 4.5],
  ["light danger/page", dangerLight, "#F4F8F3", 4.5],
  ["light danger/white", dangerLight, "#FFFFFF", 4.5],
  ["dark ink/surface", D.ink, D.surface, 4.5],
  ["dark ink-soft/surface", D.inkSoft, D.surface, 4.5],
  ["dark silence/surface", D.silence, D.surface, 4.5],
  ["dark ink/page", D.ink, D.page, 4.5],
  ["dark silence/surface-muted", D.silence, D.surfaceMuted, 4.5],
  ["dark accent-text/surface (links)", darkAccent, D.surface, 4.5],
  ["dark page/accent (send btn text)", D.page, darkAccent, 4.5],
  ["dark danger/surface", dangerDark, D.surface, 4.5],
  ["dark ink-soft/surface-muted", D.inkSoft, D.surfaceMuted, 4.5],
];

let fail = 0;
console.log("\ncontrast (WCAG 2.1 ratio, AA normal text needs >= 4.5):");
for (const [label, fg, bg, min] of checks) {
  const r = ratio(fg, bg);
  const ok = r >= min ? "PASS" : "FAIL";
  if (ok === "FAIL") fail++;
  console.log(`${ok}  ${r.toFixed(2)}  ${label}  (fg ${fg} on ${bg})`);
}
process.exit(fail ? 1 : 0);
