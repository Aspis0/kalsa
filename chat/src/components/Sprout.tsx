import "./Sprout.css";

// The walk's face: Kalsa's own leaf, grown. A seed half in the soil with
// nothing to show; the stem drawing upward with the phase's own percent;
// leaves unfolding as the tip reaches their heights — and never still: the
// plant sways while a step waits, which is the signal that Kalsa is still
// working. One inline SVG and its own CSS: no image, no dependency. The
// seed is the topbar mark itself (App.css's .topbar-mark: a circle with one
// sharp corner) and every leaf keeps that character — round belly, sharp
// corner at the stem, drawn out to a point that faces outward.

/** The mark, 10×10: the seed, half buried in the mound. */
const SEED = "M0 10 L0 5 A5 5 0 0 1 5 0 A5 5 0 0 1 10 5 A5 5 0 0 1 5 10 Z";

/** One leaf in its own frame: the attachment is the origin, the tip sits at
    (`length`, 0) — the mark's round belly and sharp corner, drawn out to a
    point that faces away from the stem. */
function leaf(length: number, belly: number): string {
  return (
    `M0 0 C ${length * 0.2} ${-belly} ${length * 0.64} ${-belly} ${length} 0 ` +
    `C ${length * 0.64} ${belly} ${length * 0.2} ${belly} 0 0 Z`
  );
}

// The stem as one cubic: a gentle S the plant stands on at ROOT and leans
// from at TIP. The leaves read their own attach points off this same curve,
// so none of them can sit beside the stroke it grew from.
const ROOT: [number, number] = [80, 140];
const C1: [number, number] = [65, 110];
const C2: [number, number] = [95, 52];
const TIP: [number, number] = [80, 18];
const STEM_PATH = `M${ROOT[0]} ${ROOT[1]} C${C1[0]} ${C1[1]} ${C2[0]} ${C2[1]} ${TIP[0]} ${TIP[1]}`;

function stemPoint(t: number): [number, number] {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [
    a * ROOT[0] + b * C1[0] + c * C2[0] + d * TIP[0],
    a * ROOT[1] + b * C1[1] + c * C2[1] + d * TIP[1],
  ];
}

/** The curve's arc length, sampled once at load: the stem draws against the
    path's own length (pathLength="1"), so a leaf a fifth of the way up must
    sit a fifth of the way along, not a fifth of the parameter. */
const AT_LENGTH: number[] = (() => {
  const steps = 160;
  const lengths = [0];
  let previous = stemPoint(0);
  let total = 0;
  for (let step = 1; step <= steps; step += 1) {
    const point = stemPoint(step / steps);
    total += Math.hypot(point[0] - previous[0], point[1] - previous[1]);
    lengths.push(total);
    previous = point;
  }
  return lengths.map((value) => value / total);
})();

/** The point the stem has grown to at `fraction` of its own length. */
function stemAt(fraction: number): [number, number] {
  const wanted = Math.min(Math.max(fraction, 0), 1);
  const index = AT_LENGTH.findIndex((value) => value >= wanted);
  if (index <= 0) return stemPoint(0);
  const span = AT_LENGTH[index] - AT_LENGTH[index - 1];
  const mix = span > 0 ? (wanted - AT_LENGTH[index - 1]) / span : 0;
  return stemPoint((index - 1 + mix) / (AT_LENGTH.length - 1));
}

/** Where the leaves attach: alternating sides up the stem, the biggest at
    the bottom and each a little smaller above it, every one opening when
    the tip reaches its own height. */
const LEAVES = [
  { at: 0.22, side: -1, length: 34, belly: 9 },
  { at: 0.45, side: 1, length: 30, belly: 8 },
  { at: 0.68, side: -1, length: 25, belly: 7 },
];
/** Every leaf leans out of the stem the same way: up, and toward its own
    side. */
const LEAN = 35;

