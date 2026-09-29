// The Devices page's own motion numbers and its one motion read. The two
// tempos the page must time live here and nowhere else: FOLD_MS drives the
// fold-out timer and, as the page root's --beat-unfold-ms variable, the
// entrance that is its reverse; BEAT_MS drives the connected hold's timer
// and, as --beat-ms, the loops (the waiting breath, the live pulse). The
// CSS-only beats — the check's draw, the connecting dots' stagger — keep
// their own variables beside the keyframes in surfaces.css.

// How long a forgotten row takes to fold out of the list before it leaves
// it, and how long a row that arrives takes to unfold in. One number: it
// times both CSS animations and the timers that end them, so the box and
// the beat cannot drift apart.
export const FOLD_MS = 450;

// The page's one tempo: how long a row the owner just allowed holds its
// "is connected." beat, and how long the loops take a breath.
export const BEAT_MS = 1600;

// The same read App.tsx makes: under reduced motion nothing is animated, so
// a forgotten row is simply gone — which is how it always went.
export function reducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
