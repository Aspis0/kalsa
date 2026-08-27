/**
 * Parse kalsa://share?text= / kalsa://share?file= deep links produced by
 * the Android share-in plugin (or any caller that already rewrote extras).
 */

export const SHARE_TEXT_CAP = 20_000;
/** Cap for reading a shared .txt/.md file before `readAsStringAsync`. */
export const SHARE_TEXT_FILE_MAX_BYTES = 256 * 1024;

/** Merge a share payload into an existing composer draft. Cap 20k. */
export function mergeSharePrefill(
  existing: string,
  incoming: string,
  cap: number = SHARE_TEXT_CAP,
): string {
  const shared = typeof incoming === "string" ? incoming.slice(0, cap) : "";
  const prev = typeof existing === "string" ? existing : "";
  if (!prev.trim()) return shared;
  if (!shared) return prev.slice(0, cap);
  const merged = `${prev.replace(/\s+$/, "")}\n\n${shared}`;
  return merged.slice(0, cap);
}

export type ShareInPayload =
  | { kind: "text"; text: string }
  | { kind: "file"; uri: string };

export function normalizeShareFileUri(raw: string): string {
  if (typeof raw !== "string") return "";
  const s = raw.trim();
  if (!s) return "";
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) return s;
  const path = s.startsWith("/") ? s : `/${s}`;
  return `file://${path}`;
}

export function parseShareUrl(url: string | null | undefined): ShareInPayload | null {
  if (!url || typeof url !== "string") return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const scheme = parsed.protocol.replace(/:$/, "").toLowerCase();
  if (scheme !== "kalsa") return null;
  const host = (parsed.hostname || "").toLowerCase();
  const path = (parsed.pathname || "").replace(/^\/+|\/+$/g, "").toLowerCase();
  if (host !== "share" && path !== "share") return null;

  const text = parsed.searchParams.get("text");
  if (typeof text === "string" && text.length > 0) {
    return { kind: "text", text: text.slice(0, SHARE_TEXT_CAP) };
  }
  const file = parsed.searchParams.get("file");
  if (typeof file === "string" && file.length > 0) {
    const uri = normalizeShareFileUri(file);
    if (!uri) return null;
    return { kind: "file", uri };
  }
  return null;
}
