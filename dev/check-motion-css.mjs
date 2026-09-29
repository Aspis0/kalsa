// The reduced-motion gate, checked where the fake DOM cannot look. Scope,
// exactly: every animation and transition DECLARED IN A STYLESHEET UNDER
// chat/src/surfaces/ must live inside that file's
// `@media (prefers-reduced-motion: no-preference)` block, and the block
// must exist. Not covered: stylesheets elsewhere in the app (Thread.css,
// Sidebar.css and the other component sheets), and transitions the pages
// declare in JS — the row fold's inline transition, which motion.ts gates
// with its own reduced-motion read. Run by dev/smoke-react.mjs; exits
// through its problem list.
import { readdirSync, readFileSync } from "node:fs";

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
  let animated = false;
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
      if (/\banimation\b|\btransition\b/.test(part)) {
        animated = true;
        if (!stack.includes(true)) {
          problems.push(`an animation outside the reduced-motion gate: ${part.trim()}`);
        }
      }
    }
  }
  // A file that animates nothing needs no gate; one that does needs one.
  if (animated && !guardSeen) {
    problems.push("the reduced-motion gate is missing: no no-preference block exists");
  }
  return problems;
}

/** The check over every stylesheet the surfaces carry, each named. */
export function checkSurfacesCss() {
  const dir = new URL("../chat/src/surfaces/", import.meta.url);
  const problems = [];
  for (const name of readdirSync(dir).filter((file) => file.endsWith(".css")).sort()) {
    for (const problem of motionCssProblems(readFileSync(new URL(name, dir), "utf8"))) {
      problems.push(`${name}: ${problem}`);
    }
  }
  return problems;
}
