export type SurfaceKey =
  | "brain"
  | "chat"
  | "room"
  | "models"
  | "server"
  | "devices"
  | "settings"
  | "help";

export interface SurfaceDefinition {
  key: SurfaceKey;
  // Machine pages describe this computer; app pages remain useful with Kalsa off.
  group: "machine" | "app";
}

// Home lists machine pages; app pages are reached through the shell.
export const SURFACES: SurfaceDefinition[] = [
  // `Server` is here because it reports this machine's own server — its state,
  // its measured decode rate, its connected devices — and its one action turns
  // that machine's brain on or off. Nothing on it is a preference of the app.
  { key: "models", group: "machine" },
  { key: "server", group: "machine" },
  { key: "devices", group: "machine" },
  { key: "settings", group: "app" },
  { key: "help", group: "app" },
];
