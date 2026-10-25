import { useEffect, useMemo, useRef, useState } from "react";
import { GROUND, SEED, crownPoints, grow, leaf, mix } from "../lib/treeGeometry";
import { isPageVisible } from "../lib/pageVisible";
import { reducedMotion } from "./motion";
import "./GrowingTree.css";

// The tree is redrawn on a clock, never per progress event: a walk can send
// hundreds of events a second, and a redraw per event once flooded the webview.
const STEP_MS = 250;
/** The drawn value moves in steps of this size, so equal frames are memoised. */
const GRAIN = 0.005;

const quantize = (p: number) => Math.round(Math.min(Math.max(p, 0), 1) / GRAIN) * GRAIN;

/** The drawn p, walking toward `target` a few times a second; at once under
    reduced motion. One interval for as long as the tree is behind its goal —
    a goal that moves on every event must not restart the wait each time —
    and a hidden window draws nothing. */
function useDrawn(target: number): number {
  const goal = quantize(target);
  const [drawn, setDrawn] = useState(goal);
  const goalRef = useRef(goal);
  useEffect(() => {
    goalRef.current = goal;
  }, [goal]);
  const behind = drawn !== goal;
  useEffect(() => {
    if (!behind) return undefined;
    if (reducedMotion()) {
      setDrawn(goalRef.current);
      return undefined;
    }
    const timer = setInterval(() => {
      if (!isPageVisible()) return;
      setDrawn((now) => {
        const gap = goalRef.current - now;
        const stride = Math.sign(gap) * Math.max(GRAIN, Math.abs(gap) * 0.35);
        return Math.abs(stride) >= Math.abs(gap) ? goalRef.current : quantize(now + stride);
      });
    }, STEP_MS);
    return () => clearInterval(timer);
  }, [behind]);
  return drawn;
}

const f1 = (v: number) => v.toFixed(1);
const FILLS = ["#7FA36F", "#9DBE86", "#5E8A55", "#B3CD9A"];

function Vein({ len, opacity }: { len: number; opacity: number }) {
  return <path className="tree-ink-line" d={`M${f1(len * 0.12)} 0 L${f1(len * 0.7)} 0`} strokeWidth={0.7} opacity={opacity} />;
}

/** The drawing at one p (dev/mockups-v4/_src/tree-hearth.mjs). */
function Drawing({ p }: { p: number }) {
  const g = grow(p);
  const { s, crown } = g;
  const bark = mix("#7FA36F", "#6A5A45", s.tree);
  const points = s.canopy > 0 ? crownPoints(crown, 86).sort((a, b) => a.y - b.y) : [];
  return (
    <>
      <circle className="tree-disc" cx={200} cy={180} r={150} />
      <g transform="translate(183 312) scale(3.4) rotate(-15 5 5)" opacity={(1 - Math.min(1, s.tree * 3)).toFixed(2)}>
        <path className="tree-ink" d={SEED} fill="#9A7A4E" strokeWidth={0.4} />
      </g>
      <g className="tree-sway">
        {g.showStem ? <path className="tree-ink" d={g.trunk} fill={bark} /> : null}
        {g.branches.map((d) => (
          <path key={d} className="tree-ink" d={d} fill={bark} />
        ))}
        {g.leaves.map((l, index) => (
          <g key={index} transform={`translate(${f1(l.x)} ${f1(l.y)}) rotate(${l.rot})`} opacity={l.o.toFixed(2)}>
            <path className="tree-ink" d={leaf(l.len, l.belly)} fill="#9DBE86" />
            <Vein len={l.len} opacity={0.8} />
          </g>
        ))}
        {points.map((q) => {
          const out = (Math.atan2(q.y - crown.cy, q.x - crown.cx) * 180) / Math.PI;
          const rot = q.r < 0.25 ? -90 + (q.j - 0.5) * 120 : out + (q.j - 0.5) * 70;
          const len = 23 * s.canopy * (0.85 + 0.3 * q.j);
          return (
            <g key={q.i} transform={`translate(${f1(q.x)} ${f1(q.y)}) rotate(${f1(rot)})`}>
              <path className="tree-ink" d={leaf(len, len * 0.28)} fill={FILLS[q.i % 4]} />
              <Vein len={len} opacity={0.6} />
            </g>
          );
        })}
        {s.bloom > 0
          ? points
              .filter((q) => q.j > 0.86)
              .map((q) => <circle key={q.i} className="tree-ink tree-bloom" cx={f1(q.x)} cy={f1(q.y)} r={f1(3.6 * s.bloom)} />)
          : null}
      </g>
      <path className="tree-ground" d={`M96 ${GROUND + 1} Q200 ${GROUND - 12} 304 ${GROUND + 1} Z`} />
      <path className="tree-ground" d={`M56 ${GROUND + 1} H344 V${GROUND + 16} Q200 ${GROUND + 40} 56 ${GROUND + 16}Z`} />
      <path className="tree-ink-line" d={`M56 ${GROUND + 1} L344 ${GROUND + 1}`} strokeWidth={1.4} />
      {[-130, -96, -60, 54, 92, 126].map((dx) => (
        <path
          key={dx}
          className="tree-ink-line"
          d={`M${200 + dx} ${GROUND} q2 -9 5 -12 M${203 + dx} ${GROUND} q1 -6 -2 -9`}
          strokeWidth={1}
        />
      ))}
    </>
  );
}

/** The walk's tree (RULES.md "Tree progress"): seed, sprout, young tree, full
    tree in blossom, all from one progress value. Decorative: the bar under it
    carries the value for assistive tech. */
export function GrowingTree({ p, failed = false }: { p: number; failed?: boolean }) {
  const drawn = useDrawn(p);
  const drawing = useMemo(() => <Drawing p={drawn} />, [drawn]);
  return (
    <svg className={`tree${failed ? " is-failed" : ""}`} viewBox="0 0 400 400" aria-hidden="true" focusable="false">
      {drawing}
    </svg>
  );
}
