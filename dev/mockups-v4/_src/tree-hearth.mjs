// The growing tree as a botanical ink study, in Hearth's palette.
import { grow, mix, leaf, crownPoints, SEED, GROUND } from './tree.mjs';

const VB = 'viewBox="0 0 400 400"';
const f1 = v => v.toFixed(1);
const seed = (fill, stroke = 'none', o = 1) =>
  `<g transform="translate(183 312) scale(3.4) rotate(-15 5 5)" opacity="${o.toFixed(2)}"><path d="${SEED}" fill="${fill}" stroke="${stroke}" stroke-width="${stroke === 'none' ? 0 : 0.4}"/></g>`;

export function hearth(p) {
  const g = grow(p), s = g.s, c = s.canopy;
  const ink = '#2F362A';
  const bark = mix('#7FA36F', '#6A5A45', s.tree);
  const fills = ['#7FA36F', '#9DBE86', '#5E8A55', '#B3CD9A'];
  const sw = `stroke="${ink}" stroke-width="1" stroke-linejoin="round"`;
  const vein = (len, o) => `<path d="M${f1(len * 0.12)} 0 L${f1(len * 0.7)} 0" stroke="${ink}" stroke-width=".7" opacity="${o}"/>`;
  let crown = '', blooms = '';
  if (c > 0) {
    const pts = crownPoints(g.crown, 86).sort((a, b) => a.y - b.y);
    crown = pts.map(q => {
      const out = (Math.atan2(q.y - g.crown.cy, q.x - g.crown.cx) * 180) / Math.PI;
      const rot = q.r < 0.25 ? -90 + (q.j - 0.5) * 120 : out + (q.j - 0.5) * 70;
      const len = 23 * c * (0.85 + 0.3 * q.j);
      return `<g transform="translate(${f1(q.x)} ${f1(q.y)}) rotate(${f1(rot)})"><path d="${leaf(len, len * 0.28)}" fill="${fills[q.i % 4]}" ${sw}/>${vein(len, 0.6)}</g>`;
    }).join('');
    if (s.bloom > 0) blooms = pts.filter(q => q.j > 0.86).map(q => `<circle cx="${f1(q.x)}" cy="${f1(q.y)}" r="${f1(3.6 * s.bloom)}" fill="#D8B35A" ${sw}/>`).join('');
  }
  const grass = [-130, -96, -60, 54, 92, 126].map(dx => `<path d="M${200 + dx} ${GROUND} q2 -9 5 -12 M${203 + dx} ${GROUND} q1 -6 -2 -9" stroke="${ink}" stroke-width="1" fill="none" stroke-linecap="round"/>`).join('');
  return `<svg ${VB} width="100%" height="100%" aria-hidden="true">
  <circle cx="200" cy="180" r="150" fill="#ECE4D0"/>
  ${seed('#9A7A4E', ink, 1 - Math.min(1, s.tree * 3))}
  ${g.showStem ? `<path d="${g.trunk}" fill="${bark}" ${sw}/>` : ''}
  ${g.branches.map(d => `<path d="${d}" fill="${bark}" ${sw}/>`).join('')}
  ${g.leaves.map(l => `<g transform="translate(${f1(l.x)} ${f1(l.y)}) rotate(${l.rot})" opacity="${l.o.toFixed(2)}"><path d="${leaf(l.len, l.belly)}" fill="#9DBE86" ${sw}/>${vein(l.len, 0.8)}</g>`).join('')}
  ${crown}${blooms}
  <path d="M96 ${GROUND + 1} Q200 ${GROUND - 12} 304 ${GROUND + 1} Z" fill="#E2D6BC"/>
  <path d="M56 ${GROUND + 1} H344 V${GROUND + 16} Q200 ${GROUND + 40} 56 ${GROUND + 16}Z" fill="#E2D6BC"/>
  <path d="M56 ${GROUND + 1} L344 ${GROUND + 1}" stroke="${ink}" stroke-width="1.4" stroke-linecap="round"/>
  ${grass}
  </svg>`;
}