/** The stem drawn as three passes of one curve — the same line at three
    widths, each stopped at its own share of the growth — so the base is the
    thickest and the taper is a step the round caps soften. */
const STROKE: Array<[width: number, span: number]> = [
  [7.4, 0.3],
  [6, 0.5],
  [4.4, 1],
];

/** The shoot's own point: a small bud riding the tip as the stem draws,
    opening only when the walk says done. */
const BUD: [number, number] = [18, 5.5];
const BUD_ANGLE = (Math.atan2(TIP[1] - C2[1], TIP[0] - C2[0]) * 180) / Math.PI;
/** What a step with no fraction shows: grown enough to sway with a leaf on
    it, never enough to claim ground the walk has not covered. */
const RESTING = 0.3;

export interface SproutProps {
  /** The phase's own percent — null for a step that carries none, where the
      sprout holds at its resting height instead of growing. */
  pct: number | null;
  /** The walk's own done for this step: the bud opens and the plant takes
      one small bow. */
  done?: boolean;
  /** The line under the bar: the step's numbers, in words. */
  caption?: string | null;
}

export function Sprout({ pct, done = false, caption = null }: SproutProps) {
  const growth = pct === null ? RESTING : Math.min(Math.max(pct, 0), 100) / 100;
  const shown = pct === null ? null : Math.min(Math.max(pct, 0), 100);
  const tip = stemAt(growth);
  return (
    <div className="sprout">
      <svg
        className={`sprout-svg${done ? " is-done" : ""}`}
        viewBox="0 -16 160 168"
        aria-hidden="true"
        focusable="false"
      >
        <g className="sprout-plant">
          <g className="sprout-bow">
            {/* The mark itself, standing where the mound's crest crosses it:
                half in the soil, tilted like something dropped there. */}
            <g transform="translate(72.5 128.5) scale(1.5)">
              <g transform="rotate(-15 5 5)">
                <path className="sprout-seed" d={SEED} />
              </g>
            </g>
            {STROKE.map(([width, span]) => (
              <path
                key={width}
                className="sprout-stem"
                d={STEM_PATH}
                pathLength={1}
                style={{ strokeWidth: width, strokeDasharray: `${Math.min(growth, span)} 1` }}
              />
            ))}
            {LEAVES.map((item) => {
              const point = stemAt(item.at);
              return (
                <g
                  key={item.at}
                  transform={`translate(${point[0]} ${point[1]}) rotate(${-LEAN * item.side})${
                    item.side < 0 ? " scale(-1 1)" : ""
                  }`}
                >
                  <g className={`sprout-leaf${growth >= item.at ? " is-open" : ""}`}>
                    <path className="sprout-body" d={leaf(item.length, item.belly)} />
                    <path
                      className="sprout-vein"
                      d={`M${item.length * 0.14} 0 L${item.length * 0.66} 0`}
                    />
                  </g>
                </g>
              );
            })}
            <g
              className="sprout-bud-seat"
              style={{ transform: `translate(${tip[0]}px, ${tip[1]}px) rotate(${BUD_ANGLE}deg)` }}
            >
              <g className={`sprout-bud${growth >= 0.9 ? " is-grown" : ""}${done ? " is-open" : ""}`}>
                <path className="sprout-body" d={leaf(BUD[0], BUD[1])} />
                <path className="sprout-vein" d={`M2.5 0 L${BUD[0] * 0.66} 0`} />
              </g>
            </g>
            {/* Last, over the seed and the stem's foot: everything the soil
                covers is covered by the soil. */}
            <path className="sprout-soil" d="M16 150 A64 14 0 0 1 144 150 Z" />
          </g>
        </g>
      </svg>
      <div className={shown === null ? "sprout-bar is-indeterminate" : "sprout-bar"}>
        {shown === null ? null : <span className="sprout-bar-fill" style={{ width: `${shown}%` }} />}
      </div>
      {caption !== null ? <p className="sprout-caption">{caption}</p> : null}
    </div>
  );
}
