/**
 * This page's visibility, one source for the app's bargains with a hidden
 * window: the clock below slows and reads once on return, and the root
 * attribute pauses the CSS that would otherwise keep a compositor awake with
 * nobody looking.
 */

const HIDDEN_ATTRIBUTE = "data-hidden";

/** The period every clock below uses while the window is hidden. Slower to
    spare the battery, never stopped: `brain_state` raises the phone's door
    and the Devices read is the pairing square's own clock, so a hidden window
    must still come around. */
const HIDDEN_INTERVAL_MS = 15000;

function isPageVisible(): boolean {
  return typeof document === "undefined" || !document.hidden;
}

function reflect(): void {
  if (typeof document === "undefined") return;
  if (document.hidden) document.documentElement.setAttribute(HIDDEN_ATTRIBUTE, "");
  else document.documentElement.removeAttribute(HIDDEN_ATTRIBUTE);
}

/** Reflects visibility into the root element and keeps it current. The app
    calls this once at start; the attribute is the only thing the CSS reads. */
export function watchPageVisibility(): void {
  if (typeof document === "undefined") return;
  reflect();
  document.addEventListener("visibilitychange", reflect);
}

/** Runs `tick` every `ms` while the page is showing and every
    `HIDDEN_INTERVAL_MS` while it is hidden; coming back runs `tick` once at
    once — the screen is never stale on return — then arms the visible period
    again. Returns the stop. A process with no `document` — the Node harnesses
    — counts as visible: there is no window to spare. */
export function visibleInterval(tick: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = (): void => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };
  const arm = (): void => {
    stop();
    timer = setInterval(tick, isPageVisible() ? ms : HIDDEN_INTERVAL_MS);
  };
  if (typeof document === "undefined") {
    arm();
    return stop;
  }
  const onVisibilityChange = (): void => {
    stop();
    // Back in sight: one read at once, then the period the page can afford.
    if (!document.hidden) tick();
    arm();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  arm();
  return () => {
    stop();
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}
