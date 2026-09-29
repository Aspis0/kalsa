// The reduced-motion gate, checked where the fake DOM cannot look: every
// animation and transition the surfaces declare must live inside the
// `@media (prefers-reduced-motion: no-preference)` block, so a reader who
// asked for stillness gets it — no loop survives outside the gate, and the
// gate itself must exist. Run by dev/smoke-react.mjs; exits through its
// problem list.
import { readFileSync } from "node:fs";

const GUARD = "@media (prefers-reduced-motion: no-preference)";

export function motionCssProblems(css) {
  const problems = [];
  // Comments can say "animation" all they like; the gate is about rules.
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
  // One entry per open brace — whether that block is the guard or sits
  // inside it — and the declarations are judged by the blocks open at
  // their own position on the line, braces and all.
  const stack = [];
  let pending = "";
  let guardSeen = false;
  for (const part of rules.split(/([{}])/)) {
    if (part === "{") {
      const inside = stack.includes(true);
      const isGuard = stack.length === 0 && pending.trim().startsWith(GUARD);
      if (isGuard) guardSeen = true;
      stack.push(inside || isGuard);
      pending = "";
    } else if (part === "}") {
      stack.pop();
      pending = "";
    } else {
      pending += part;
      if (/\banimation\b|\btransition\b/.test(part) && !stack.includes(true)) {
        problems.push(`an animation outside the reduced-motion gate: ${part.trim()}`);
      }
    }
  }
  if (!guardSeen) {
    problems.push("the reduced-motion gate is missing: no no-preference block exists");
  }
  return problems;
}

/** The check over the surfaces' own stylesheet. */
export function checkSurfacesCss() {
  const css = readFileSync(
    new URL("../chat/src/surfaces/surfaces.css", import.meta.url),
    "utf8",
  );
  return motionCssProblems(css);
}
