import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { SurfaceKey } from "../app/surfaces";
import { lastKnown } from "../lib/slotGate";
import type { InviteList } from "./InvitePanel";
import { InvitePanel } from "./InvitePanel";
import { useRowFold } from "./useRowFold";
import { useDeviceBeats } from "./useDeviceBeats";
import { BEAT_MS, FOLD_MS, reducedMotion } from "./motion";
import { available, invoke, PAIRING_ASK_BOUND_MS } from "../lib/tauri";
import { visibleInterval } from "../lib/pageVisible";
import { codeSentence } from "../lib/rustText";
import { forgetLocalCredential, useBrain } from "./useBrain";
import { useLanguage } from "../i18n/useLanguage";
import type { English } from "../i18n/en/all";
import "./surfaces.css";

// The poll this page runs while it is open. Read by the review bench,
// which waits its cadence out rather than guessing wall-clock numbers.
export const POLL_MS = 2000;

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

interface PairedDevice {
  id: number;
  label?: string;
  phone?: string;
  /** The capability label as a code beside the English; the screen renders
      the code, the English stays for phone clients. */
  phone_code?: string;
  phone_params?: Record<string, unknown>;
  // The store's kind. "host" is this computer's own record; a phone is a
  // pairing result. Absent reads as a phone, the reading this page always had.
  kind?: "phone" | "host";
  // The owner has not allowed this phone yet: its credential answers the
  // door's 401 until Allow. Absent reads as allowed, the state every
  // stored device had before approval existed.
  waiting?: boolean;
  // Present only on a waiting record whose phone already holds an allowed
  // seat: that seat's id. The request is drawn on the seat's row, and this
  // record never gets one of its own.
  pairing_again?: number | null;
}

