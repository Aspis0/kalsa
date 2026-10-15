// What `brain_pairing` answers, and the sentences the Phones page derives from
// it: pure, so the page's states and the review bench read the same words.

import type { English } from "../i18n/en/all";

export interface PairedDevice {
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
export interface PairingState {
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
export function hidesOnSeat(device: PairedDevice, devices: PairedDevice[]): boolean {
  return device.pairing_again != null && devices.some((row) => row.id === device.pairing_again);
}

/** The name the app gives a device, in the reader's language. Two fields of a
    device are English words nobody chose and so are never shown: the label Rust
    mints ("This computer", "Paired phone 2"), and `phone`, which is the
    capability sentence Rust writes for a phone's model ("phone with 3 GB of
    model weights", or empty for a phone that has none). Rust numbers a phone
    one above the id it will mint (pairing.rs), which is the number here. */
export function deviceName(t: English["devices"], device: PairedDevice): string {
  return device.kind === "host" ? t.thisComputerLabel : t.deviceLabel(device.id + 1);
}

export function pairedSentence(t: English["devices"], dto: PairingState): string {
  const house = Array.isArray(dto.devices) ? dto.devices : [];
  const phones = house.filter((device) => device.kind !== "host" && !hidesOnSeat(device, house));
  const waiting = phones.filter((device) => device.waiting === true);
  const approved = phones.filter((device) => device.waiting !== true);
  const pending = dto.delivery_pending === true;
  const undelivered = pending ? t.undeliveredClause : "";
  if (approved.length === 0 && waiting.length > 0) {
    if (waiting.length === 1) {
      const owed = pending ? t.owedPending : "";
      return t.waitingNamed(deviceName(t, waiting[0]), owed);
    }
    return t.waitingCount(waiting.length, undelivered);
  }
  if (waiting.length > 0) {
    return waiting.length === 1
      ? t.mixedOne(phones.length, undelivered)
      : t.mixedMany(phones.length, waiting.length, undelivered);
  }
  // No phone is admitted yet, so there is none to name: `dto.phone` is the same
  // capability sentence, and the person's own phone is what the sentence is
  // about.
  if (approved.length === 0) {
    return pending ? t.savedPending(t.yourPhone) : t.worksWith(t.yourPhone);
  }
  if (approved.length === 1) {
    const name = deviceName(t, approved[0]);
    return pending ? t.savedPending(name) : t.worksWith(name);
  }
  return pending ? t.worksWithCountPending(approved.length) : t.worksWithCount(approved.length);
}

// Whether every phone in the house still waits for the owner's OK. The
// headline speaks for the house: while nothing is approved, "Paired" would
// claim a working phone; a mixed house keeps it for the approved ones.
export function everyPhoneWaiting(devices: PairedDevice[] | undefined): boolean {
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
export function tailscaleNote(
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
