export type SurfaceKey =
  | "brain"
  | "chat"
  | "models"
  | "server"
  | "devices"
  | "advanced"
  | "settings";

export interface SurfaceDefinition {
  key: SurfaceKey;
  label: string;
}

/**
 * The settings surfaces, carried by the brain page — the app's home. The
 * brain and the chat are not on this list on purpose (THE-BRAIN-IS-THE-HOME.md
 * §1, §5): the chat is reached by writing in the bar, never by selecting a
 * tab, and surfaces live in this one place.
 */
export const SURFACES: SurfaceDefinition[] = [
  { key: "models", label: "Models" },
  { key: "server", label: "Server" },
  { key: "devices", label: "Devices" },
  { key: "advanced", label: "Advanced" },
  { key: "settings", label: "Settings" },
];
