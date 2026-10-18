/**
 * Whether the browser tools may be offered at all, answered without awaiting.
 *
 * `offeredTools` is synchronous and runs on every request, so it cannot ask
 * Rust whether a driver is installed — it reads what the Settings row already
 * learned. That row reads the status whenever it mounts and whenever a download
 * finishes, and records it here; the answer is then a plain read.
 *
 * **Unknown is no.** A chat opened before Settings has ever been shown offers
 * no browser tools until the status has been read once, which costs a model one
 * round of "there is no tool called that" and never offers a tool that would
 * have failed.
 */

/** What the last status read said: installed, and on a platform that has one. */
let usable = false;

/** What `brain_browser_driver_status` answered. */
export interface BrowserStatus {
  supported: boolean;
  installed: boolean;
  size: number;
}

export function noteBrowserStatus(status: BrowserStatus): void {
  usable = status.supported && status.installed;
}

/** Whether the three read tools are offered in the next request. */
export function browserUsable(): boolean {
  return usable;
}
