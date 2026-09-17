// The Pairing page: the phone scans, nobody types (PLAN.md 4f). The square
// on screen is the ceremony's payload as SVG from kalsa-pairing's
// qr_svg(payload) — generated on this machine, so the page may inject it as
// markup; it is a credential on screen and is never logged anywhere. The
// words are this page's: no ceremony vocabulary (code, binding, token,
// handshake) reaches the screen — the phone and the computer become a pair,
// and that is the whole vocabulary.
//
// The contract below is what the shell hands over — one read, polled; two
// decisions and a retry:
//
//   {
//     kind: "pairing",
//     state: "idle" | "waiting" | "claiming" | "paired" | "failed",
//     qr_svg: string | null,   // the square, when one is on screen
//     refreshed: "expired" | "wrong-code" | null,  // why this square is fresh
//     phone: string | null,    // the latest paired phone's own description
//     devices: [ { id, label, phone } ] | [],  // every paired device
//     delivery_pending: boolean, // saved here, response still needs delivery
//     door_port: number | null, // the local door's actual port, when running
//     failure: "could-not-save" | "could-not-read" | "service-unavailable" | null,
//   }

import { available, invoke } from "../lib/tauri.js";

// The commands are proposals for the shell wiring; until they exist, the
// states page replaces this backend with stubs.
const tauriBackend = {
  async read() {
    if (!available()) return null;
    return invoke("brain_pairing");
  },
  retry() {
    return invoke("brain_pairing_retry");
  },
  forgetDevice(id) {
    return invoke("brain_pairing_forget_device", { id });
  },
  forget() {
    return invoke("brain_pairing_forget");
  },
};

