import { publicHttpUrl } from "../lib/publicUrl";
import { available, invoke } from "../lib/tauri";

/** A button, not an `href`: the webview must never navigate to a remote
    origin. The click asks Rust to check the address again and hand it to the
    system browser. Outside the app the browser can open the link itself. */
export function Openable({ url, children, className }: { url: string; children: React.ReactNode; className?: string }) {
  return (
    <button
      type="button"
      className={className ?? "tool-link"}
      onClick={() => {
        if (available()) {
          void invoke("brain_open_external", { address: url }).catch(() => {});
          return;
        }
        const safe = publicHttpUrl(url);
        if (safe) window.open(safe, "_blank", "noreferrer");
      }}
    >
      {children}
    </button>
  );
}
