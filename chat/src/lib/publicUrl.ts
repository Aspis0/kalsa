/**
 * Whether a string a model or a page wrote may be shown as a link.
 *
 * This is a spelling gate, not the boundary: the real one is in Rust, which
 * resolves the name and refuses addresses on this machine (`kalsa-web`,
 * `url.rs`). What this stops is a transcript — or a page's text — turning an
 * arbitrary string into something the reader can click: `javascript:`, `data:`,
 * `http://127.0.0.1:8130/`, `file://`. Deliberately the same rules as the Rust
 * gate's spelling pass, and deliberately conservative: anything it is unsure
 * about is shown as text.
 */

const RESERVED_TLDS = ["localhost", "local", "internal", "home.arpa"];

/** The URL to link to, or null when the string must stay text. */
export function publicHttpUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || !/^[\x20-\x7e]+$/.test(value)) return null;
  if (value.includes("\\")) return null;

  const scheme = /^(https?):\/\//i.exec(value);
  if (!scheme) return null;
  const rest = value.slice(scheme[0].length);
  const authority = rest.split(/[/?#]/)[0] ?? "";
  if (!authority || authority.includes("@") || authority.includes("%")) return null;
  if (authority.includes("[") || authority.includes("]")) return null;

  const colon = authority.lastIndexOf(":");
  const host = colon >= 0 ? authority.slice(0, colon) : authority;
  if (colon >= 0) {
    const port = authority.slice(colon + 1);
    if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) return null;
  }
  if (!host) return null;

  if (/^[\d.]+$/.test(host)) return isPublicV4(host) ? value : null;
  if (!isPublicName(host)) return null;
  return embedsAddress(host) ? null : value;
}

/**
 * True when the host carries something that reads as an IPv4 literal, dotted or
 * dashed: `127.0.0.1.nip.io`, `192-168-1-1.sslip.io`. Those names are public by
 * every lexical rule and resolve to whoever the reader is — a browser opening
 * the link goes to that address, and this file cannot see it happening.
 */
function embedsAddress(host: string): boolean {
  let run = 0;
  for (const token of host.toLowerCase().split(/[.-]/)) {
    if (/^\d{1,3}$/.test(token) && Number(token) <= 255) {
      run += 1;
      if (run === 4) return true;
      continue;
    }
    run = 0;
  }
  return false;
}

function isPublicV4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return false;
    const value = Number(part);
    if (value > 255) return false;
    octets.push(value);
  }
  const [a, b, c] = octets;
  return !(
    a === 0 ||
    a === 10 ||
    (a === 100 && b >= 64 && b <= 127) ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPublicName(host: string): boolean {
  if (host.length > 253) return false;
  const lower = host.toLowerCase();
  if (lower.endsWith(".")) return false;
  const labels = lower.split(".");
  if (labels.length < 2) return false;
  for (const label of labels) {
    if (!label || label.length > 63) return false;
    if (label.startsWith("-") || label.endsWith("-")) return false;
    if (!/^[a-z0-9-]+$/.test(label)) return false;
  }
  const tld = labels[labels.length - 1];
  if (!/^[a-z]{2,}$/.test(tld)) return false;
  const suffix = `${labels[labels.length - 2]}.${tld}`;
  return !RESERVED_TLDS.includes(tld) && !RESERVED_TLDS.includes(suffix);
}
