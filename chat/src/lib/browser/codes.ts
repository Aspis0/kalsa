/**
 * The closed set of codes a browser call can come back with, and the words the
 * person reads for each.
 *
 * **A code is what the screen and the ledger read; a sentence is what the model
 * reads.** They are never the same thing, because a sentence is prose in five
 * languages and a code is one word. Copy is looked up by code and by nothing
 * else, so a refusal that arrives with words nobody here wrote cannot become a
 * line on the window — and an unknown word from anywhere is not shown at all.
 *
 * **The sidecar's half is `src-tauri/src/browser/codes.rs`, word for word**, and
 * the app's own codes ride the same union because a screen reads one set: a
 * failure to reach the browser, a busy slot and a Stop are `BrowserError`'s on
 * the Rust side and live here beside the sidecar's, so the two lists can be
 * compared. One of the two drifting is how a person ends up reading a code.
 */
export const BROWSER_CODES = [
  /** The person closed the browser's own window. */
  "browser.window_gone",
  /** The browser would not do it, and named no reason this build knows. */
  "browser.refused",
  /** The browser could not be asked at all. Nothing is known about it. */
  "browser.failed",
  /** There is no page there to read, and none was opened first. */
  "browser.no_page",
  /** The element named is not on the page any more. */
  "browser.element_gone",
  /** The field named is not on the page any more. */
  "browser.field_gone",
  /** The write is held and is waiting for the person. Nothing was sent. */
  "browser.held",
  /** A rule the page itself sets would not let the form go. Nothing was sent. */
  "browser.invalid",
  /** The person pressed Pausa: nothing more is done until they say otherwise. */
  "browser.paused",
  /** Kalsa is busy with the browser. */
  "browser.busy",
  /** The request is not waiting for an answer any more: the card was already
      spent, so nothing was sent and there is nothing to be unclear about. */
  "browser.no_pending_request",
  /** The person pressed Stop while it was running. Nothing it was doing is retried. */
  "browser.stopped",
  /** The same action already failed with this code: running it again would fail the same way. */
  "browser.deterministic",
  /** Too many browser calls in one turn. The rest are not run. */
  "browser.too_many_steps",
  /** Kalsa has already run this exact action in this round. */
  "browser.already_run",
  /** The read asked for a window of the page the model has already been given. */
  "browser.read_again",
] as const;

/** One of `BROWSER_CODES`, and nothing else. */
export type BrowserCode = (typeof BROWSER_CODES)[number];

/**
 * The code the provenance rule refuses an address with when the conversation
 * never carried it. **It is the web's own code and not one of the browser's**:
 * the rule is the same for a fetch and for an open, and the page reads it as
 * "this link was never seen". The ledger remembers it anyway, because a second
 * identical open would be refused the same way.
 */
export const LINK_UNSEEN = "web.link_unseen";

/**
 * A code a browser call can be refused with that the ledger keeps: the
 * browser's own, and the provenance rule's. **The two are one union** because
 * the ledger's job is the same for both — a call that was refused must not be
 * asked again in the same turn, whatever refused it.
 */
export type RefusalCode = BrowserCode | typeof LINK_UNSEEN;

/** Whether a word from the wire is one the ledger keeps. */
export function isRefusalCode(code: unknown): code is RefusalCode {
  return isBrowserCode(code) || code === LINK_UNSEEN;
}

/** Whether a word from the wire is one of ours. **Anything else is not shown**:
    it becomes `browser.refused`, which is a fact about it rather than a guess. */
export function browserCode(code: unknown): BrowserCode {
  return typeof code === "string" && isBrowserCode(code) ? code : "browser.refused";
}

/**
 * Whether a word is one of ours, unchanged — as `browserCode` would pass it.
 *
 * **For the boundary where nothing else is left to catch it**: a `resultCode`
 * read back out of `localStorage` is whatever was last written there, and the
 * window words itself by it, so a name nobody here wrote must not survive the
 * round trip.
 */
export function isBrowserCode(code: unknown): code is BrowserCode {
  return typeof code === "string" && (BROWSER_CODES as readonly string[]).includes(code);
}

