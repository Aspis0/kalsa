import { publicHttpUrl } from "../publicUrl";
import type { Outcome } from "./confirm";
import type { ToolRun } from "../types";
import { TOOL_STOPPED } from "../types";
import type { English } from "../../i18n/en/all";

/** The words for the line, taken from the language table so the five tables
    and the record cannot come from different places. */
export type RecapWords = English["tools"]["recap"];

/**
 * What Kalsa did in a turn, as counts.
 *
 * **Not a sentence.** The words are built at the moment the line is drawn, in
 * the language the person is reading in, and a record that carried its own
 * prose would have to be rewritten for every language a chat is ever read in.
 * So this is the facts, and one closed shape: a field per thing that can have
 * happened, and a count of nothing for everything else.
 *
 * **It cannot be false, because every fact in it is a run that happened.** No
 * page state is read and nothing is promised: a form filled and left alone says
 * "written into N fields" and no send, and that is the truth.
 *
 * **The host is one field the disk does not keep.** An address is something the
 * model wrote and a page wrote the rest of, and `store.ts` strips it here as it
 * strips a run's arguments — a reloaded chat says "a site" and says nothing
 * false about it.
 */
export interface Recap {
  /** How many pages were opened. */
  opened: number;
  /** The host an open was asked for, "" when the answer never said where it
      landed — which is every open today: the sidecar names no address, so the
      line asks for one rather than claiming to have reached it. */
  asked: string;
  /** Distinct fields written into, each one that took the words. */
  typed: number;
  /** Clicks that came back answered. */
  clicked: number;
  /** A click was asked for at all, whatever became of it: a click that failed
      is a click the owner was told nothing about unless this says it. */
  tried: boolean;
  /** A click was begun and cut short: it may still have reached the page. */
  clickInterrupted: boolean;
  /** Requests on the window right now, waiting for the person. */
  waiting: number;
  /** What became of the requests that were answered, one count per code: a
      mixed answer shows every kind in it, because "sent" alone would be a lie
      over "sent and one refused". */
  sent: number;
  declined: number;
  expired: number;
  gone: number;
  unsendable: number;
  unclear: number;
  /** Where the sent ones went, so the line can name up to two and count the
      rest rather than reading a list nobody would read. */
  sentTo: string[];
  /** The person stopped this turn. */
  stopped: boolean;
}

/**
 * What a turn did, read from its own runs and from what has become of its
 * requests. `null` when there is nothing at all to say.
 *
 * **Nothing here reads the page.** The runs are what the app ran and the
 * outcomes are what the person pressed, and that is the whole record.
 */
export function recapOf(runs: ToolRun[], outcomes: Outcome[], waiting: number): Recap | null {
  const opened = runs.filter((run) => run.name === "browser_open" && run.state === "ok");
  const typed = distinctRefs(runs.filter((run) => run.name === "browser_type" && run.state === "ok"));
  const clicked = runs.filter((run) => run.name === "browser_click" && run.state === "ok");
  // **A click that was cut short is its own fact.** The sidecar may have
  // pressed the button before the session was ended, and an owner told "no
  // click" by a turn that began one is being told the opposite of what
  // happened. So it says what it can stand behind: the click was interrupted.
  const clickInterrupted = runs.some((run) => run.name === "browser_click" && run.result === TOOL_STOPPED);
  const wanted = opened.map((run) => hostOf(run.arguments)).filter((one): one is string => one !== null);
  const recap: Recap = {
    opened: opened.length,
    asked: wanted.length === 0 ? "" : wanted[wanted.length - 1],
    typed: typed.size,
    clicked: clicked.length,
    tried: runs.some((run) => run.name === "browser_click"),
    clickInterrupted,
    waiting,
    sent: 0,
    declined: 0,
    expired: 0,
    gone: 0,
    unsendable: 0,
    unclear: 0,
    sentTo: [],
    stopped: runs.some((run) => run.result === TOOL_STOPPED),
  };
  for (const one of outcomes) {
    if (one.code === "sent") {
      recap.sent += 1;
      if (one.host !== "") recap.sentTo.push(one.host);
      continue;
    }
    recap[one.code] += 1;
  }
  return nothingSaid(recap) ? null : recap;
}

/** Whether there is anything here to say at all. **`recapLine` never returns an
    empty line** — it has no words for "nothing", and inventing one would be a
    sentence about a turn that did nothing. So the emptiness is asked here, and
    by whoever reads a record back off the disk. */
