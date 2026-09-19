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
 * from one to the other with the Web Animations API: its layout is the bar's
 * rectangle, its keyframes are the difference, and `getAnimations()` reports the
 * duration. All three are things a harness can assert, which is the whole reason
 * for the change.
 *
 * Nothing else on the screen moves: the mover is a single fixed element that is
 * removed when it lands. Under `prefers-reduced-motion` the caller does not call
 * this at all.
 */

/** How long the bar takes to become the message. One constant, in one place. */
export const HANDOFF_MS = 240;

/** How a test finds the moving element while it is in flight. */
export const HANDOFF_ATTRIBUTE = "data-brain-handoff";

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
  // Its layout is the bar's rectangle; the transform carries the difference,
  // scaled so the mover arrives the size of the bubble.
  Object.assign(mover.style, {
    position: "fixed",
    left: `${before.left}px`,
    top: `${before.top}px`,
    width: `${before.width}px`,
    height: `${before.height}px`,
    transformOrigin: "top left",
  });
  document.body.append(mover);

  const animation = mover.animate(
    [
      { transform: "translate(0px, 0px) scale(1, 1)" },
      {
        transform:
          `translate(${after.left - before.left}px, ${after.top - before.top}px) ` +
          `scale(${after.width / before.width}, ${after.height / before.height})`,
      },
    ],
    { duration: HANDOFF_MS, easing: "cubic-bezier(0.2, 0, 0, 1)", fill: "forwards" },
  );
  const remove = () => mover.remove();
  animation.finished.then(remove, remove);
  return animation;
}
