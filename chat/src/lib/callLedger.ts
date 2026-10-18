import type { BrowserCode } from "./browser/codes";
import { isBrowserCode, isDeterministic } from "./browser/codes";
import { BROWSER_NAMES } from "./tools/browserTools";

/**
 * What one turn already did, and what it already failed at.
 *
 * **A ledger, not a retry.** Nothing here runs anything: it decides whether the
 * loop should ask the browser at all. That is the whole point — a model that
 * clicks the same dead element six times is not thinking, and a second click on
 * the same failure is not an attempt but a loop. So the answer is refused with
 * the code, and the model is told the code is what decides it.
 *
 * **A round is a page, roughly.** An answer is reusable only inside the round
 * that produced it: a read is a fact about the page as it was, and one word
 * typed, one button pressed or one address opened makes it a fact about a page
 * that no longer exists. Every call that can move the page opens the next
 * round, and everything remembered so far goes with the one before it.
 */
export interface Ledger {
  /** The action that ran in **this** round, and the answer it got. */
  ran: Map<string, string>;
  /** The action that failed with a deterministic code. */
  failed: Map<string, BrowserCode>;
  /** Which round this is: every call that can move the page opens the next. */
  round: number;
  /** How many browser calls have run this turn, across every round. */
  spent: number;
}

/**
 * How many browser calls one turn may run. Past this the rest are refused: a
 * turn that spends its whole budget on the browser has nothing left to answer
 * with. It is a bound and not a plan — an ordinary form is an open, a read and
 * three types and a click, and a bound that refuses that is not a bound but a
 * bug wearing one.
 */
export const BROWSER_CALLS_PER_TURN = 24;

/**
 * The calls that can leave the page different from how they found it. **Every
 * one of these opens a new round**: an element reference is only good on the
 * page it was read from, so nothing read before one of them can be reused
 * after it.
 */
const MOVES = new Set(["browser_open", "browser_click", "browser_type"]);

/**
 * What a call is, as far as "have I already done this" is concerned.
 *
 * **Normalized, so that the same action wears the same key however it was
 * written**: an element reference trimmed, words kept whole because a space is
 * something a person wrote into a field. Keys are built from sorted names, so
 * the order the model wrote the properties in cannot make two calls look
 * different. The fragment stays in the open's key: it is part of the address
 * the model asked for, and dropping it would call a page and an anchor on it
 * the same action.
 */
export function actionKey(name: string, args: Record<string, unknown>): string {
  const parts: Record<string, string> = {};
  if (name === "browser_open" && typeof args.url === "string") parts.url = args.url.trim();
  if (name === "browser_click" && typeof args.ref === "string") parts.ref = args.ref.trim();
  if (name === "browser_type") {
    if (typeof args.ref === "string") parts.ref = args.ref.trim();
    // The text is not trimmed: a leading space is a keystroke.
    if (typeof args.text === "string") parts.text = args.text;
  }
  if (name === "browser_find" && typeof args.text === "string") parts.text = args.text.trim();
  if (name === "browser_read") parts.page = String(args.page === undefined ? 1 : args.page);
  const sorted = Object.keys(parts)
    .sort()
    .map((key) => `${key}=${parts[key]}`)
    .join("&");
  return `${name}(${sorted})`;
}

/** What the loop should do with one call, before anything is asked. */
export type LedgerVerdict =
  | { run: true }
  /** Already run in this round: the answer it got is the answer, again. */
  | { run: false; code: BrowserCode; answer: string }
  /** Refused, with the code the browser would have refused it with anyway. */
  | { run: false; code: BrowserCode; answer: null };

/**
 * One call against the ledger.
 *
 * **No automatic retry, of any kind.** A key that failed with a deterministic
 * code is not run again for the rest of the turn: the same action on the same
 * page fails the same way, and the model is told so in as many words as it takes
 * to stop asking. A key that ran in **this** round is answered from what it
 * got, because asking twice is a loop in the making; one that ran in an earlier
 * round is run again, because the page moved in between and the old answer is
 * no longer true of it.
 */
export function decide(ledger: Ledger, name: string, args: Record<string, unknown>): LedgerVerdict {
  const key = actionKey(name, args);
  const ran = ledger.ran.get(key);
  if (ran !== undefined) return { run: false, code: "browser.already_run", answer: ran };
  const failed = ledger.failed.get(key);
  if (failed !== undefined) {
    return { run: false, code: "browser.deterministic", answer: null };
  }
  if (ledger.spent >= BROWSER_CALLS_PER_TURN) return { run: false, code: "browser.too_many_steps", answer: null };
  return { run: true };
}

/** What one call left behind: the answer the model reads, and the code if it
    was a refusal. A key that ran after failing has worked, so its old failure
    goes with it — a stale refusal would deny an attempt that has just succeeded.
    A call that can move the page opens the next round **before** it is filed,
    so what it answered is remembered against the page it left behind and the
    turn it begins is the one a second identical call belongs to. */
function record(ledger: Ledger, name: string, args: Record<string, unknown>, answer: string, code?: BrowserCode): void {
  if (MOVES.has(name)) openedNextRound(ledger);
  const key = actionKey(name, args);
  ledger.ran.set(key, answer);
  if (code === undefined) ledger.failed.delete(key);
  else {
    ledger.ran.delete(key);
    ledger.failed.set(key, code);
  }
}

/**
 * What one tool call left behind.
 *
 * **Not a browser tool is not filed at all**: the ledger is the browser's, and a
 * web search that failed has nothing to do with an element reference.
 *
 * **Only a call that reached the browser spends anything.** A refusal carrying
 * no browser code never got that far — the switch was off, the person paused,
 * the turn has spent its budget — so it is not a step towards the bound and it
 * does not stand in the way of the attempt once its reason is gone.
 *
 * **Only a code worth remembering is remembered.** The same element fails the
 * same way, so that one is dead for the turn; a browser that was busy for one
 * call will not be busy for the next, so that one only spends its step and is
 * allowed to happen again.
 */
export function filed(
  ledger: Ledger,
  name: string,
  args: Record<string, unknown>,
  outcome: { text: string; ok: boolean; resultCode?: string },
): void {
  if (!BROWSER_NAMES.has(name)) return;
  if (outcome.ok) {
    ledger.spent += 1;
    record(ledger, name, args, outcome.text);
    return;
  }
  const code = outcome.resultCode;
  if (!isBrowserCode(code)) return;
  // It spent its step — the browser was asked and said no — but it **did not
  // run**, so there is no answer to reuse and nothing to call dead: a refusal
  // that can differ next time is allowed to happen again.
  ledger.spent += 1;
  if (isDeterministic(code)) record(ledger, name, args, outcome.text, code);
}

/** A call that can leave the page different opens the next round, and what the
    last one read no longer says anything about it: the answers go, and the
    failures go with them, because a reference that has stopped working is not
    evidence that the page is broken. */
function openedNextRound(ledger: Ledger): void {
  ledger.round += 1;
  ledger.ran.clear();
  ledger.failed.clear();
}

export function newLedger(): Ledger {
  return { ran: new Map(), failed: new Map(), round: 0, spent: 0 };
}