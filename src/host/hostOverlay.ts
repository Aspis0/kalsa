/**
 * The exclusive full-screen overlay union the new root mounts: the old
 * component's `ActiveOverlay` (`AppShell.tsx:394-404`), `miniapp` kind
 * RESTORED.
 *
 * Why it was deleted, and why the deletion is now reversed: the kind is
 * entered only from a transcript card (`AppShell.tsx:7035-7046`), and when
 * this union was cut the transcript had no mini-app card (PARITY row 28), so
 * carrying the kind would have been a state nothing could enter — reported
 * as held, not silently kept. The card now exists (`MiniappCard.tsx`, fed by
 * `messageMapper.ts`), so the kind is honest again; the reason stays here so
 * the next reader sees the deletion was reasoned, not lost.
 *
 * The kind also carries the widget-state write-back (`onStateChange`): the
 * card opens it, so only here can a tick find its message again — the
 * closure binds the message id at open time and writes through the history
 * host (`miniappStateWrite.ts`).
 */
import { useCallback, useRef, type Dispatch, type SetStateAction } from "react";
import { normalizeMiniapp } from "../domain/askAssistant";
import type { AskAssistantMiniapp } from "../domain/askAssistant";
import { writeMiniappState, type MiniappStateHost } from "./miniappStateWrite";

export type HostOverlay =
  | { kind: "settings" }
  | { kind: "account" }
  | { kind: "pro"; returnTo?: "account" | "settings" }
  | { kind: "help" }
  | { kind: "documents" }
  | { kind: "conversations" }
  | { kind: "notes"; focusId?: string }
  | { kind: "personas" }
  | {
      kind: "miniapp";
      miniapp: AskAssistantMiniapp;
      /** The widget state's next value, bound to its message id at open. */
      onStateChange?: (state: Record<string, unknown>) => void;
    }
  /** The one paired computer's room (v1: no picker — see `useRoomPairing`). */
  | { kind: "room"; localId: string }
  | null;

/** What the card hands the opener besides the envelope: the message whose
 *  state the widgets write back into, and the host that stores it. */
export type MiniappOpenIo = {
  messageId?: string;
  history?: MiniappStateHost;
};

/**
 * The controller's open policy (`AppShell.tsx:7035-7046`): a mini-app open
 * is IGNORED while another exclusive overlay is up (that overlay stays until
 * the user closes it); `null` and a mini-app already open both give way, so
 * a second card replaces the sheet. The payload is re-normalized here — the
 * card carries the message's envelope, and an envelope the domain layer
 * refuses opens nothing rather than a sheet of garbage (the controller
 * cast blindly at `AppShell.tsx:7046`; this build has the normalizer
 * already on the restore path, so the sheet's precondition is checked, not
 * assumed).
 */
export function withMiniappOverlay(
  previous: HostOverlay,
  raw: unknown,
  io?: MiniappOpenIo,
): HostOverlay {
  if (previous && previous.kind !== "miniapp") return previous;
  const miniapp = normalizeMiniapp(raw);
  if (!miniapp) return previous;
  const { messageId, history } = io ?? {};
  if (!messageId || !history) return { kind: "miniapp", miniapp };
  return {
    kind: "miniapp",
    miniapp,
    onStateChange: (state) => writeMiniappState(history, messageId, state),
  };
}

export function useMiniappOpen(
  setOverlay: Dispatch<SetStateAction<HostOverlay>>,
  history?: MiniappStateHost,
) {
  // Kept in a ref so the callback stays identity-stable while the history
  // host hands out a fresh object every render (the transcript memoizes on
  // this prop's identity).
  const historyRef = useRef(history);
  historyRef.current = history;
  return useCallback(
    (miniapp: unknown, messageId: string) =>
      setOverlay((previous) =>
        withMiniappOverlay(previous, miniapp, { messageId, history: historyRef.current }),
      ),
    [setOverlay],
  );
}
