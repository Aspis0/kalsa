// The brain's two reads, faked for harness runs in a browser that has no
// Tauri: `brain_state` and `brain_host_credential` — the only pair the app
// needs to find its server, since the endpoint arrives as the state's and
// the token as the credential (`withBrainDefaults` reads them and nothing
// else).
//
// The answers live in `window.__STUB_BRAIN__` and are read when `invoke`
// RUNS, not when this installer runs — so a tool stub installed before or
// after this one keeps the brain, and one installed later replaces this
// installer's `__TAURI__` without losing the answers. Harness-only: chat/src
// never assigns `window.__TAURI__`, and the built bundle carries none of
// this (proven by grep in the removal round's report).
export function installBrainStub(brain) {
  window.__STUB_BRAIN__ = brain;
  if (window.__TAURI__) return; // a tool stub is already in place; it reads __STUB_BRAIN__ too
  window.__TAURI__ = {
    core: {
      invoke: async (command) => {
        const stub = window.__STUB_BRAIN__;
        if (command === "brain_state") return stub?.state ?? null;
        if (command === "brain_host_credential") return stub?.credential ?? null;
        return null;
      },
    },
    event: { listen: () => Promise.resolve(() => {}) },
  };
}
