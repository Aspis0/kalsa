// The Devices page's own motion numbers and its one motion read. Every
// JS-timed beat lives here; the CSS-only beats (the rows' loops) read the
// `--beat-*` variables at the top of surfaces.css.

// How long a forgotten row takes to fold out of the list before it leaves
// it. One number: it times both the CSS the row animates with and the timer
// that removes it, so the box and the beat cannot drift apart.
export const FOLD_MS = 450;

// The same read App.tsx makes: under reduced motion nothing is animated, so
// a forgotten row is simply gone — which is how it always went.
export function reducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
