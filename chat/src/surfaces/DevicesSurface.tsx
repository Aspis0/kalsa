import { useCallback, useEffect, useRef, useState } from "react";
import type { SurfaceKey } from "../app/surfaces";
import { lastKnown } from "../lib/slotGate";
import type { InviteList } from "./InvitePanel";
import { InvitePanel } from "./InvitePanel";
import { available, invoke } from "../lib/tauri";
import { forgetLocalCredential } from "./useBrain";
import "./surfaces.css";

const POLL_MS = 2000;
// The first read awaits two Tailscale CLI calls, 2 s timeout each: this is
// where "still checking" becomes a failure the owner can act on. It also
// releases a read that hung, so the next tick can ask again.
const FIRST_READ_BOUND_MS = 8000;

// The approved ways to say the square is the way in, that it was replaced,
// and who may use it. dev/smoke-react.mjs keeps its own copy of these on the
// review side and enforces them — rewording here means updating there on
// purpose, or failing the check.
const CAMERA_INSTRUCTION = "Point your phone's camera at the square.";
const AWARENESS = "Anyone who can see this square can connect a phone — show it only to yours.";
const FRESH_LINES: Record<string, string> = {
  expired: "The previous square expired — this one is fresh.",
  "wrong-code": "A square that did not match was replaced — this one is fresh.",
};

interface PairedDevice {
  id: number;
  label?: string;
  phone?: string;
  // The store's kind. "host" is this computer's own record; a phone is a
  // pairing result. Absent reads as a phone, the reading this page always had.
  kind?: "phone" | "host";
  // The owner has not allowed this phone yet: its credential answers the
  // door's 401 until Allow. Absent reads as allowed, the state every
  // stored device had before approval existed.
  waiting?: boolean;
}

/** What `brain_pairing` answers: one read, polled; two decisions and a retry. */
interface PairingState {
  state: "idle" | "waiting" | "claiming" | "paired" | "failed";
  qr_svg?: string | null;
  refreshed?: "expired" | "wrong-code" | null;
  phone?: string | null;
  devices?: PairedDevice[];
  delivery_pending?: boolean;
  door_port?: number | null;
  // The desk's own loopback port and whether it is the preferred one. A
  // constant would be wrong whenever the fallback fired, and a fallback
  // means the owner's standing serve rule points at the wrong port.
  // Absent reads as the preferred port, the state every DTO before this
  // field implied.
  desk_port?: number | null;
  desk_port_preferred?: boolean;
  failure?: "could-not-save" | "could-not-read" | "service-unavailable" | null;
}

// The paired sentence must be true for whatever the house holds: one phone
// is named — naming it IS naming the house — while several are counted,
// because naming one of many reads as if the others were not real. This
// computer's own row is not a phone and is never part of the count: "now
// works with This computer" is not a sentence about a pairing. A phone
// still waiting for Allow is not one this computer works with yet, so the
// success sentence is computed from approved phones only. Where phones are
// waiting, the sentence says the wait instead — a single waiting phone is
// named, several are counted — and a mixed house says both facts: the house
// counted as "paired phones", the waiting ones as waiting for the OK. The
// pending delivery is not attributable from the page — the flag says some
// phone is owed its connection, never which one, and with several devices
// the one it names may not be the one owed — so no clause of this sentence
// names a phone for it: naming the house is true either way, naming the
// wrong phone would not be.
function pairedSentence(dto: PairingState): string {
  const phones = (Array.isArray(dto.devices) ? dto.devices : []).filter(
    (device) => device.kind !== "host",
  );
  const waiting = phones.filter((device) => device.waiting === true);
  const approved = phones.filter((device) => device.waiting !== true);
  const pending = dto.delivery_pending === true;
  const undelivered = pending
    ? ", and one phone has not received its connection yet"
    : "";
  if (approved.length === 0 && waiting.length > 0) {
    if (waiting.length === 1) {
      const name = waiting[0].phone ?? waiting[0].label ?? dto.phone ?? "your phone";
      const owed = pending ? "; the phone still needs to receive its connection" : "";
      return `This computer is waiting for your OK to work with ${name}${owed}.`;
    }
    return `This computer is waiting for your OK to work with ${waiting.length} paired phones${undelivered}.`;
  }
  if (waiting.length > 0) {
    const are = waiting.length === 1 ? "is" : "are";
    return `This computer has ${phones.length} paired phones; ${waiting.length} ${are} waiting for your OK${undelivered}.`;
  }
  if (approved.length === 0) {
    return pending
      ? `This computer saved the connection for ${dto.phone ?? "your phone"}; a phone is still waiting to receive its connection.`
      : `This computer now works with ${dto.phone ?? "your phone"}.`;
  }
  if (approved.length === 1) {
    const name = approved[0].phone ?? approved[0].label ?? dto.phone ?? "your phone";
    return pending
      ? `This computer saved the connection for ${name}; a phone is still waiting to receive its connection.`
      : `This computer now works with ${name}.`;
  }
  return pending
    ? `This computer now works with ${approved.length} paired phones; the newest is still waiting to receive its connection.`
    : `This computer now works with ${approved.length} paired phones.`;
}