/**
 * The words the person reads for a code, from the language table beside it.
 *
 * **Never the sentence the tool carried.** That is prose in whatever language a
 * page or a model wrote it in, and the window is not where a stranger's words go.
 */
export function browserCodeWords(
  code: BrowserCode,
  t: { windowGone: string; refused: string; failed: string; noPage: string; elementGone: string; fieldGone: string; held: string; invalid: string; paused: string; busy: string; noPendingRequest: string; stopped: string; deterministic: string; tooManySteps: string; alreadyRun: string; readAgain: string },
): string {
  const words: Record<BrowserCode, string> = {
    "browser.window_gone": t.windowGone,
    "browser.refused": t.refused,
    "browser.failed": t.failed,
    "browser.no_page": t.noPage,
    "browser.element_gone": t.elementGone,
    "browser.field_gone": t.fieldGone,
    "browser.held": t.held,
    "browser.invalid": t.invalid,
    "browser.paused": t.paused,
    "browser.busy": t.busy,
    "browser.no_pending_request": t.noPendingRequest,
    "browser.stopped": t.stopped,
    "browser.deterministic": t.deterministic,
    "browser.too_many_steps": t.tooManySteps,
    "browser.already_run": t.alreadyRun,
    "browser.read_again": t.readAgain,
  };
  return words[code];
}

/**
 * Whether a press that came back with this code never went anywhere.
 *
 * **The family of the press that never left.** The browser was busy, so nothing
 * was sent; or the request was not waiting for an answer any more, so nothing
 * was sent either. Both are the same thing to the person and to the model: the
 * card comes back as it was, no outcome is queued, and the model is told
 * nothing about a request that never left.
 *
 * **The card that was already answered is here, and not in the refusals.** The
 * sidecar spends the id before it dispatches, so a press for a card that is
 * gone finds nothing to press about — and a refusal that leaves an outcome
 * behind would tell the model that a request it cannot account for went
 * somewhere, when nothing went anywhere at all.
 *
 * **These are the two codes the sidecar's own rule names.** `leaves_an_outcome`
 * in `src-tauri/src/browser/confirm.rs` is false for the busy browser and for
 * the card that was already answered: a code that leaves no outcome there must
 * leave none here, or the model is told about a request that never went.
 */
export function isPressThatNeverLeft(code: BrowserCode): boolean {
  return code === "browser.busy" || code === "browser.no_pending_request";
}

/**
 * Whether this press found a card that was already resolved somewhere else.
 *
 * **The other half of the family of the press that never left.** The browser was
 * busy, so nothing was sent; or the request was not waiting for an answer any
 * more, so nothing was sent either. Both leave the request unsent, and neither
 * queues an outcome — but **they are not the same thing to the window**: a busy
 * browser gives the card back, because the card is still the person's to press,
 * and a card that was resolved elsewhere is closed for good, because there is
 * nothing left to press about it.
 *
 * **The same list the sidecar's own rule names.** `leaves_an_outcome` in
 * `src-tauri/src/browser/confirm.rs` is false for the busy browser and for the
 * card that was already answered, and the card that is gone is the one the
 * sidecar has already taken off its own table.
 */
export function isCardAlreadyResolved(code: BrowserCode): boolean {
  return code === "browser.no_pending_request";
}

/** Whether the same action with this code is worth running again. **A code the
    browser itself owns is deterministic by definition** — the same address, the
    same element, the same failure — so it is not tried twice in one turn. The
    codes that can differ on a second try are the ones Kalsa raised herself:
    she was busy, the person paused, the page had not been opened yet. **The
    provenance rule's code is deterministic too**: the same address will be
    refused the same way, and a model that tries it again is told to click
    the ref instead.

    **The sidecar's own refusals are deterministic as well, and they stay so.**
    They all answer `browser.refused` — the sidecar names no code of its own —
    and among them are the refusals that are truly a decision about the page: an
    element the page never printed, an address the conversation never saw. Those
    fail the same way the second time.

    **What is worth another try is decided by the stage, not by the code.** A
    read the driver did not answer is not a decision about the page, and the
    ledger knows which stage stopped the call; see `callLedger.ts`. */
export function isDeterministic(code: RefusalCode): boolean {
  return code !== "browser.busy" && code !== "browser.paused" && code !== "browser.stopped";
}