export type SurfaceKey = "chat" | "models" | "server" | "devices" | "advanced" | "settings";

export interface SurfaceDefinition {
  key: SurfaceKey;
  label: string;
}

/**
 * The crescent carries surfaces, not conversations: a small fixed set, like
 * devboule-v2's SURFACES. Six points, six surfaces — no paging, by design.
 */
export const SURFACES: SurfaceDefinition[] = [
  { key: "chat", label: "Chat" },
  { key: "models", label: "Models" },
  { key: "server", label: "Server" },
  { key: "devices", label: "Devices" },
  { key: "advanced", label: "Advanced" },
  { key: "settings", label: "Settings" },
];

export const SURFACE_KEYS = SURFACES.map((s) => s.key);
