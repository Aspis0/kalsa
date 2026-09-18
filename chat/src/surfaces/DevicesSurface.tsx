import { useCallback, useEffect, useState } from "react";
import type { SurfaceKey } from "../app/surfaces";
import { available, invoke } from "../lib/tauri";
import "./surfaces.css";

const POLL_MS = 2000;

// The approved ways to say the square is the way in, that it was replaced,
// and who may use it. dev/smoke.mjs keeps its own copy of these on the
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
  failure?: "could-not-save" | "could-not-read" | "service-unavailable" | null;
}

// The paired sentence must be true for whatever the house holds: one device
// is named — naming it IS naming the house — while several are counted,
// because naming one of many reads as if the others were not real.
function pairedSentence(dto: PairingState): string {
  const devices = Array.isArray(dto.devices) ? dto.devices : [];
  const pending = dto.delivery_pending === true;
  if (devices.length === 0) {
    return pending
      ? `This computer saved the connection for ${dto.phone ?? "your phone"}; the phone still needs to receive it.`
      : `This computer now works with ${dto.phone ?? "your phone"}.`;
  }
  if (devices.length === 1) {
    const name = devices[0].phone ?? devices[0].label ?? dto.phone ?? "your phone";
    return pending
      ? `This computer saved the connection for ${name}; the phone still needs to receive it.`
      : `This computer now works with ${name}.`;
  }
  return pending
    ? `This computer now works with ${devices.length} paired devices; the newest is still waiting to receive its connection.`
    : `This computer now works with ${devices.length} paired devices.`;
}

function doorNote(port: number | null | undefined): string | null {
  return typeof port === "number" && Number.isInteger(port) && port > 0
    ? `Run for Tailscale: tailscale serve ${port}`
    : null;
}

interface DevicesSurfaceProps {
  onNavigate: (surface: SurfaceKey) => void;
}

// The Pairing surface: the phone scans, nobody types. The square on screen is
// the ceremony's payload as SVG from kalsa-pairing's qr_svg(payload) —
// generated on this machine, so the page may inject it as markup; it is a
// credential on screen and is never logged anywhere.
export function DevicesSurface({ onNavigate }: DevicesSurfaceProps) {
  const [state, setState] = useState<PairingState | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    let next: PairingState | null = null;
    if (available()) {
      try {
        next = await invoke<PairingState>("brain_pairing");
      } catch {
        next = null; // unknown, not idle
      }
    }
    setState(next);
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  function retry(): void {
    void invoke("brain_pairing_retry").catch(() => {});
  }

  function forgetDevice(id: number): void {
    void invoke("brain_pairing_forget_device", { id }).catch(() => {});
  }

  function forgetAndRefresh(): void {
    invoke("brain_pairing_forget")
      .then(() => void refresh())
      .catch(() => {});
  }

  // Everything on the panel is decided here, so a state cannot leave a stale
  // square or a half-cleared button behind.
  let headline: string | null = null;
  let sentence: string;
  let qrSvg: string | null = null;
  let fresh: string | null = null;
  let note: string | null = null;
  let button: string | null = null;
  let alt: string | null = null;
  let onAction: () => void = () => {};
  let onAlt: () => void = () => {};
  let devices: PairedDevice[] = [];

  if (!state) {
    onAction = () => void refresh();
    sentence = "This page could not check whether a phone is connected. Trying again usually works.";
    button = "Try again";
  } else {
    switch (state.state) {
      case "idle":
        onAction = () => onNavigate("server");
        sentence = "This computer is not running yet, so there is nothing for your phone to connect to.";
        button = "Go to Status";
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
        break;
      case "claiming":
        onAction = retry;
        sentence = "A phone is connecting right now.";
        button = "Cancel";
        break;
      case "paired":
        onAction = retry;
        headline = "Paired";
        sentence = pairedSentence(state);
        button = "Pair another phone";
        note = doorNote(state.door_port);
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
          button = "Go to Status";
          break;
        }
        onAction = retry;
        headline = "Could not finish";
        sentence =
          "Your phone connected, but this computer could not save the connection. Trying again usually works.";
        button = "Try again";
        break;
      default:
        onAction = () => void refresh();
        sentence = "This page could not check whether a phone is connected. Trying again usually works.";
        button = "Try again";
    }
  }

  return (
    <div className="surface-page">
      <h2>Pairing</h2>
      {headline ? <p className="surface-headline">{headline}</p> : null}
      <p className="surface-sentence">{sentence}</p>
      {qrSvg ? <div className="surface-qr" dangerouslySetInnerHTML={{ __html: qrSvg }} /> : null}
      {fresh && FRESH_LINES[fresh] ? <p className="surface-quiet">{FRESH_LINES[fresh]}</p> : null}
      {note ? <p className="surface-quiet">{note}</p> : null}
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
      {devices.length > 0 ? (
        <div className="surface-devices">
          {devices.map((device) => (
            <div key={device.id} className="surface-device">
              <span className="surface-device-name">{device.label ?? `device ${device.id}`}</span>
              <span className="surface-device-detail">{device.phone ?? ""}</span>
              <button type="button" className="btn-quiet" onClick={() => forgetDevice(device.id)}>
                Forget
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
