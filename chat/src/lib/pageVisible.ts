/**
 * This page's visibility, one source for the app's bargains with a hidden
 * window: the clock below slows and reads once on return, and the root
 * attribute pauses the CSS that would otherwise keep a compositor awake with
 * nobody looking.
 */

import { available, invoke, listen } from "./tauri";

const HIDDEN_ATTRIBUTE = "data-hidden";

/** The backend's word on the window being out of sight, and the event that
    carries it. A minimized WebView2 window keeps `document.hidden` false on
    Windows, so this flag is the only witness of an icon there. */
const WINDOW_SHOWN_EVENT = "window-shown";
let windowHidden = false;

/** The period every clock below uses while the window is hidden. Slower to
    spare the battery, never stopped: `brain_state` raises the phone's door
    and the Devices read is the pairing square's own clock, so a hidden window
    must still come around. */
const HIDDEN_INTERVAL_MS = 15000;

/** Whether the page is hidden: the page's own answer OR the backend's.
    A process with no `document` — the Node harnesses — counts as visible:
    there is no window to spare. */
function pageHidden(): boolean {
  return typeof document !== "undefined" && (document.hidden || windowHidden);
}

/** True while the page may be worked for. A process with no `document` — the
    Node harnesses — counts as visible: there is no window to spare. */
export function isPageVisible(): boolean {
  return !pageHidden();
}

function reflect(): void {
  if (typeof document === "undefined") return;
  if (pageHidden()) document.documentElement.setAttribute(HIDDEN_ATTRIBUTE, "");
  else document.documentElement.removeAttribute(HIDDEN_ATTRIBUTE);
}

type Change = () => void;
const changes = new Set<Change>();
let listening = false;
let lastHidden = false;

/** The one place a change of visibility is noticed, from either source. The
    combined state is what counts, so a platform firing both — macOS reports a
    minimize as `visibilitychange` too — is still one change: the return read
    must not run twice for one restoration. */
function announce(): void {
  const hidden = pageHidden();
  if (hidden === lastHidden) return;
  lastHidden = hidden;
  reflect();
  for (const change of [...changes]) change();
}

/** The window's state as the backend answers it now. The read a reload needs:
    the page starts with no history of the events it missed. */
function askWindowState(): void {
  if (!available()) return;
  void invoke<boolean>("window_hidden")
    .then((hidden) => {
      windowHidden = hidden === true;
      announce();
    })
    // A binary without the command leaves the events' word alone: this read
    // is an improvement, not something the clocks below rest on.
    .catch(() => {});
}

/** Subscribes the two sources once. The backend's listener is a cheap no-op
    outside the webview (`lib/tauri`), so a browser sees only the page's own
    event. */
function keepListening(): void {
  if (listening || typeof document === "undefined") return;
  listening = true;
  lastHidden = pageHidden();
  document.addEventListener("visibilitychange", announce);
  // The read waits for the subscription: a change landing between the two
  // would otherwise be reported by neither. A subscription that never lands
  // costs the read alone — the page keeps the events it has.
  void listen(WINDOW_SHOWN_EVENT, (payload) => {
    const carried = (payload ?? {}) as { hidden?: unknown };
    windowHidden = carried.hidden === true;
    announce();
  })
    .then(askWindowState)
    .catch(() => {});
}

/** Reflects visibility into the root element and keeps it current. The app
    calls this once at start; the attribute is the only thing the CSS reads. */
export function watchPageVisibility(): void {
  if (typeof document === "undefined") return;
  keepListening();
  reflect();
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
    timer = setInterval(tick, pageHidden() ? HIDDEN_INTERVAL_MS : ms);
  };
  if (typeof document === "undefined") {
    arm();
    return stop;
  }
  const onVisibilityChange = (): void => {
    stop();
    // Back in sight: one read at once, then the period the page can afford.
    if (!pageHidden()) tick();
    arm();
  };
  keepListening();
  changes.add(onVisibilityChange);
  arm();
  return () => {
    stop();
    changes.delete(onVisibilityChange);
  };
}
