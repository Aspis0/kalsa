import { useState } from "react";
import type { CSSProperties } from "react";
import type { SurfaceKey } from "../app/surfaces";
import { rustSentence } from "../lib/rustText";
import { lastKnown } from "../lib/slotGate";
import { InvitePanel } from "./InvitePanel";
import { PhoneRow } from "./PhoneRow";
import { PhonesSquare } from "./PhonesSquare";
import { usePairingRead } from "./usePairingRead";
import { useRowFold } from "./useRowFold";
import { useDeviceBeats } from "./useDeviceBeats";
import { BEAT_MS, FOLD_MS, reducedMotion } from "./motion";
import { available, invoke } from "../lib/tauri";
import { forgetLocalCredential, useBrain } from "./useBrain";
import { useLanguage } from "../i18n/useLanguage";
import { Icon } from "../components/Icon";
import { hidesOnSeat } from "./pairingWords";
import { phonesPanel } from "./phonesPanel";
import type { PanelAction } from "./phonesPanel";
import type { PairedDevice } from "./pairingWords";
import "./surfaces.css";
import "./DevicesSurface.css";

// The approved ways to say the square is the way in, that it was replaced,
// and who may use it live in the devices table; dev/smoke-react.mjs keeps
// its own English copy and enforces it — rewording means updating both on
// purpose, or failing the check.

// The tempos the CSS beats read, set once on the page root: the numbers
// live in motion.ts and nowhere else.
const beatVars = {
  "--beat-ms": `${BEAT_MS}ms`,
  "--beat-unfold-ms": `${FOLD_MS}ms`,
} as CSSProperties;

interface DevicesSurfaceProps {
  onNavigate: (surface: SurfaceKey) => void;
}

