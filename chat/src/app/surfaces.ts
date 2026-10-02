export type SurfaceKey =
  | "brain"
  | "chat"
  | "room"
  | "models"
  | "server"
  | "devices"
  | "settings";

export interface SurfaceDefinition {
  key: SurfaceKey;
  /**
   * Which side of the line this page is on. `machine` describes this computer
   * and what runs on it; `app` is a preference of this program — appearance,
   * the model, the web-search switch — and it means something with
   * the brain switched off. The brain page lists the first; the crescent
   * carries the second. One list, so nothing can be on both.
   */
  group: "machine" | "app";
}

/**
 * The settings surfaces, carried by the brain page — the app's home. The
 * brain, the chat and the room are not on this list on purpose
 * (THE-BRAIN-IS-THE-HOME.md §1, §5): the chat is reached by writing in the
 * bar, the room sits beside it, and neither is ever a tab.
 */
export const SURFACES: SurfaceDefinition[] = [
  // `Server` is here because it reports this machine's own server — its state,
  // its measured decode rate, its connected devices — and its one action turns
  // that machine's brain on or off. Nothing on it is a preference of the app.
  { key: "models", group: "machine" },
  { key: "server", group: "machine" },
  { key: "devices", group: "machine" },
  { key: "settings", group: "app" },
];
