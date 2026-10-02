import "./Sprout.css";

// The walk's face: the app's own leaf, grown. A seed on the soil line with
// nothing to show; the stem drawing up with the phase's own percent; leaves
// unfolding as the tip reaches their heights — and never still: the plant
// sways while a step waits, which is the signal that Kalsa is still working.
// One inline SVG and its own CSS: no image, no dependency, no new library.
// The leaf is the shape the topbar mark is cut from (App.css's .topbar-mark:
// a circle with one square corner), so the plant and that mark are one
// object at two sizes, both in the same --accent green.

/** The leaf, 10×10 with the sharp corner — the attachment to the stem, and
    the point the unfold turns on — at the origin. */
const LEAF = "M0 0 L0 -5 A5 5 0 0 1 5 -10 A5 5 0 0 1 10 -5 A5 5 0 0 1 5 0 Z";

/** Where a leaf sits along the stem, as a share of the growth that draws
    it: each opens when the tip reaches its own height, so the plant never
    wears a leaf its stem has not grown past. `side` is which way it points,
    `tilt` how far it leans out of the upright (the leaf's own line is 45°,
    so a tilt of 30 all but lays it out sideways). */
const LEAVES = [
  { at: 0.2, side: -1, tilt: 30 },
  { at: 0.45, side: 1, tilt: 30 },
  { at: 0.7, side: -1, tilt: 40 },
  { at: 0.9, side: 1, tilt: 5 },
];
/** The leaf drawn at 10 units, worn at sixteen — the mark's own shape,
    big enough to be a leaf rather than a bump on the stem. */
const LEAF_SIZE = 1.6;

// The plant's own geometry, in the SVG's viewBox units. The box's bottom
// edge IS the soil: the ground line below the SVG carries it the rest of
// the way across the page.
const X = 40; // the stem's line
const ROOT = 66; // where the stem leaves the seed
const STEM = 40; // how far up it reaches at full growth
/** What a step with no fraction shows: grown enough to sway with a leaf on
    it, never enough to claim ground the walk has not covered. */
const RESTING = 0.3;

export interface SproutProps {
  /** The phase's own percent — null for a step that carries none, where the
      sprout holds at its resting height instead of growing. */
  pct: number | null;
  /** The walk's own done for this step: the top leaf is open and the plant
      takes one small bow. */
  done?: boolean;
  /** The line under the bar: the step's numbers, in words. */
  caption?: string | null;
}

export function Sprout({ pct, done = false, caption = null }: SproutProps) {
  const growth = pct === null ? RESTING : Math.min(Math.max(pct, 0), 100) / 100;
  const shown = pct === null ? null : Math.min(Math.max(pct, 0), 100);
  return (
    <div className="sprout">
      <svg
        className={`sprout-svg${done ? " is-done" : ""}`}
        viewBox="0 0 80 71"
        aria-hidden="true"
        focusable="false"
      >
        <g className="sprout-plant">
          <g className="sprout-bow">
            <ellipse className="sprout-seed" cx={X} cy={ROOT} rx="5" ry="3.5" />
            <path
              className="sprout-stem"
              d={`M${X} ${ROOT} L${X} ${ROOT - STEM}`}
              pathLength={1}
              style={{ strokeDashoffset: 1 - growth }}
            />
            {LEAVES.map((leaf) => (
              <g
                key={leaf.at}
                transform={`translate(${X} ${ROOT - STEM * leaf.at}) rotate(${leaf.side * leaf.tilt}) scale(${
                  leaf.side * LEAF_SIZE
                } ${LEAF_SIZE})`}
              >
                <g className={`sprout-leaf${growth >= leaf.at ? " is-open" : ""}`}>
                  <path d={LEAF} />
                </g>
              </g>
            ))}
          </g>
        </g>
      </svg>
      <div className="sprout-ground" />
      <div className={shown === null ? "sprout-bar is-indeterminate" : "sprout-bar"}>
        {shown === null ? null : <span className="sprout-bar-fill" style={{ width: `${shown}%` }} />}
      </div>
      {caption !== null ? <p className="sprout-caption">{caption}</p> : null}
    </div>
  );
}
