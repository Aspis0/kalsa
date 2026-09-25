import "./EmptyState.css";
import type { HostKeyState } from "../surfaces/useBrain";

/** What the first page has to offer before a message can be written: which
    sentence-button pair it shows, each borrowed from the page that fixes it. */
export type SetupArm = "server" | "starting" | "key" | "settings" | null;

/** The machine's own state as the first page's arm. Every arm reuses words
    the UI already shows, so one fact has one sentence wherever the owner
    meets it:
    - no answer yet, stopped, failed or stopping → the Server page's
      stopped sentence ("This computer is not running anything right now.")
      and its "Go to Server" — today's arm for a machine with nowhere to send;
    - starting, or running whose door address or host credential has not
      answered yet → the Server page's starting sentence: getting ready is
      not off;
    - running with a credential the store would not give — the
      `brain_host_credential` command's own "This computer has not made its
      own connection key yet." — and the Devices page, whose hatch re-mints
      the key (the recovery path that command's doc names);
    - running, door up, no model name → Settings.
    Each arm is pinned in `dev/smoke-react.mjs`. */
export function setupArm(
  kind: string | null,
  credential: HostKeyState,
  hasDoor: boolean,
  model: string,
): SetupArm {
  switch (kind) {
    case "starting":
      return "starting";
    case "running":
      if (credential === "missing") return "key";
      // The credential read or the door's address is still in flight:
      // getting ready, never "off".
      if (credential !== "answered" || !hasDoor) return "starting";
      return model.trim() ? null : "settings";
    default:
      // No answer yet reads as off only for as long as the poll's first
      // answer takes — its own second — and off/stopped/failed/stopping
      // are all the Server page's to fix.
      return "server";
  }
}

interface EmptyStateProps {
  setup: SetupArm;
  onOpenSettings: () => void;
  onOpenServer: () => void;
  onOpenDevices: () => void;
}

/** First-run screen. One sentence, no jargon. */
export function EmptyState({
  setup,
  onOpenSettings,
  onOpenServer,
  onOpenDevices,
}: EmptyStateProps) {
  return (
    <div className="empty">
      <div className="empty-mark" aria-hidden="true">
        <span />
      </div>
      <h2 className="empty-title">Talk to your model.</h2>
      {setup === "server" ? (
        <>
          <p className="empty-copy">This computer is not running anything right now.</p>
          <button type="button" className="btn-primary btn-large" onClick={onOpenServer}>
            Go to Server
          </button>
        </>
      ) : setup === "starting" ? (
        <>
          <p className="empty-copy">Getting ready. On an older computer this can take a minute.</p>
          <button type="button" className="btn-primary btn-large" onClick={onOpenServer}>
            Go to Server
          </button>
        </>
      ) : setup === "key" ? (
        <>
          <p className="empty-copy">
            This computer has not made its own connection key yet.
          </p>
          <button type="button" className="btn-primary btn-large" onClick={onOpenDevices}>
            Devices
          </button>
        </>
      ) : setup === "settings" ? (
        <>
          <p className="empty-copy">This computer has no model name yet.</p>
          <button type="button" className="btn-primary btn-large" onClick={onOpenSettings}>
            Open settings
          </button>
        </>
      ) : (
        <p className="empty-copy">Write your first message below to begin.</p>
      )}
    </div>
  );
}
