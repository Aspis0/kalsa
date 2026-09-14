// The single door to the Rust side. Outside the Tauri webview — opening
// src/index.html in a browser to check a layout — there is nothing to call:
// `available()` is false and callers render their unknown state instead of
// half-working against a missing backend.

export function available() {
  return Boolean(window.__TAURI__?.core?.invoke);
}

// Rejects when the command itself fails; callers turn the error into a
// sentence on the page.
export function invoke(command, args = {}) {
  return window.__TAURI__.core.invoke(command, args);
}

// Subscribes to a backend event and resolves to the unlisten function.
// Outside the webview there is no bus: the caller gets one that does
// nothing, so the page's cleanup is uniform everywhere it runs.
export function listen(event, handler) {
  if (!available()) return Promise.resolve(() => {});
  return window.__TAURI__.event.listen(event, handler);
}
