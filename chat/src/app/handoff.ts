/**
 * The writing bar becoming the first message of the conversation, by hand.
 *
 * This used to be `document.startViewTransition` with a shared
 * `view-transition-name` on the bar and on the destination bubble, and on the
 * owner's machine the move simply never happened. Every piece was wired and the
 * effect was absent, and there is no way into that WKWebView to look — a day
 * went by with nothing to say but "it looks correct". The technique was the
 * problem: view-transition pseudo-elements cannot be inspected from a test.
 *
 * A FLIP is ordinary DOM. The bar's rectangle is measured before the state
 * change, the bubble's after it, and an element carrying the message is animated
 * from one to the other with the Web Animations API. `getAnimations()` reports
 * the duration and the keyframes, which is the whole reason for the change.
 *
 * What it animates is the **box**: left, top, width and height, from the bar's
 * rectangle to the bubble's. The first version animated a `transform: scale`,
 * and the rectangles make that anisotropic — measured at `scale(0.29, 1.94)`,
 * one third as wide and twice as tall — so the glyphs were squeezed and
 * stretched the whole way across. At 240 ms that flashed past; at 450 ms it
 * would sit on the screen looking broken. The text here keeps its size and
 * reflows inside the box the whole way: readable beats clever, and this is one
 * element for half a second.
 *
 * Nothing else on the screen moves: the mover is a single fixed element that is
 * removed when it lands. Under `prefers-reduced-motion` the caller does not call
 * this at all.
 */

/** How long the bar takes to become the message. One constant, in one place. */
export const HANDOFF_MS = 450;

/** How a test finds the moving element while it is in flight. */
export const HANDOFF_ATTRIBUTE = "data-brain-handoff";
/** The room that is leaving, and the one arriving: the move is the whole
    screen changing, with the bar's flight as part of it. */
export const LEAVING_ATTRIBUTE = "data-brain-leaving";
export const ARRIVING_ATTRIBUTE = "data-brain-arriving";

/** The distance the rooms travel while they cross: a room changing, not a
    slideshow. Small enough to read as one movement with the bar. */
const ROOM_SHIFT_PX = 6;

/**
 * The screen that is here now, photographed so it can leave while the next one
 * arrives. The real content is unmounted by the state change, so its motion has
 * to travel on a copy: one element over the stage, fading out and rising a few
 * pixels, gone when the move is over.
 */
export function leavingGhost(stage: Element | null): Animation | null {
  if (!stage) return null;
  const rect = stage.getBoundingClientRect();
  const ghost = document.createElement("div");
  ghost.setAttribute(LEAVING_ATTRIBUTE, "");
  ghost.setAttribute("aria-hidden", "true");
  ghost.append(...[...stage.childNodes].map((node) => node.cloneNode(true)));
  Object.assign(ghost.style, {
    position: "fixed",
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    overflow: "hidden",
    background: "var(--page)",
    zIndex: "30",
    pointerEvents: "none",
  });
  document.body.append(ghost);
  const animation = ghost.animate(
    [
      { opacity: 1, transform: "translateY(0px)" },
      { opacity: 0, transform: `translateY(-${ROOM_SHIFT_PX}px)` },
    ],
    { duration: HANDOFF_MS, easing: "cubic-bezier(0.2, 0, 0, 1)", fill: "forwards" },
  );
  const remove = () => ghost.remove();
  animation.finished.then(remove, remove);
  return animation;
}

/**
 * The screen that is arriving: it comes in over the same beat, from a few pixels
 * down and from nothing, so it reads as the room the bar flew into rather than
 * as a cut with an animation on top. Its own styles stand when the move ends.
 */
export function arrivingIn(element: Element | null): Animation | null {
  if (!element) return null;
  element.setAttribute(ARRIVING_ATTRIBUTE, "");
  return element.animate(
    [
      { opacity: 0, transform: `translateY(${ROOM_SHIFT_PX}px)` },
      { opacity: 1, transform: "translateY(0px)" },
    ],
    { duration: HANDOFF_MS, easing: "cubic-bezier(0.2, 0, 0, 1)" },
  );
}

/**
 * Fly `before` (the bar's rectangle) onto `bubble`, carrying its text, and take
 * the mover away when it lands. Returns the animation, so a caller may await it;
 * `null` when there is nothing to fly from or to.
 */
export function handoff(before: DOMRect | null, bubble: HTMLElement | null): Animation | null {
  if (!before || !bubble || before.width === 0 || before.height === 0) return null;
  const after = bubble.getBoundingClientRect();

  const mover = document.createElement("div");
  mover.className = "user-bubble";
  mover.setAttribute(HANDOFF_ATTRIBUTE, "");
  mover.setAttribute("aria-hidden", "true");
  mover.textContent = bubble.textContent ?? "";
  // The base layout is the bar's rectangle; the animation travels from it to
  // the bubble's, so `mover.style` is where the move starts.
  // Plain geometry, so the landing rectangle (measured, not a DOMRect) fits the
  // same shape as the bar's.
  const box = (rect: { left: number; top: number; width: number; height: number }) => ({
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
  Object.assign(mover.style, { position: "fixed", ...box(before) });
  document.body.append(mover);

  // The height at the destination comes from the mover's own layout, not from
  // the bubble's rectangle: the thread's rows are `content-visibility: auto`,
  // so a row that has not painted yet reports its 120px intrinsic placeholder
  // rather than its height. Same class, same text, same width — this is the
  // height the bubble takes too.
  mover.style.width = `${after.width}px`;
  mover.style.height = "auto";
  const landingHeight = mover.getBoundingClientRect().height;
  mover.style.width = `${before.width}px`;
  mover.style.height = `${before.height}px`;
  const lands = { left: after.left, top: after.top, width: after.width, height: landingHeight };

  const animation = mover.animate([box(before), box(lands)], {
    duration: HANDOFF_MS,
    easing: "cubic-bezier(0.2, 0, 0, 1)",
    fill: "forwards",
  });
  const remove = () => mover.remove();
  animation.finished.then(remove, remove);
  return animation;
}
