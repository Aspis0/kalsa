// The brain's reads, faked for harness runs in a browser that has no Tauri:
// `brain_state` and `brain_host_credential` find the server (the endpoint
// arrives as the state's and the token as the credential), and the reads the
// page makes on start-up answer with fixed values. A page whose capability
// read is unanswered stays blank by design, so those reads must not throw.
//
// A scenario's own `answers` (command → value) outrank the start-up ones.
// The answers live in `window.__STUB_BRAIN__` and are read when `invoke`
// RUNS, not when this installer runs — so a tool stub installed before or
// after this one keeps the brain, and one installed later replaces this
// installer's `__TAURI__` without losing the answers. Harness-only: chat/src
// never assigns `window.__TAURI__`, and the built bundle carries none of
// this (proven by grep in the removal round's report).
import { readFileSync } from "node:fs";

// The app's version, as the binary is built from the workspace manifest.
// Callers pass it in `appVersion`: the function below is serialised into the
// page, where this module's own bindings do not exist.
export const APP_VERSION = /\[workspace\.package\][^[]*?version = "([^"]+)"/.exec(
  readFileSync(new URL("../../../Cargo.toml", import.meta.url), "utf8"),
)[1];

// Serialised into the page with the function, so it must live inside it.
export function installBrainStub(brain) {
  window.__STUB_BRAIN__ = brain;
  const startUpAnswers = {
    window_hidden: false,
    brain_app_version: brain.appVersion,
    brain_telemetry_status: { enabled: false, noticeSeen: true },
    brain_capability: { kind: "unmeasured", chosen: true, chosen_model: "Liquid LFM 2.5" },
    // The stored devices, as a page that wants the house and no ceremony with
    // it reads them. Empty by default: a scenario that renders a phone row
    // declares its own under `answers`, and a stub that answered the Pairing
    // page's full read instead would mint a square behind its back.
    brain_pairing_devices: [],
    // The owner's name for a phone. A scenario that renames declares the
    // devices it wants in `answers`; here the write is accepted and dropped,
    // which is enough for a harness that only presses the button and watches
    // the refusal path.
    brain_pairing_set_device_name: null,
  };
  // A tool stub installed earlier answers the start-up reads from here.
  window.__STUB_START_UP__ = startUpAnswers;
  if (window.__TAURI__) return; // a tool stub is already in place; it reads __STUB_BRAIN__ too
  window.__TAURI__ = {
    core: {
      invoke: async (command, args) => {
        const stub = window.__STUB_BRAIN__;
        // Every call, in order, so a scenario can read which commands a click sent.
        (window.__STUB_CALLS__ ??= []).push([command, args ?? null]);
        if (command === "brain_state") return stub?.state ?? null;
        if (command === "brain_host_credential") return stub?.credential ?? null;
        if (stub?.answers && Object.hasOwn(stub.answers, command)) return stub.answers[command];
        if (Object.hasOwn(startUpAnswers, command)) return startUpAnswers[command];
        // An undeclared command is a gap in the SCENARIO, not a null to
        // swallow: the rejection names it, so a failing check says which
        // declaration is missing instead of passing on a quiet undefined.
        throw new Error(`brain-stub: scenario did not declare ${command}`);
      },
    },
    event: { listen: () => Promise.resolve(() => {}) },
  };
}