export function nothingSaid(recap: Recap): boolean {
  return (
    recap.opened === 0 &&
    recap.typed === 0 &&
    recap.clicked === 0 &&
    !recap.tried &&
    !recap.clickInterrupted &&
    recap.waiting === 0 &&
    recap.sent === 0 &&
    recap.declined === 0 &&
    recap.expired === 0 &&
    recap.gone === 0 &&
    recap.unsendable === 0 &&
    recap.unclear === 0 &&
    !recap.stopped
  );
}

/**
 * The line a person reads, built now, in their language.
 *
 * **"No click" is said when the turn acted and never clicked** — a form opened
 * and filled, or a click that failed. That absence is the fact the owner cannot
 * otherwise see, and it is the one a model promising a click most often leaves
 * behind. A turn that only read is not acting, and says nothing of it.
 */
export function recapLine(recap: Recap, t: RecapWords): string {
  const said: string[] = [];
  if (recap.opened > 0) said.push(recap.asked === "" ? t.openedSome : t.askedFor(recap.asked));
  if (recap.typed > 0) said.push(t.typed(recap.typed));
  if (recap.clicked > 0) said.push(t.clicked(recap.clicked));
  else if (recap.clickInterrupted) said.push(t.clickInterrupted);
  else if (recap.tried || acted(recap)) said.push(t.noClick);
  if (recap.waiting > 0) said.push(t.waiting(recap.waiting));
  // **Every code gets its own words and its own count**, because a mixed answer
  // is two facts and one of them is the one that matters: "sent to a" over a
  // card that was declined says the wrong half of what happened.
  if (recap.sent > 0) said.push(t.sent(recap.sent, where(recap.sentTo, t)));
  if (recap.declined > 0) said.push(t.declined(recap.declined));
  if (recap.expired > 0) said.push(t.expired(recap.expired));
  if (recap.gone > 0) said.push(t.gone(recap.gone));
  if (recap.unsendable > 0) said.push(t.unsendable(recap.unsendable));
  if (recap.unclear > 0) said.push(t.unclear(recap.unclear));
  if (recap.stopped) said.push(t.interrupted);
  return `${t.lede} ${said.join(t.joiner)}`;
}

/** Whether this turn acted on the page, as against only reading it. The
    difference is what "no click" means: it is a fact about a form and an
    absence, never about a turn that only looked. */
function acted(recap: Recap): boolean {
  return recap.opened > 0 || recap.typed > 0;
}

/** The distinct fields words actually reached. **Not the calls**: a model that
    types a name, corrects it and types it again has been into one field, and
    "three fields" is what a person reads over a form with two boxes on it. */
function distinctRefs(runs: ToolRun[]): Set<string> {
  return new Set(runs.map((run) => refOf(run.arguments)).filter((one): one is string => one !== null));
}

/** Up to two hosts and a count of the rest: a line a person reads is not an
    address bar, and three sends to two sites is two names and a "+1". */
function where(hosts: string[], t: RecapWords): string {
  const named = [...new Set(hosts)];
  if (named.length === 0) return t.aSite;
  const listed = named.slice(0, 2).join(", ");
  return named.length > 2 ? `${listed} +${named.length - 2}` : listed;
}

/** The element a call named, as our own parse of our own argument. Display
    only, and never trimmed into nothing: an argument that is not ours is no
    field we can count, and a count of the ones we could read is the truth. */
function refOf(argumentsJson: string): string | null {
  try {
    const parsed: unknown = JSON.parse(argumentsJson);
    if (parsed === null || typeof parsed !== "object") return null;
    const ref = (parsed as { ref?: unknown }).ref;
    return typeof ref === "string" && ref.trim() !== "" ? ref.trim() : null;
  } catch {
    return null;
  }
}

/** The host an open asked for, never where it landed: **only the open's own
    structured answer can say that**, and the sidecar names no address in one —
    its sentence is prose and prose is not an interface. So the line says what
    was asked for, which is true whatever the page did with it. */
function hostOf(argumentsJson: string): string | null {
  try {
    const parsed: unknown = JSON.parse(argumentsJson);
    if (parsed === null || typeof parsed !== "object") return null;
    const url = (parsed as { url?: unknown }).url;
    const safe = publicHttpUrl(url);
    return safe === null ? null : new URL(safe).hostname.slice(0, 60);
  } catch {
    return null;
  }
}
