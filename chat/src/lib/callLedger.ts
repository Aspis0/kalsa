import type { BrowserCode, RefusalCode } from "./browser/codes";
import { isDeterministic, isRefusalCode } from "./browser/codes";
import { BROWSER_NAMES } from "./tools/browserTools";

/** Bound browser work and suppress repeated actions; observations stay fresh
 * because the page can change on its own. */
export interface Ledger {
  /** The action that ran in **this** round, and the answer it got. */
  ran: Map<string, string>;
  /** The action that failed with a deterministic code. */
  failed: Map<string, RefusalCode>;
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

/** The calls that only look at the page. A read may be asked again, because the
    page changes on its own and the last answer is not the answer now. */
const LOOKS = new Set(["browser_read", "browser_find"]);

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
  | { run: false; code: BrowserCode; answer: string; said: BrowserCode }
  /** Refused, with the code the browser would have refused it with anyway.
   *  `said` is the reason the call failed the first time: **the page reads
   *  `code`, the model reads `said`** — the code is one word, and the reason is
   *  the sentence the model can act on. */
  | { run: false; code: BrowserCode; answer: null; said: RefusalCode };

/** Explicit observations may run again; actions retain their duplicate guard. */
export function decide(ledger: Ledger, name: string, args: Record<string, unknown>): LedgerVerdict {
  if (LOOKS.has(name)) {
    // A read spends a step and runs: the page it reads is the page now.
    if (ledger.spent >= BROWSER_CALLS_PER_TURN) {
      return { run: false, code: "browser.too_many_steps", answer: null, said: "browser.too_many_steps" };
    }
    return { run: true };
  }
  const key = actionKey(name, args);
  // A key that ran in this round is answered from what it got: asking twice is
  // a loop in the making.
  const ran = ledger.ran.get(key);
  if (ran !== undefined) {
    return { run: false, code: "browser.already_run", answer: ran, said: "browser.already_run" };
  }
  const failed = ledger.failed.get(key);
  if (failed !== undefined) {
    // A deterministic action failure stays suppressed until another action
    // opens a new round. **The reason it failed travels with the refusal**,
    // so the model is told what happened the first time and not "it failed
    // again".
    return { run: false, code: "browser.deterministic", answer: null, said: failed };
  }
  if (ledger.spent >= BROWSER_CALLS_PER_TURN) {
    return { run: false, code: "browser.too_many_steps", answer: null, said: "browser.too_many_steps" };
  }
  return { run: true };
}

/** What one call left behind: the answer the model reads, and the code if it
    was a refusal. A key that ran after failing has worked, so its old failure
    goes with it — a stale refusal would deny an attempt that has just succeeded.
    A call that can move the page opens the next round **before** it is filed,
    so what it answered is remembered against the page it left behind and the
    turn it begins is the one a second identical call belongs to. */
function record(ledger: Ledger, name: string, args: Record<string, unknown>, answer: string, code?: RefusalCode): void {
  if (MOVES.has(name)) openedNextRound(ledger);
  const key = actionKey(name, args);
  ledger.ran.set(key, answer);
  if (code === undefined) ledger.failed.delete(key);
  else {
    ledger.ran.delete(key);
    ledger.failed.set(key, code);
  }
}

/** Charge browser work, including refusals, without caching observations. */
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
  // **A refusal the browser raised and a refusal the provenance rule raised are
  // both a step the turn spent.** The rule's own code (`web.link_unseen`) is not
  // one of the browser's, and it used to be dropped here: the model could ask
  // for the same unseen address as many times as it liked, and every refusal
  // cost it nothing. It costs a step now, and the key is remembered — so the
  // second refusal of the same address is the one that says "click its ref".
  if (!isRefusalCode(code)) return;
  // It spent its step — the browser was asked and said no — but it **did not
  // run**, so there is no answer to reuse and nothing to call dead: a refusal
  // that can differ next time is allowed to happen again.
  ledger.spent += 1;
  // **The ledger's own refusal does not overwrite the reason.** A call that
  // failed for one reason and is refused again for that same reason keeps
  // saying it: "you already asked, and it failed with web.link_unseen — click
  // its ref" is a sentence the model can act on, and "browser.deterministic"
  // is a word it cannot.
  if (code === "browser.deterministic") return;
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