import "./EmptyState.css";
import type { HostKeyState } from "../surfaces/useBrain";
import { useLanguage } from "../i18n/useLanguage";

/** What the first page has to offer before a message can be written: which
    sentence-button pair it shows, each borrowed from the page that fixes it. */
export type SetupArm =
  | "server"
  | "service"
  | "starting"
  | "key"
  | "models"
  | null;

/** The machine's own state as the first page's arm. Every arm reuses words
    the UI already shows, so one fact has one sentence wherever the owner
    meets it:
    - no answer yet, stopped, failed or stopping → the Server page's
      stopped sentence ("Kalsa is off.") and its "Turn Kalsa on";
    - starting → the Server page's starting sentence: getting ready is not
      off. THIS is the transient arm: the poll's first `brain_state` answer
      lands within its second (the null arm below is shorter still); every
      other arm names a state that can last;
    - running with a door address but a credential the store would not
      give — the `brain_host_credential` command's OWN sentence, whichever
      of its three the rejection was (`credentialMessage`, gated in
      useBrain: main.rs's app-data failure, "This computer could not read
      its own connection key.", "This computer has not made its own
      connection key yet."; anything else falls back) — and the Devices
      page, whose hatch re-mints it (that command's recovery path). The
      read runs only against a LIVE door, so this is a door that stood up
      and could not hand its key over;
    - running with no door in the state, whatever the credential says —
      the read is gated on the door's address (useBrain's poll at :204),
      so a fresh launch with the door stood down never even asks and the
      credential stays `pending`. LASTING: the engine runs while this
      computer's chat connection cannot — an empty store, an unreadable
      one, a record the door refuses, a poisoned door lock, a listener
      that cannot bind, or a door that cannot be built. What the Devices
      page then shows is the STORE's truth, not the door's: the
      unreadable store gets its own sentence and the "Forget and pair
      again" hatch (which wipes and re-seats), and the empty store is
      re-seated at the next launch — the setup hook mints it every time.
      The door-side four show no failure on that page at all (its
      failures come from the desk's own state, pairing.rs:675-689), so
      the way back for them is removing the offending record or
      restarting the app. Wording is the owner's (2026-09-25): "This
      computer's chat connection is not working right now." with "Go to
      Devices";
    - running, door up, no model name → Advanced (where the field lives).
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
      // No door ADDRESS is a lasting state whatever the credential says:
      // the credential read is gated on the door's address, so a fresh
      // launch with the door stood down never even asks — the credential
      // just stays `pending`, and routing on it would pin this page on
      // "Getting ready" forever.
      if (!hasDoor) return "service";
      // The read runs only against a LIVE door, so a refusal here is a
      // door that stood up and could not hand its key over: the Devices
      // page's hatch re-mints it.
      if (credential === "missing") return "key";
      // The door's address is known and the read is still in flight:
      // getting ready — the transient arm.
      if (credential === "pending") return "starting";
      // The model name is typed where the field lives now: the AI page's
      // Advanced panel, beside the other development knobs.
      return model.trim() ? null : "models";
    default:
      // No answer yet reads as off only for as long as the poll's first
      // answer takes — its own second — and off/stopped/failed/stopping
      // are all the Server page's to fix.
      return "server";
  }
}

interface EmptyStateProps {
  setup: SetupArm;
  /** One of `brain_host_credential`'s own sentences when the store refused
      the read — the gate in useBrain passes only those three; anything
      else arrives as null, and the key arm then speaks the not-made-yet
      sentence instead. */
  credentialMessage: string | null;
  onOpenModels: () => void;
  onOpenServer: () => void;
  onOpenDevices: () => void;
}

/** First-run screen. One sentence, no jargon. */
export function EmptyState({
  setup,
  credentialMessage,
  onOpenModels,
  onOpenServer,
  onOpenDevices,
}: EmptyStateProps) {
  const { table } = useLanguage();
  return (
    <div className="empty">
      <div className="empty-mark" aria-hidden="true">
        <span />
      </div>
      <h2 className="empty-title">{table.firstPage.title}</h2>
      {setup === "server" ? (
        <>
          <p className="empty-copy">{table.firstPage.serverArm}</p>
          <button type="button" className="btn-primary btn-large" onClick={onOpenServer}>
            {table.firstPage.goToServer}
          </button>
        </>
      ) : setup === "service" ? (
        <>
          <p className="empty-copy">{table.firstPage.serviceArm}</p>
          <button type="button" className="btn-primary btn-large" onClick={onOpenDevices}>
            {table.firstPage.goToDevices}
          </button>
        </>
      ) : setup === "starting" ? (
        <>
          <p className="empty-copy">{table.firstPage.startingArm}</p>
          <button type="button" className="btn-primary btn-large" onClick={onOpenServer}>
            {table.firstPage.goToServer}
          </button>
        </>
      ) : setup === "key" ? (
        <>
          <p className="empty-copy">
            {credentialMessage || table.firstPage.keyArm}
          </p>
          <button type="button" className="btn-primary btn-large" onClick={onOpenDevices}>
            {table.firstPage.devices}
          </button>
        </>
      ) : setup === "models" ? (
        <>
          <p className="empty-copy">{table.advanced.noModelYet}</p>
          <button type="button" className="btn-primary btn-large" onClick={onOpenModels}>
            {table.advanced.addModelName}
          </button>
        </>
      ) : (
        <p className="empty-copy">{table.firstPage.ready}</p>
      )}
    </div>
  );
}
