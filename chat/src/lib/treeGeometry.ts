// The growing tree's geometry, from dev/mockups-v4/_src/tree.mjs: one progress
// value p (0..1) draws every part, so the page animates by moving p alone.

export const GROUND = 330;
const CX = 200;

const clamp = (x: number) => Math.max(0, Math.min(1, x));
const span = (p: number, a: number, b: number) => clamp((p - a) / (b - a));
const ease = (t: number) => 1 - (1 - t) ** 3;

interface Stages {
  shoot: number;
  tree: number;
  branch: number;
  canopy: number;
  bloom: number;
  leafFade: number;
}

function stages(p: number): Stages {
  return {
    shoot: ease(span(p, 0.03, 0.45)),
    tree: ease(span(p, 0.45, 0.95)),
    branch: ease(span(p, 0.5, 0.9)),
    canopy: ease(span(p, 0.55, 1)),
    bloom: ease(span(p, 0.93, 1)),
    leafFade: 1 - span(p, 0.52, 0.66),
  };
}

/** The Kalsa mark (a circle with one sharp corner), 10×10: the seed. */
export const SEED = "M0 10 L0 5 A5 5 0 0 1 5 0 A5 5 0 0 1 10 5 A5 5 0 0 1 5 10 Z";

/** The Kalsa leaf: attachment at the origin, tip at (len, 0). */
export function leaf(len: number, belly: number): string {
  return `M0 0 C${len * 0.2} ${-belly} ${len * 0.64} ${-belly} ${len} 0 C${len * 0.64} ${belly} ${len * 0.2} ${belly} 0 0Z`;
}

type Point = [number, number];

const height = (s: Stages) => 8 + 104 * s.shoot + 140 * s.tree;

function trunkAt(s: Stages, t: number): Point {
  const h = height(s);
  return [CX + 7 * Math.sin(t * Math.PI * 1.15) * (h / 252), GROUND - h * t];
}

/** A filled, tapered limb along pointAt(0..1). */
function taper(pointAt: (t: number) => Point, wBase: number, wTop: number, flare = 0, n = 28): { d: string; tip: Point } {
  const a: Point[] = [];
  const b: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const [x, y] = pointAt(t);
    const [x1, y1] = pointAt(Math.max(0, t - 0.01));
    const [x2, y2] = pointAt(Math.min(1, t + 0.01));
    const l = Math.hypot(x2 - x1, y2 - y1) || 1;
    const nx = -(y2 - y1) / l;
    const ny = (x2 - x1) / l;
    let w = (wBase + (wTop - wBase) * t) / 2;
    if (flare && t < 0.12) w *= 1 + flare * (1 - t / 0.12) ** 2;
    a.push([x + nx * w, y + ny * w]);
    b.push([x - nx * w, y - ny * w]);
  }
  const points = [...a, ...b.reverse()].map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`);
  return { d: `M${points.join(" L")}Z`, tip: pointAt(1) };
}

const BRANCHES = [
  { t: 0.5, a: -58, len: 80 },
  { t: 0.58, a: 54, len: 86 },
  { t: 0.69, a: -36, len: 66 },
  { t: 0.76, a: 38, len: 64 },
  { t: 0.86, a: -16, len: 44 },
  { t: 0.9, a: 22, len: 42 },
];

const SPROUT_LEAVES = [
  { h: 30, side: -1, len: 30, belly: 8 },
  { h: 52, side: 1, len: 28, belly: 7.5 },
  { h: 74, side: -1, len: 25, belly: 7 },
  { h: 94, side: 1, len: 22, belly: 6.5 },
];

export interface Leaf {
  x: number;
  y: number;
  rot: number;
  len: number;
  belly: number;
  o: number;
}

export interface Crown {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export interface Growth {
  s: Stages;
  trunk: string;
  branches: string[];
  crown: Crown;
  leaves: Leaf[];
  showStem: boolean;
}

export function grow(p: number): Growth {
  const s = stages(p);
  const h = height(s);
  const trunk = taper((t) => trunkAt(s, t), 3 + 3 * s.shoot + 17 * s.tree, 1.8 + 1.8 * s.tree, 0.9 * s.tree);

  const branches: string[] = [];
  BRANCHES.forEach((b, i) => {
    const local = clamp(s.branch * 1.5 - i * 0.09);
    if (local <= 0.02) return;
    const [sx, sy] = trunkAt(s, b.t);
    const r = (b.a * Math.PI) / 180;
    const len = b.len * local * (0.65 + 0.35 * s.tree);
    const at = (u: number): Point => [sx + Math.sin(r) * len * u, sy - Math.cos(r) * len * u - 16 * local * u * u];
    branches.push(taper(at, 2 + 6 * local * s.tree, 1.2).d);
  });
  const top = trunk.tip;

  const leaves: Leaf[] = [];
  for (const l of SPROUT_LEAVES) {
    const open = clamp((h - l.h - 8) / 20);
    const o = open * s.leafFade;
    if (o <= 0.01) continue;
    const [x, y] = trunkAt(s, l.h / h);
    leaves.push({ x, y, rot: l.side < 0 ? -145 : -35, len: l.len * (0.4 + 0.6 * open), belly: l.belly * (0.4 + 0.6 * open), o });
  }
  // The seedling's own first pair, riding the tip until the tree takes over.
  const tipO = clamp(s.shoot * 4) * s.leafFade;
  if (tipO > 0.01) {
    const len = 16 * (0.5 + 0.5 * s.shoot);
    leaves.push({ x: top[0], y: top[1], rot: -120, len, belly: 5, o: tipO }, { x: top[0], y: top[1], rot: -60, len, belly: 5, o: tipO });
  }

  const c = s.canopy;
  const crown = { cx: top[0], cy: GROUND - h * 0.79, rx: 122 * c, ry: 94 * c };
  return { s, trunk: trunk.d, branches, crown, leaves, showStem: s.shoot > 0.02 };
}

export interface CrownPoint {
  x: number;
  y: number;
  r: number;
  j: number;
  i: number;
}

/** n points spread evenly over the crown (a sunflower spiral), each with a
    steady pseudo-random jitter j in 0..1, so every frame agrees. */
export function crownPoints(crown: Crown, n: number): CrownPoint[] {
  const points: CrownPoint[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt((i + 0.5) / n);
    const a = i * 2.39996;
    const j = ((i * 9301 + 49297) % 233280) / 233280;
    points.push({ x: crown.cx + crown.rx * r * Math.cos(a), y: crown.cy + crown.ry * r * Math.sin(a), r, j, i });
  }
  return points;
}

/** Mix two #rrggbb colours. */
export function mix(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return "#" + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, "0")).join("");
}