/** What `brain_pairing` answers: one read, polled; two decisions and a retry. */
interface PairingState {
  state: "idle" | "waiting" | "claiming" | "paired" | "failed";
  qr_svg?: string | null;
  refreshed?: "expired" | "wrong-code" | null;
  phone?: string | null;
  phone_code?: string | null;
  phone_params?: Record<string, unknown> | null;
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
// works with This computer" is not a sentence about a pairing. Nor is a
// record that is pairing again: it is drawn on its seat's row, and the
// house has one phone there, not two. A phone
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
// A waiting record whose seat is still in the house sits on that seat's row:
// no row and no count of its own, so one phone is never two. Its seat gone —
// forgotten while the request waited — it is one waiting phone like any
// other: its own row, its own count, its own buttons.
function hidesOnSeat(device: PairedDevice, devices: PairedDevice[]): boolean {
  return device.pairing_again != null && devices.some((row) => row.id === device.pairing_again);
}

function pairedSentence(t: English["devices"], dto: PairingState): string {
  const house = Array.isArray(dto.devices) ? dto.devices : [];
  const phones = house.filter((device) => device.kind !== "host" && !hidesOnSeat(device, house));
  const waiting = phones.filter((device) => device.waiting === true);
  const approved = phones.filter((device) => device.waiting !== true);
  const pending = dto.delivery_pending === true;
  const undelivered = pending ? t.undeliveredClause : "";
  if (approved.length === 0 && waiting.length > 0) {
    if (waiting.length === 1) {
      const name = waiting[0].phone ?? waiting[0].label ?? dto.phone ?? t.yourPhone;
      const owed = pending ? t.owedPending : "";
      return t.waitingNamed(name, owed);
    }
    return t.waitingCount(waiting.length, undelivered);
  }
  if (waiting.length > 0) {
    return waiting.length === 1
      ? t.mixedOne(phones.length, undelivered)
      : t.mixedMany(phones.length, waiting.length, undelivered);
  }
  if (approved.length === 0) {
    return pending
      ? t.savedPending(dto.phone ?? t.yourPhone)
      : t.worksWith(dto.phone ?? t.yourPhone);
  }
  if (approved.length === 1) {
    const name = approved[0].phone ?? approved[0].label ?? dto.phone ?? t.yourPhone;
    return pending ? t.savedPending(name) : t.worksWith(name);
  }
  return pending ? t.worksWithCountPending(approved.length) : t.worksWithCount(approved.length);
}

// Whether every phone in the house still waits for the owner's OK. The
// headline speaks for the house: while nothing is approved, "Paired" would
// claim a working phone; a mixed house keeps it for the approved ones.
function everyPhoneWaiting(devices: PairedDevice[] | undefined): boolean {
  // A record sitting on its seat's row is not a phone of its own: the
  // headline speaks for the phones the house draws.
  const house = Array.isArray(devices) ? devices : [];
  const phones = house.filter((device) => device.kind !== "host" && !hidesOnSeat(device, house));
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
  t: English["devices"],
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
    isPort(deskPort) && !deskOnPreferred ? t.deskMoved : "";
  // Each road is named only when its command is: a sentence about a road
  // with no command would be a promise the note does not keep.
  const where =
    isPort(doorPort) && isPort(deskPort)
      ? t.chatsAndPairs
      : isPort(doorPort)
        ? t.chatsAt
        : t.pairsAt;
  return `${t.runForTailscale(commands)} ${where}${moved}`;
}

interface DevicesSurfaceProps {
  onNavigate: (surface: SurfaceKey) => void;
}

// A button the row holds after one press. It is aria-disabled, not
// disabled: disabling it would drag the owner's focus to <body> the moment
// it is pressed, so it stays what it was — focusable, named, and inert
// until the store's answer releases it.
function HeldButton({
  held,
  onPress,
  children,
}: {
  held: boolean;
  onPress: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      className="btn-quiet"
      aria-disabled={held}
      onClick={() => {
        if (!held) onPress();
      }}
    >
      {children}
    </button>
  );
}

// The Devices surface: the phone scans, nobody types. The square on screen is
// the ceremony's payload as SVG from kalsa-pairing's qr_svg(payload) —
// generated on this machine, so the page may inject it as markup; it is a
// credential on screen and is never logged anywhere.
export function DevicesSurface({ onNavigate }: DevicesSurfaceProps) {
  const { table, tag } = useLanguage();
  const t = table.devices;
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
  // The fold is the hook's business: this page only asks for it and reads
  // whether one is running.
  const fold = useRowFold();
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

  const refresh = useCallback(async (): Promise<void> => {
    // No read STARTS while a row folds — all this line claims. A read
    // already in flight when the fold began still finishes, and its answer
    // is dropped where it lands, for the same reason: a list that no longer
    // holds the folding row would cut the beat short.
    if (!live.current || inFlight.current || fold.folding()) return;
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
    }, PAIRING_ASK_BOUND_MS);
    try {
      // The square first — the page's own checking state hangs on this
      // answer — then the invitations on the same tick, under the same
      // guards, so the two lists cannot race each other either. Each keeps
      // its own answer: one failing must not cost the other its read.
      try {
        const next = await invoke<PairingState | null>("brain_pairing");
        if (stillMine()) {
          // A fold under way holds its row: an answer that has already let
          // it go would drop the row mid-beat, so it is dropped instead and
          // the next poll takes it.
          if (!fold.folding()) setState((previous) => lastKnown(previous, next));
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
    // `brain_pairing` expires and refreshes the pairing square, so the hidden clock slows, never stops.
    const stopClock = visibleInterval(() => void refresh(), POLL_MS);
    return () => {
      live.current = false;
      stopClock();
    };
  }, [refresh]);

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
        if (live.current) fold.begin(id, () => removeRow(id));
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
        sentence = t.notRunningYet;
        button = t.goToServer;
        break;
      case "waiting":
        // No square yet is its own honest moment, not a camera instruction.
        if (!state.qr_svg) {
          sentence = t.squareNotReady;
          break;
        }
        sentence = t.cameraInstruction;
        qrSvg = state.qr_svg;
        fresh = state.refreshed ?? null;
        note = t.awareness;
        tailscale = tailscaleNote(
          t,
          state.door_port,
          state.desk_port,
          state.desk_port_preferred !== false,
        );
        break;
      case "claiming":
        onAction = retry;
        sentence = t.claiming;
        button = t.cancel;
        break;
      case "paired":
        onAction = retry;
        headline = everyPhoneWaiting(state.devices) ? t.waitingForOkHeadline : t.pairedHeadline;
        sentence = pairedSentence(t, state);
        button = t.pairAnother;
        tailscale = tailscaleNote(
          t,
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
          headline = t.couldNotReadHeadline;
          sentence = t.couldNotReadSentence;
          button = t.forgetAndPairAgain;
          alt = t.tryAgain;
          break;
        }
        if (state.failure === "service-unavailable") {
          onAction = () => onNavigate("server");
          headline = t.unavailableHeadline;
          sentence = t.unavailableSentence;
          button = t.goToServer;
          break;
        }
        onAction = retry;
        headline = t.couldNotFinishHeadline;
        // True for both roads: a square can be drawn again, an invitation
        // can be sent again, and neither promises that the last attempt
        // will come back on its own.
        sentence = t.couldNotSaveSentence;
        button = t.tryAgain;
        break;
      default:
        onAction = () => void refresh();
        sentence = t.couldNotCheckSentence;
        button = t.tryAgain;
    }
  } else if (!settled) {
    // Still the first read: say so plainly and offer no retry — there is
    // nothing to retry yet, and "could not check" would be false.
    sentence = t.checking;
  } else {
    // Settled with nothing to show: the read rejected, hung past the bound,
    // or cannot run at all. "Try again" is offered only where a retry can
    // actually ask — outside the webview there is nothing to ask.
    sentence = t.couldNotCheckSentence;
    if (available()) {
      onAction = () => void refresh();
      button = t.tryAgain;
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

  return (
    <div className="surface-page" style={beatVars}>
      <h2>{t.title}</h2>
      {headline ? <p className="surface-headline">{headline}</p> : null}
      <div className="surface-sentence-line">
        <p className="surface-sentence">{sentence}</p>
        {state?.state === "claiming" && !motionless ? (
          <span className="surface-connecting" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        ) : null}
      </div>
      {qrSvg ? <div className="surface-qr" dangerouslySetInnerHTML={{ __html: qrSvg }} /> : null}
      {fresh && (fresh === "expired" || fresh === "wrong-code") ? (
        <p className="surface-quiet">{fresh === "expired" ? t.freshExpired : t.freshWrongCode}</p>
      ) : null}
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
            // A request rides its seat's row — when the seat is still here,
            // so one phone never becomes two. A seat that left while the
            // request waited leaves it nowhere to sit, and a ceremony that
            // is waiting must never be hidden.
            if (hidesOnSeat(device, devices)) return null;
            const name = device.label ?? (host ? t.thisComputerLabel : t.deviceLabel(device.id));
            const request = requests.get(device.id);
            // The beat after Allow: the sentence and its checkmark hold the
            // row for a moment, then it settles into the ordinary detail.
            const connected = beats.connected.has(device.id);
            // A row waiting for the owner's decision carries the wash —
            // a standing tint that survives reduced motion, since "needs
            // you" is information — and, when motion is allowed, a waiting
            // row that just arrived unfolds in: the reverse of the fold,
            // on the fold's own number, and pure motion, so reduced motion
            // draws no entrance and no beat.
            const needsOwner = !connected && (device.waiting === true || request !== undefined);
            const entering = !motionless && beats.enteringIds.has(device.id);
            const classes =
              "surface-device" +
              (needsOwner ? " is-waiting" : "") +
              (entering ? " is-entering" : "");
            return (
              <div
                key={device.id}
                className={classes}
                ref={fold.refFor(device.id)}
                style={fold.styleFor(device.id)}
              >
                {activeIds.has(device.id) ? (
                  <span className="surface-device-live" aria-hidden="true" />
                ) : null}
                <span className="surface-device-name">{name}</span>
                {/* The detail is the row's voice: the beat a screen reader
                    hears land is the same sentence the owner reads. */}
                <span className="surface-device-detail" aria-live="polite">
                  {connected ? (
                    <>
                      <svg className="surface-check" viewBox="0 0 12 10" aria-hidden="true">
                        <path
                          className="surface-check-path"
                          d="M1 5.5 4.5 9 11 1.5"
                        />
                      </svg>
                      {t.connectedSentence(name)}
                    </>
                  ) : device.waiting ? (
                    t.waitingOkRow
                  ) : request ? (
                    t.pairingAgain(name)
                  ) : device.phone_code ? (
                    codeSentence(table.rust, device.phone_code, device.phone_params ?? {}, tag)
                  ) : (
                    (device.phone ?? "")
                  )}
                </span>
                {host ? null : device.waiting ? (
                  <>
                    <HeldButton
                      held={beats.decided.has(device.id)}
                      onPress={() => allowDevice(device.id, device.id)}
                    >
                      {t.allow}
                    </HeldButton>
                    <HeldButton
                      held={beats.decided.has(device.id)}
                      onPress={() => forgetDevice(device.id)}
                    >
                      {t.refuse}
                    </HeldButton>
                  </>
                ) : request ? (
                  // The buttons belong to the REQUEST, not the seat: Deny
                  // takes the request back and leaves this phone, its label
                  // and its credential exactly where they are. One press is
                  // enough — the row holds its decision until the store's
                  // next answer.
                  <>
                    <HeldButton
                      held={beats.decided.has(request.id)}
                      onPress={() => allowDevice(request.id, device.id)}
                    >
                      {t.allow}
                    </HeldButton>
                    <HeldButton
                      held={beats.decided.has(request.id)}
                      onPress={() => denyRequest(request.id)}
                    >
                      {t.refuse}
                    </HeldButton>
                  </>
                ) : (
                  <button type="button" className="btn-quiet" onClick={() => forgetDevice(device.id)}>
                    {t.forget}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
      {hasPairedPhone ? <p className="surface-quiet">{t.capacityLine}</p> : null}
    </div>
  );
}
