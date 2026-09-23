type ShellLocation = "phone" | "server";

type ShellLocationLabels = {
  local: string;
  computer: string;
};

/** Short fallback labels for locations when the host has no status override. */
export function shellLocationLabel(
  location: ShellLocation,
  labels: ShellLocationLabels,
): string {
  return location === "phone" ? labels.local : labels.computer;
}