// Whether every phone in the house still waits for the owner's OK. The
// headline speaks for the house: while nothing is approved, "Paired" would
// claim a working phone; a mixed house keeps it for the approved ones.
function everyPhoneWaiting(devices: PairedDevice[] | undefined): boolean {
  const phones = (Array.isArray(devices) ? devices : []).filter(
    (device) => device.kind !== "host",
  );
  return phones.length > 0 && phones.every((device) => device.waiting === true);
}

// Both roads a phone needs, side by side: the door at the tailnet name and
// the desk behind :8443. Each command runs under --bg, because two serve
// rules cannot both hold the foreground, and whichever port is known is
// said — a missing piece is left out, never glossed. A desk on a fallback
// port is said too: a serve rule persists across reboots, so the standing
// rule keeps pointing at the preferred port, which now leads somewhere
// else or nowhere.
function tailscaleNote(
  doorPort: number | null | undefined,
  deskPort: number | null | undefined,
  deskOnPreferred: boolean,
): string | null {
  const isPort = (port: number | null | undefined): port is number =>
    typeof port === "number" && Number.isInteger(port) && port > 0;
  if (!isPort(doorPort) && !isPort(deskPort)) return null;
  const commands = [
    isPort(doorPort) ? `tailscale serve --bg ${doorPort}` : null,
    isPort(deskPort) ? `tailscale serve --bg --https=8443 ${deskPort}` : null,
  ]
    .filter((command) => command !== null)
    .join(" · ");
  // True for a first-time owner too: the DTO cannot know whether a serve
  // rule exists, so the sentence only states where the desk is and what
  // the desk command must say.
  const moved =
    isPort(deskPort) && !deskOnPreferred
      ? ` The pairing desk is on ${deskPort} this time — point the desk command at this number.`
      : "";
  // Each road is named only when its command is: a sentence about a road
  // with no command would be a promise the note does not keep.
  const where =
    isPort(doorPort) && isPort(deskPort)
      ? "The phone chats at this computer's tailnet name and pairs at that name with :8443."
      : isPort(doorPort)
        ? "The phone chats at this computer's tailnet name."
        : "The phone pairs at this computer's tailnet name with :8443.";
  return `Run for Tailscale: ${commands}. ${where}${moved}`;
}

interface DevicesSurfaceProps {
  onNavigate: (surface: SurfaceKey) => void;
}

