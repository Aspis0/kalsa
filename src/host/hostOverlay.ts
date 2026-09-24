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
 */
import { normalizeMiniapp } from "../domain/askAssistant";
import type { AskAssistantMiniapp } from "../domain/askAssistant";

export type HostOverlay =
  | { kind: "settings" }
  | { kind: "account" }
  | { kind: "pro"; returnTo?: "account" | "settings" }
  | { kind: "help" }
  | { kind: "documents" }
  | { kind: "conversations" }
  | { kind: "notes"; focusId?: string }
  | { kind: "personas" }
  | { kind: "miniapp"; miniapp: AskAssistantMiniapp }
  | null;

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
export function withMiniappOverlay(previous: HostOverlay, raw: unknown): HostOverlay {
  if (previous && previous.kind !== "miniapp") return previous;
  const miniapp = normalizeMiniapp(raw);
  if (!miniapp) return previous;
  return { kind: "miniapp", miniapp };
}
