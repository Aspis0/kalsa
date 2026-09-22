/**
 * The exclusive full-screen overlay union the new root mounts — the old
 * component's `ActiveOverlay` (`AppShell.tsx:394-404`) minus `miniapp`:
 * the mini-app sheet is reachable only from a transcript card, and the
 * transcript has no mini-app card yet (PARITY row 28), so carrying the kind
 * would be a state nothing can enter. Reported as held, not silently kept.
 */
export type HostOverlay =
  | { kind: "settings" }
  | { kind: "account" }
  | { kind: "pro" }
  | { kind: "help" }
  | { kind: "documents" }
  | { kind: "notes"; focusId?: string }
  | { kind: "personas" }
  | null;
