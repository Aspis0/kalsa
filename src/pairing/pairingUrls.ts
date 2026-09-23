export type PairingUrlPrefill = { doorUrl: string; deskUrl: string };

export function isAllowedPairingUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return false;
    if (parsed.protocol === "https:") return true;
    if (parsed.protocol !== "http:") return false;
    const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0:0:0:0:0:0:0:1";
  } catch {
    return false;
  }
}

/** Seed both editable fields from the already-configured host; edits stay independent. */
export function pairingUrlPrefill(configuredDoorUrl: string): PairingUrlPrefill {
  const trimmed = configuredDoorUrl.trim();
  if (!trimmed) return { doorUrl: "", deskUrl: "" };
  try {
    const parsedDoor = new URL(trimmed);
    if (parsedDoor.protocol !== "http:" && parsedDoor.protocol !== "https:") {
      return { doorUrl: "", deskUrl: "" };
    }
    if (parsedDoor.username || parsedDoor.password) return { doorUrl: "", deskUrl: "" };
    parsedDoor.search = "";
    parsedDoor.hash = "";
    const doorUrl = parsedDoor.toString().replace(/\/+$/, "");
    const parsedDesk = new URL(parsedDoor.origin);
    parsedDesk.port = "8443";
    return { doorUrl, deskUrl: parsedDesk.toString().replace(/\/+$/, "") };
  } catch {
    return { doorUrl: "", deskUrl: "" };
  }
}
