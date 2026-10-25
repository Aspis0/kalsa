import { useEffect, useSyncExternalStore } from "react";
import { available } from "../tauri";
import { driverStatus } from "../driver";
import { browserUsableSnapshot, noteBrowserStatus, subscribeBrowserUsable } from "./usable";

/**
 * The browser's answer for the chat, read once at the app's start.
 *
 * The chat offers the browser tools behind one question — is a driver installed
 * on a platform that has a browser — and `offeredTools` is synchronous, so the
 * answer has to already be known before a request goes out. Reading it in the
 * Settings row meant a chat opened before Settings was ever shown offered no
 * browser tools, which read to a model as "there is no tool called that".
 *
 * **Unknown stays "no."** Until this has answered once the tools are not
 * offered, because offering a tool whose driver is missing produces a refusal
 * in the middle of a turn instead of an honest absence at the start of one. The
 * row re-reads it on every change it makes — a finished download, a clear — so
 * the answer this gives is not the only one the app ever has.
 *
 * Mounted once, at the app's root, and never torn down: a browser session
 * belongs to the window, not to whichever surface is on screen.
 */
export function useBrowserStatus(): void {
  useEffect(() => {
    if (!available()) return;
    void refreshBrowserStatus();
  }, []);
}

/**
 * One read, recorded where `offeredTools` can see it. Called at the app's start
 * and again by whatever changed the answer — a finished download, a clear — so
 * the chat never offers a tool the row already knows is missing, nor hides one
 * it knows is there.
 */
export async function refreshBrowserStatus(): Promise<void> {
  try {
    noteBrowserStatus(await driverStatus());
  } catch {
    // A read that failed says nothing, and what it leaves behind is "no": the
    // tools stay unoffered rather than being offered on a guess.
    noteBrowserStatus({ supported: false, installed: false, size: 0 });
  }
}

/**
 * Whether the browser may be offered right now, watched.
 *
 * **The answer is read, not asked.** `browserUsable` is a plain read of what
 * the last status said, and a screen that read it once would keep drawing a
 * control the app can no longer honour — so the screen watches the answer
 * instead, and the control appears and disappears with it.
 *
 * **Unknown is no**, on the server snapshot too: a screen that renders before
 * the first read has no browser to offer, and offers none.
 */
export function useBrowserUsable(): boolean {
  return useSyncExternalStore(subscribeBrowserUsable, browserUsableSnapshot, () => false);
}