// The Devices surface: the phone scans, nobody types. The square on screen is
// the ceremony's payload as SVG from kalsa-pairing's qr_svg(payload) —
// generated on this machine, so the page may inject it as markup; it is a
// credential on screen and is never logged anywhere.
export function DevicesSurface({ onNavigate }: DevicesSurfaceProps) {
  // The last pairing answer this page knows. A read that rejects, or one
  // that answers nothing, leaves it standing: "I could not ask" is not
  // "there is no phone connected".
  const [state, setState] = useState<PairingState | null>(null);
  // The first read has settled — answered, rejected, or past the bound.
  // Until then the page is checking, which is not a failure.
  const [settled, setSettled] = useState(false);
  // The invitations as the last read heard them: the page's poll reads them
  // beside the pairing, and the panel below reports its own reads back
  // through `onList` so the two never disagree.
  const [invites, setInvites] = useState<InviteList | null>(null);
  // One read at a time: a poll tick during a slow read is skipped, so two
  // answers cannot race. The generation numbers each read, so a reply from a
  // read the bound already released is dropped instead of landing over a
  // newer answer, and `live` keeps a late reply off an unmounted page.
  const inFlight = useRef(false);
  const generation = useRef(0);
  const live = useRef(false);

  const refresh = useCallback(async (): Promise<void> => {
    if (!live.current || inFlight.current) return;
    inFlight.current = true;
    const mine = ++generation.current;
    const stillMine = (): boolean => live.current && mine === generation.current;
    // No Tauri here: nothing can be asked. Settling keeps the page from
    // saying "checking" forever, and the failure below offers no Try again,
    // which could not work either.
    if (!available()) {
      inFlight.current = false;
      setSettled(true);
      return;
    }
    // A read that has not answered by the bound stops holding the lock, the
    // page stops waiting on it, and whatever it says later is no longer this
    // page's next answer.
    const bound = setTimeout(() => {
      if (!stillMine()) return;
      generation.current += 1;
      inFlight.current = false;
      setSettled(true);
    }, FIRST_READ_BOUND_MS);
    try {
      // The square first — the page's own checking state hangs on this
      // answer — then the invitations on the same tick, under the same
      // guards, so the two lists cannot race each other either. Each keeps
      // its own answer: one failing must not cost the other its read.
      try {
        const next = await invoke<PairingState | null>("brain_pairing");
        if (stillMine()) {
          setState((previous) => lastKnown(previous, next));
          setSettled(true);
        }
      } catch {
        // The command rejected: what this page already knows stands.
        if (stillMine()) setSettled(true);
      }
      if (!stillMine()) return;
      try {
        const listed = await invoke<InviteList | null>("brain_invite_list");
        if (stillMine()) setInvites((previous) => lastKnown(previous, listed));
      } catch {
        // The list rejected: what this page already knows stands.
      }
    } finally {
      clearTimeout(bound);
      if (mine === generation.current) inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    live.current = true;
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => {
      live.current = false;
      clearInterval(timer);
    };
  }, [refresh]);

  function retry(): void {
    void invoke("brain_pairing_retry").catch(() => {});
  }

  function forgetDevice(id: number): void {
    void invoke("brain_pairing_forget_device", { id }).catch(() => {});
  }

  function allowDevice(id: number): void {
    // This only writes the store: the door's new set is rebuilt by the app's
    // own brain_state poll (start_door_if_paired, useBrain's 1 s tick), the
    // same ride a Forget takes, and this page's poll redraws the rows.
    void invoke("brain_pairing_allow_device", { id }).catch(() => {});
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

  // Everything on the panel is decided here, so a state cannot leave a stale
  // square or a half-cleared button behind.
  let headline: string | null = null;
  let sentence: string;
  let qrSvg: string | null = null;
  let fresh: string | null = null;
  let note: string | null = null;
  let tailscale: string | null = null;
  let button: string | null = null;
  let alt: string | null = null;
  let onAction: () => void = () => {};
  let onAlt: () => void = () => {};
  let devices: PairedDevice[] = [];

  if (state !== null) {
    switch (state.state) {
      case "idle":
        onAction = () => onNavigate("server");
        sentence = "This computer is not running yet, so there is nothing for your phone to connect to.";
        button = "Go to Server";
        break;
      case "waiting":
        // No square yet is its own honest moment, not a camera instruction.
        if (!state.qr_svg) {
          sentence = "The square is not ready yet — it will appear here in a moment.";
          break;
        }
        sentence = CAMERA_INSTRUCTION;
        qrSvg = state.qr_svg;
        fresh = state.refreshed ?? null;
        note = AWARENESS;
        tailscale = tailscaleNote(
          state.door_port,
          state.desk_port,
          state.desk_port_preferred !== false,
        );
        break;
      case "claiming":
        onAction = retry;
        sentence = "A phone is connecting right now.";
        button = "Cancel";
        break;
      case "paired":
        onAction = retry;
        headline = everyPhoneWaiting(state.devices) ? "Waiting for your OK" : "Paired";
        sentence = pairedSentence(state);
        button = "Pair another phone";
        tailscale = tailscaleNote(
          state.door_port,
          state.desk_port,
          state.desk_port_preferred !== false,
        );
        devices = Array.isArray(state.devices) ? state.devices : [];
        break;
      case "failed":
        if (state.failure === "could-not-read") {
          onAction = forgetAndRefresh;
          onAlt = () => void refresh();
          headline = "Could not check";
          sentence =
            "This computer could not read its existing phone connection. Fixing permissions and trying again may help.";
          button = "Forget and pair again";
          alt = "Try again";
          break;
        }
        if (state.failure === "service-unavailable") {
          onAction = () => onNavigate("server");
          headline = "Pairing unavailable";
          sentence = "The local pairing service stopped. Restart the app to make pairing available again.";
          button = "Go to Server";
          break;
        }
        onAction = retry;
        headline = "Could not finish";
        // True for both roads: a square can be drawn again, an invitation
        // can be sent again, and neither promises that the last attempt
        // will come back on its own.
        sentence =
          "This computer could not save the new phone. Start the pairing again, or send a new invite.";
        button = "Try again";
        break;
      default:
        onAction = () => void refresh();
        sentence = "This page could not check whether a phone is connected. Trying again usually works.";
        button = "Try again";
    }
  } else if (!settled) {
    // Still the first read: say so plainly and offer no retry — there is
    // nothing to retry yet, and "could not check" would be false.
    sentence = "Checking for your phone…";
  } else {
    // Settled with nothing to show: the read rejected, hung past the bound,
    // or cannot run at all. "Try again" is offered only where a retry can
    // actually ask — outside the webview there is nothing to ask.
    sentence = "This page could not check whether a phone is connected. Trying again usually works.";
    if (available()) {
      onAction = () => void refresh();
      button = "Try again";
    }
  }

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

  return (
    <div className="surface-page">
      <h2>Pairing</h2>
      {headline ? <p className="surface-headline">{headline}</p> : null}
      <p className="surface-sentence">{sentence}</p>
      {qrSvg ? <div className="surface-qr" dangerouslySetInnerHTML={{ __html: qrSvg }} /> : null}
      {fresh && FRESH_LINES[fresh] ? <p className="surface-quiet">{FRESH_LINES[fresh]}</p> : null}
      {note ? <p className="surface-quiet">{note}</p> : null}
      {tailscale ? <p className="surface-quiet">{tailscale}</p> : null}
      {button || alt ? (
        <div className="surface-actions">
          {button ? (
            <button type="button" className="btn-primary" onClick={onAction}>
              {button}
            </button>
          ) : null}
          {alt ? (
            <button type="button" className="btn-quiet" onClick={onAlt}>
              {alt}
            </button>
          ) : null}
        </div>
      ) : null}
      {canInvite ? (
        <InvitePanel
          invites={invites}
          onList={(listed) => setInvites((previous) => lastKnown(previous, listed))}
        />
      ) : null}
      {devices.length > 0 ? (
        <div className="surface-devices">
          {devices.map((device) => {
            // This computer's own record: named as it names itself, and with
            // no Forget. The button would take the app's own key to its own
            // door out of the store while the running door still holds it, so
            // the local chat would answer 401 until the next launch minted a
            // fresh one. The command refuses it too; the row simply does not
            // offer it.
            const host = device.kind === "host";
            return (
              <div key={device.id} className="surface-device">
                <span className="surface-device-name">
                  {device.label ?? (host ? "This computer" : `device ${device.id}`)}
                </span>
                <span className="surface-device-detail">
                  {device.waiting ? "Waiting for your OK." : (device.phone ?? "")}
                </span>
                {host ? null : device.waiting ? (
                  <>
                    <button type="button" className="btn-quiet" onClick={() => allowDevice(device.id)}>
                      Allow
                    </button>
                    <button type="button" className="btn-quiet" onClick={() => forgetDevice(device.id)}>
                      Refuse
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn-quiet" onClick={() => forgetDevice(device.id)}>
                    Forget
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