// The Devices surface: the phone scans, nobody types. The square on screen is
// the ceremony's payload as SVG from kalsa-pairing's qr_svg(payload) —
// generated on this machine, so the page may inject it as markup; it is a
// credential on screen and is never logged anywhere.
export function DevicesSurface({ onNavigate }: DevicesSurfaceProps) {
  const { table, tag } = useLanguage();
  const t = table.devices;
  // A refused rename, said once under the rows and kept until the next press:
  // the row redraws from the store either way, and a reason that vanished on
  // its own would be one the owner could not act on.
  const [renameError, setRenameError] = useState<string | null>(null);
  // The fold is the hook's business: this page only asks for it and reads
  // whether one is running.
  const fold = useRowFold();
  const { state, setState, settled, invites, setInvites, refresh, mounted } = usePairingRead(() => fold.folding());
  // The beat a row plays after the owner's Allow lands on it.
  const beats = useDeviceBeats(state?.devices);
  // The brain's own 1 s read, for the one fact this page wants from it:
  // which phones the door is serving right now. The host is in that set
  // whenever this computer's own chat is talking — the dot speaks about
  // phones, so the host is counted out of it.
  const brain = useBrain();
  const motionless = reducedMotion();
  const activeIds = new Set(
    (brain.state?.metrics?.active_devices ?? [])
      .filter((device) => device.kind !== "host")
      .map((device) => device.id)
      .filter((id): id is number => typeof id === "number"),
  );

  function retry(): void {
    void invoke("brain_pairing_retry").catch(() => {});
  }

  // The row's record is out of the store; this takes it out of what the page
  // shows, so the fold ends with the list it started from — the next poll
  // confirms the same thing from the store itself.
  function removeRow(id: number): void {
    setState((current) =>
      current !== null && Array.isArray(current.devices)
        ? { ...current, devices: current.devices.filter((device) => device.id !== id) }
        : current,
    );
  }

  // Refuse a request riding on its seat's row: the waiting record behind it
  // goes, the seat and its phone stay — the row is not the record, so
  // nothing folds. The beat a pending Allow might have landed goes with it:
  // the same poll answer resolves an Allow and a Refuse, so the beat keys
  // on the button the owner pressed, never on the record merely leaving.
  function denyRequest(id: number): void {
    beats.deny(id);
    // A Deny the store rejects leaves the decision unmade: the row gets
    // its buttons back, or they stay down forever.
    void invoke("brain_pairing_forget_device", { id }).catch(() => beats.revoke(id));
  }

  // Forget, with the beat the owner approved: the row folds out of the list
  // and only then leaves it, so the rows below move with it instead of
  // jumping up. The store has already changed when this runs — the command
  // resolved — so what follows is presentation only, and a failure means the
  // row never moved at all.
  function forgetDevice(id: number): void {
    // What leaves may carry a pending decision with it: the record itself,
    // or the seat an Allow was going to land on.
    beats.revokeTouching(id);
    void invoke("brain_pairing_forget_device", { id })
      .then(() => {
        if (mounted()) fold.begin(id, () => removeRow(id));
      })
      .catch(() => {});
  }

  function allowDevice(actedId: number, rowId: number): void {
    // This only writes the store: the door's new set is rebuilt by the app's
    // own brain_state poll (start_door_if_paired, useBrain's 1 s tick), the
    // same ride a Forget takes, and this page's poll redraws the rows. The
    // beat below lands on the row the owner saw — for a pairing-again
    // Allow the command acts on the request while the row that stays is
    // its seat, so the two ids travel together until the answer separates
    // them.
    beats.expect(actedId, rowId);
    void invoke("brain_pairing_allow_device", { id: actedId })
      .catch(() => beats.revoke(actedId));
  }

  /** The owner's own name for a phone, or null to give it back its number. The
   * row's field holds what was typed; this writes it, and a refusal is said
   * once under the rows — the next poll redraws the row from the store, which
   * is the truth whatever this call did. */
  function renameDevice(id: number, name: string | null): void {
    setRenameError(null);
    void invoke("brain_pairing_set_device_name", { id, name }).catch((error: unknown) => {
      if (mounted()) setRenameError(rustSentence(table.rust, error, tag));
    });
  }

  function forgetAndRefresh(): void {
    invoke("brain_pairing_forget")
      .then(() => {
        // The hatch deleted the whole store, host record included: the key
        // this window cached is dead, and the door the next poll rebuilds
        // holds the replacement. Dropping it here is what lets that poll
        // fetch it instead of the page answering 401 until a reload.
        forgetLocalCredential();
        void refresh();
      })
      .catch(() => {});
  }

  const {
    title,
    lead,
    headline,
    sentence,
    qrSvg,
    fresh,
    note,
    noteClass,
    tailscale,
    button,
    buttonIcon,
    quietButton,
    action,
    alt,
    altAction,
    devices,
  } = phonesPanel(t, state, settled, available());
  const run = (what: PanelAction | null): void => {
    if (what === "turnOn") onNavigate("brain");
    else if (what === "retry") retry();
    else if (what === "refresh") void refresh();
    else if (what === "forgetAndRefresh") forgetAndRefresh();
  };

  // The invite section is where this page can pair: a square on screen, a
  // house already paired, and the one pairing that failed to save — whose
  // own words tell the owner to send a new invite, so the button has to be
  // there for that sentence to be true. Outside the webview there is
  // nothing to ask, so none of it is drawn.
  const canInvite =
    available() &&
    (state?.state === "waiting" ||
      state?.state === "paired" ||
      state?.failure === "could-not-save");

  // A phone this house has already admitted — the line below speaks for the
  // phones that can ask, and a phone still waiting for Allow is not one.
  const hasPairedPhone = devices.some(
    (device) => device.kind !== "host" && device.waiting !== true,
  );
  // Each request is filed under the seat it belongs to, so the seat's row can
  // speak for it. Two stale requests under one seat (a file from before the
  // store replaced them) answer with the newest: that is the ceremony the
  // store would have kept.
  const requests = new Map<number, PairedDevice>();
  for (const device of devices) {
    if (device.pairing_again != null) requests.set(device.pairing_again, device);
  }

  const squareOpen = state?.state === "waiting";
  const card = state?.state === "idle" || state?.state === "failed";
  const headlineEl = headline ? <p className="surface-headline">{headline}</p> : null;
  // The claiming banner shares its line with the wordless dots; the other
  // states draw the sentence alone.
  const sentenceLine = (
    <div className={state?.state === "claiming" ? "surface-sentence-line phones-banner" : "surface-sentence-line"}>
      {state?.state === "claiming" ? <Icon name="phone" size={20} /> : null}
      <p className="surface-sentence">{sentence}</p>
      {state?.state === "claiming" && !motionless ? (
        <span className="surface-connecting" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      ) : null}
    </div>
  );
  const actions =
    button || alt ? (
      <div className="surface-actions">
        {button ? (
          <button
            type="button"
            className={quietButton ? "btn-quiet" : "btn-primary"}
            onClick={() => run(action)}
          >
            {buttonIcon ? <Icon name={buttonIcon} size={18} stroke={2.2} /> : null}
            {button}
          </button>
        ) : null}
        {alt ? (
          <button type="button" className="btn-quiet" onClick={() => run(altAction)}>
            {alt}
          </button>
        ) : null}
      </div>
    ) : null;
  const invitePanel = canInvite ? (
    <InvitePanel
      invites={invites}
      onList={(listed) => setInvites((previous) => lastKnown(previous, listed))}
    />
  ) : null;

  return (
    <div className="surface-page phones-page" style={beatVars}>
      <h2 className={state?.state === "paired" ? "phones-headline" : undefined}>{title}</h2>
      {lead ? <p className="phones-lead">{lead}</p> : null}
      {squareOpen ? (
        <PhonesSquare
          qrSvg={qrSvg}
          sentence={sentence}
          note={note}
          fresh={fresh}
          tailscale={tailscale}
          invitePanel={invitePanel}
        />
      ) : card ? (
        <div className={state?.state === "failed" ? "phones-card is-failed" : "phones-card"}>
          <span className="phones-card-icon" aria-hidden="true">
            <Icon
              name={state?.state === "idle" ? "power" : state?.failure === "service-unavailable" ? "wifiOff" : "alert"}
              size={22}
            />
          </span>
          <div className="phones-card-body">
            {headlineEl}
            {sentenceLine}
            {actions}
          </div>
        </div>
      ) : state?.state === "paired" ? null : (
        <>
          {headlineEl}
          {sentenceLine}
        </>
      )}
      {devices.length > 0 ? (
        <div className="surface-devices">
          {devices.map((device) => {
            // A request rides its seat's row — when the seat is still here,
            // so one phone never becomes two. A seat that left while the
            // request waited leaves it nowhere to sit, and a ceremony that
            // is waiting must never be hidden.
            if (hidesOnSeat(device, devices)) return null;
            const request = requests.get(device.id);
            const connected = beats.connected.has(device.id);
            return (
              <PhoneRow
                key={device.id}
                device={device}
                request={request}
                connected={connected}
                entering={!motionless && beats.enteringIds.has(device.id)}
                active={activeIds.has(device.id)}
                decided={beats.decided}
                rowRef={fold.refFor(device.id)}
                style={fold.styleFor(device.id)}
                onAllow={allowDevice}
                onForget={forgetDevice}
                onDeny={denyRequest}
                onRename={renameDevice}
              />
            );
          })}
        </div>
      ) : null}
      {!squareOpen && !card ? (
        <>
          {note ? <p className={noteClass}>{note}</p> : null}
          {renameError ? (
            <p className="phones-note is-warn" role="alert">
              <Icon name="alert" size={15} />
              {renameError}
            </p>
          ) : null}
          {tailscale ? <p className="surface-quiet">{tailscale}</p> : null}
        </>
      ) : null}
      {!squareOpen ? (
        // The page's own button and Invite by link share one row (09-phones-paired).
        <div className="phones-more">
          {card ? null : actions}
          {invitePanel}
        </div>
      ) : null}
      {hasPairedPhone ? <p className="surface-quiet">{t.capacityLine}</p> : null}
    </div>
  );
}