// The paired sentence must be true for whatever the house holds: one
// device is named — naming it IS naming the house — while several are
// counted, because naming one of many reads as if the others were not real.
function pairedSentence(dto) {
  const devices = Array.isArray(dto.devices) ? dto.devices : [];
  const pending = dto.delivery_pending === true;
  if (devices.length === 0) {
    // No list: the one-phone read, exactly as the page has always said it.
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

// The approved ways to say the square is the way in, that it was replaced,
// and who may use it. dev/smoke.mjs keeps its own copy of these on the
// review side and enforces them — rewording here means updating there on
// purpose, or failing the check.
const CAMERA_INSTRUCTION = "Point your phone's camera at the square.";
const AWARENESS =
  "Anyone who can see this square can connect a phone — show it only to yours.";
const REPAIR_PRIMARY = "Pair another phone";
const FORGET_PRIMARY = "Forget";
const CANCEL_PRIMARY = "Cancel";
const FRESH_LINES = {
  expired: "The previous square expired — this one is fresh.",
  "wrong-code": "A square that did not match was replaced — this one is fresh.",
};

function doorNote(port) {
  return Number.isInteger(port) && port > 0 ? `Run for Tailscale: tailscale serve ${port}` : null;
}

const POLL_MS = 2000;

export function mountPairing(root, { goTo = () => {}, backend = tauriBackend } = {}) {
  root.innerHTML = `
    <h2>Pairing</h2>
    <p class="headline" data-el="headline" hidden></p>
    <p class="sentence" data-el="sentence"></p>
    <div class="qr" data-el="qr" hidden></div>
    <p class="quiet" data-el="fresh" hidden></p>
    <p class="quiet" data-el="note" hidden></p>
    <button type="button" class="primary" data-el="action" hidden></button>
    <button type="button" class="secondary" data-el="alt" hidden></button>
    <div data-el="devices" hidden></div>
  `;
  const el = (name) => root.querySelector(`[data-el="${name}"]`);
  const headline = el("headline");
  const sentenceEl = el("sentence");
  const qr = el("qr");
  const freshEl = el("fresh");
  const noteEl = el("note");
  const action = el("action");
  const altEl = el("alt");
  const devicesEl = el("devices");

  let onAction = () => {};
  let onAlt = () => {};

  // Everything on the panel is set here, so a state cannot leave a stale
  // square or a half-cleared button behind.
  function apply({ head = null, text, button = null, alt = null, qrSvg = null, fresh = null, note = null }) {
    headline.hidden = head === null;
    if (head !== null) headline.textContent = head;
    sentenceEl.textContent = text;
    if (qrSvg !== null) {
      qr.hidden = false;
      qr.innerHTML = qrSvg;
    } else {
      qr.hidden = true;
      qr.innerHTML = "";
    }
    if (fresh !== null && FRESH_LINES[fresh]) {
      freshEl.hidden = false;
      freshEl.textContent = FRESH_LINES[fresh];
    } else {
      freshEl.hidden = true;
    }
    noteEl.hidden = note === null;
    if (note !== null) noteEl.textContent = note;
    action.hidden = button === null;
    if (button !== null) action.textContent = button;
    altEl.hidden = alt === null;
    if (alt !== null) altEl.textContent = alt;
  }

  // The house, one row per paired device, each with its own way out. Text
  // only, through textContent — a label is data, never markup.
  function renderDevices(devices) {
    const list = Array.isArray(devices) ? devices : [];
    devicesEl.hidden = list.length === 0;
    devicesEl.innerHTML = "";
    for (const device of list) {
      const row = document.createElement("div");
      const name = document.createElement("span");
      name.textContent = device.label ?? `device ${device.id}`;
      const detail = document.createElement("span");
      detail.textContent = device.phone ?? "";
      const forget = document.createElement("button");
      forget.type = "button";
      forget.textContent = FORGET_PRIMARY;
      forget.addEventListener("click", () => {
        backend.forgetDevice(device.id).catch(() => {});
      });
      row.append(name, detail, forget);
      devicesEl.append(row);
    }
  }

  function render(dto) {
    onAlt = () => {};
    renderDevices(null);
    // The read failed: say so and offer the way back in.
    if (!dto) {
      onAction = () => refresh();
      apply({
        text: "This page could not check whether a phone is connected. Trying again usually works.",
        button: "Try again",
      });
      return;
    }

    switch (dto.state) {
      case "idle":
        onAction = () => goTo("status");
        apply({
          text: "This computer is not running yet, so there is nothing for your phone to connect to.",
          button: "Go to Status",
        });
        break;
      case "waiting":
        // No square yet is its own honest moment, not a camera instruction.
        if (!dto.qr_svg) {
          onAction = () => {};
          apply({ text: "The square is not ready yet — it will appear here in a moment." });
          break;
        }
        onAction = () => {};
        apply({
          text: CAMERA_INSTRUCTION,
          qrSvg: dto.qr_svg,
          fresh: dto.refreshed,
          note: AWARENESS,
        });
        break;
      case "claiming":
        onAction = () => {
          backend.retry().catch(() => {});
        };
        apply({
          text: "A phone is connecting right now.",
          button: CANCEL_PRIMARY,
        });
        break;
      case "paired":
        onAction = () => {
          backend.retry().catch(() => {});
        };
        renderDevices(dto.devices);
        apply({
          head: "Paired",
          text: pairedSentence(dto),
          button: REPAIR_PRIMARY,
          note: doorNote(dto.door_port),
        });
        break;
      case "failed":
        if (dto.failure === "could-not-read") {
          onAction = () => {
            backend.forget().then(() => refresh()).catch(() => {});
          };
          onAlt = () => refresh();
          apply({
            head: "Could not check",
            text: "This computer could not read its existing phone connection. Fixing permissions and trying again may help.",
            button: "Forget and pair again",
            alt: "Try again",
          });
          break;
        }
        if (dto.failure === "service-unavailable") {
          onAction = () => goTo("status");
          apply({
            head: "Pairing unavailable",
            text: "The local pairing service stopped. Restart the app to make pairing available again.",
            button: "Go to Status",
          });
          break;
        }
        onAction = () => {
          backend.retry().catch(() => {});
        };
        onAlt = () => {};
        apply({
          head: "Could not finish",
          text: "Your phone connected, but this computer could not save the connection. Trying again usually works.",
          button: "Try again",
        });
        break;
      default:
        onAction = () => refresh();
        apply({
          text: "This page could not check whether a phone is connected. Trying again usually works.",
          button: "Try again",
        });
    }
  }

  async function refresh() {
    if (!backend) {
      onAction = () => {};
      apply({
        text: "This page works inside the Kalsa Brain app. Open the app on this computer.",
      });
      return;
    }
    let dto = null;
    try {
      dto = await backend.read();
    } catch {
      dto = null; // unknown, not idle
    }
    render(dto);
  }

  action.addEventListener("click", () => onAction());
  altEl.addEventListener("click", () => onAlt());

  return { refresh };
}

export function initPairing(goTo) {
  const page = mountPairing(document.getElementById("page-pairing"), { goTo });
  const tick = () => page.refresh();
  tick();
  setInterval(tick, POLL_MS);
}
