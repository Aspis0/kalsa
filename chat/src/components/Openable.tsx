import { available, invoke } from "../lib/tauri";

/**
 * Something the reader can open in this computer's browser.
 *
 * A button, not an `href`: a Tauri webview does not reach the system browser on
 * its own, so an anchor is underlined, changes the cursor, and does nothing at
 * all when clicked — measured at the keyboard on 2026-09-19, on the tool
 * sources first and then on every link a model wrote in an answer. The page
 * does not open anything itself: it asks a command, which checks the address
 * again in Rust and only then hands it to the operating system.
 *
 * Whether an address may be offered at all is decided by `publicUrl.ts`,
 * before this is rendered. Outside the app (a plain browser) there is no
 * command, and the browser can open it itself.
 */
export function Openable({ url, children }: { url: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className="tool-link"
      onClick={() => {
        if (available()) {
          // The refusal is the command's sentence; the same gate has already
          // refused such an address before this was offered, so there is
          // nothing to show the reader here.
          void invoke("brain_open_url", { url }).catch(() => {});
          return;
        }
        window.open(url, "_blank", "noreferrer");
      }}
    >
      {children}
    </button>
  );
}
