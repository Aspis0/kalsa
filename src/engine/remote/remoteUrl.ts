export function isLoopbackHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "::1" ||
    h === "0:0:0:0:0:0:0:1"
  );
}

export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    return parsed.toString();
  } catch {
    return "[invalid-url]";
  }
}

export function normalizeRemoteUrl(
  raw: string,
): { ok: true; url: string } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "empty_url" };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "invalid_url" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "invalid_scheme" };
  }
  parsed.username = "";
  parsed.password = "";
  parsed.hash = "";
  // A query string can carry a credential (?token=…) and this URL is stored in
  // plain AsyncStorage, so it never survives normalization.
  parsed.search = "";
  const href = parsed.toString().replace(/\/+$/, "");
  return { ok: true, url: href };
}

export function joinRemoteApiUrl(base: string, path: string): string {
  const parsed = new URL(base);
  const rel = path.startsWith("/") ? path : `/${path}`;
  let basePath = parsed.pathname.replace(/\/+$/, "");
  if (basePath === "/") basePath = "";
  const baseHasV1 = basePath === "/v1" || basePath.endsWith("/v1");
  if (baseHasV1 && rel.startsWith("/v1/")) {
    parsed.pathname = `${basePath}${rel.slice(3)}`;
  } else if (baseHasV1 && rel === "/v1") {
    parsed.pathname = basePath;
  } else if (baseHasV1 && rel === "/health") {
    parsed.pathname = `${basePath.slice(0, -3)}/health`;
  } else {
    parsed.pathname = `${basePath}${rel}`;
  }
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/+$/, "");
}

export function canSendAuthorization(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:") return true;
    return parsed.protocol === "http:" && isLoopbackHost(parsed.hostname);
  } catch {
    return false;
  }
}

export function isNonLoopback(url: string): boolean {
  try {
    return !isLoopbackHost(new URL(url).hostname);
  } catch {
    return true;
  }
}

export function isHttpUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "http:";
  } catch {
    return false;
  }
}

export function remoteUrlAllowedInThisBuild(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:") return true;
    if (parsed.protocol !== "http:") return false;
    // Loopback http is allowed in release too: traffic never leaves this
    // device, and Android network-security-config permits cleartext only for
    // 127.0.0.1 / localhost / ::1. Gating on __DEV__ made the phone unusable.
    return isLoopbackHost(parsed.hostname);
  } catch {
    return false;
  }
}

/** Null if the URL may be used; otherwise a stable error code. */
export function remoteUrlGateError(url: string): string | null {
  if (!url.trim()) return "remote_brain_url_missing";
  if (!remoteUrlAllowedInThisBuild(url)) return "remote_brain_https_required";
  return null;
}
