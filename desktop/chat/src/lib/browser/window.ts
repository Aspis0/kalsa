import { invoke, listen } from "../tauri";

/**
 * The browser window's own state, as the backend says it is.
 *
 * **This file is a mirror and nothing else.** The slot knows whether a session
 * exists and holds the pause with it, so the app says both: after every browser
 * call, whenever a pause moves, when a session ends, and once when a page
 * mounts. Nothing here decides anything — a page that guessed would be a page
 * that could draw a browser nobody can see, and could refuse a later call for a
 * pause with no control left to clear it.
 *
 * **Unknown is no window.** Before the first read has answered there is nothing
 * to pause, and the Pausa control is drawn over nothing until it does.
 */

export interface WindowState {
  open: boolean;
  paused: boolean;
  /** How many times the app's view of this has moved. Two snapshots are never in
      doubt about which is later. */
  seq: number;
}

let state: WindowState = { open: false, paused: false, seq: 0 };
const listeners = new Set<() => void>();

function tell(): void {
  for (const listener of listeners) listener();
}

export function isOpen(): boolean {
  return state.open;
}

export function isPaused(): boolean {
  return state.paused;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * What the app said, taken as a snapshot and nothing more.
 *
 * **A snapshot older than the one already applied is dropped.** The read a page
 * does on its mount and the events it listens to can cross — a read that left the
 * app before a browser was opened can land after the event that opened it — and
 * applying it would put back a window that is gone, or a pause nobody pressed.
 *
 * **A pause over no window is not read as a pause.** The app cannot produce one
 * — a session takes its pause with it — and a snapshot that said so anyway would
 * be a shape this file has no words for.
 */
function note(payload: unknown): void {
  const said = payload as Partial<WindowState> | null;
  const seq = typeof said?.seq === "number" ? said.seq : -1;
  if (seq < state.seq) return;
  const open = typeof said?.open === "boolean" ? said.open : false;
  const paused = open && typeof said?.paused === "boolean" ? said.paused : false;
  if (open === state.open && paused === state.paused) {
    // The same window, said again: the number still moves, so a later stale
    // snapshot has something older to be dropped against.
    state = { open, paused, seq };
    return;
  }
  state = { open, paused, seq };
  tell();
}

/** Asks once. A webview that reloaded mid-session has heard no event at all and
    the window it was driving is still there — this is what puts it back. */
async function read(): Promise<void> {
  try {
    // **A literal, and not a name.** `scripts/command-contract.mjs` decides what
    // the page invokes by call site, not by name, so a command reached through a
    // variable is a command it cannot see — and an uncalled one it cannot see is
    // a command it would call dead while the binary has it registered.
    note(await invoke<WindowState>("brain_browser_state"));
  } catch {
    // A read that failed says nothing, and what it leaves behind is "no window":
    // the tools stay offered to the chat's own gate, and no Pausa is drawn over a
    // browser nobody can confirm.
  }
}

/**
 * The one subscription, started once at the app's root and never torn down: a
 * browser window belongs to the window, not to whichever surface is on screen.
 *
 * **The listener goes up before the read.** Started together, an event that
 * arrives while the read is still in flight would find nothing listening, and the
 * read that follows it may have left the app before that event — so the window
 * would never be heard of at all. Attached first, the read is at worst the older
 * of the two, and the number says which.
 */
export async function startWindowBus(): Promise<() => void> {
  // The event of the same name, which is an event and not a command use: it
  // rides `listen`, and the contract guard counts it as one.
  const stop = await listen("brain_browser_state", note);
  await read();
  return stop;
}