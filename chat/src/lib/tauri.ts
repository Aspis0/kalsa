// The single door to the Rust side. Outside the Tauri webview — this app in
// a plain browser — there is nothing to call: `available()` is false and the
// surfaces render their unknown state instead of half-working against a
// missing backend.

interface TauriCore {
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
}

interface TauriEvents {
  listen: (event: string, handler: (payload: unknown) => void) => Promise<() => void>;
}

declare global {
  interface Window {
    __TAURI__?: { core?: TauriCore; event?: TauriEvents };
  }
}

export function available(): boolean {
  return Boolean(window.__TAURI__?.core?.invoke);
}

// Rejects when the command itself fails; callers turn the error into a
// sentence on the page. Callers check available() first — outside the
// webview the access below throws, exactly like the unavailable door.
export function invoke<T = unknown>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  return window.__TAURI__!.core!.invoke(command, args) as Promise<T>;
}

// Subscribes to a backend event and resolves to the unlisten function.
// Outside the webview there is no bus: the caller gets one that does
// nothing, so every surface's cleanup is uniform.
//
// The handler is given the PAYLOAD, which is what its type says and what
// every caller wants. Tauri hands the listener an envelope --
// `{ event, id, payload }` -- and passing that straight through made the
// declared type a lie: the brain's only listener stored the envelope, so
// every walk step arrived with `kind` undefined and the first screen fell
// back to "Getting this computer ready" for the whole walk, download
// included. Unwrapped here, once, rather than in each caller.
export function listen(event: string, handler: (payload: unknown) => void): Promise<() => void> {
  if (!available()) return Promise.resolve(() => {});
  return window.__TAURI__!.event!.listen(event, (envelope: unknown) => {
    const carried =
      envelope && typeof envelope === "object" && "payload" in envelope
        ? (envelope as { payload: unknown }).payload
        : envelope;
    handler(carried);
  });
}
