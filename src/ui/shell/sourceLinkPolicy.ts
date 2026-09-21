/**
 * Which source chip may be tapped, and what host it prints (DESIGN.md §2.5).
 *
 * Pure, and in its own module, because "only a public `http(s)` address is
 * tappable; `javascript:`, `data:`, `file:` and the machine's own server stay
 * text with reduced emphasis" is a POLICY — and a policy written inside a
 * component is a policy nothing in this stack can test (the jest stack is
 * `node` with no render harness; see the proof regime in DESIGN.md). So the
 * decision lives here and the chip only draws it.
 *
 * The scheme half of the rule is NOT re-derived: `isSafeHttpUrl` in
 * `src/util/url.ts` already parses a scheme instead of substring-matching it,
 * and rejects the raw whitespace, control and invisible-format characters that
 * can rewrite an authority ("https://example.com\u200b@evil.com"). This module
 * adds the host half — no loopback, no LAN, no link-local, no mDNS — and the
 * host the chip displays.
 *
 * Nothing here fetches anything, and `transcriptNoFetch.test.ts` reads this
 * file and the component to keep it that way: fetching a favicon for a source
 * chip would tell every domain the user searched that the phone had looked at
 * it, which is the desktop's stated rule and matters more on a phone.
 */
import { isSafeHttpUrl } from "../../util/url";

/** A URL's scheme, host and port, hand-parsed. `new URL()` is partial in React
 *  Native (see `src/util/url.ts`), so node and the device would disagree. */
type Authority = {
  scheme: string;
  /** Lowercased, brackets kept on an IPv6 literal, no `www.` handling here. */
  host: string;
  /** Digits only; "" when the address carries no port. */
  port: string;
};

const AUTHORITY = /^([a-zA-Z][a-zA-Z\d+\-.]*):\/\/([^/?#]+)/;

/** Split `host:port`, honouring the brackets of an IPv6 literal. */
function splitHostPort(hostPort: string): { host: string; port: string } {
  if (hostPort.startsWith("[")) {
    const end = hostPort.indexOf("]");
    if (end < 0) return { host: hostPort, port: "" };
    return { host: hostPort.slice(0, end + 1), port: hostPort.slice(end + 1).replace(/^:/, "") };
  }
  const colon = hostPort.lastIndexOf(":");
  if (colon < 0) return { host: hostPort, port: "" };
  return { host: hostPort.slice(0, colon), port: hostPort.slice(colon + 1) };
}

/** The scheme/authority of an absolute URL, or null when there is none (which
 *  is the case for `data:`, `javascript:` and a bare path). */
function authorityOf(url: string): Authority | null {
  const match = typeof url === "string" ? AUTHORITY.exec(url.trim()) : null;
  if (!match) return null;
  const raw = match[2];
  // Userinfo is not part of the host, and showing it would print a credential.
  const at = raw.lastIndexOf("@");
  const { host, port } = splitHostPort(at >= 0 ? raw.slice(at + 1) : raw);
  return { scheme: match[1].toLowerCase(), host: host.toLowerCase(), port };
}

function defaultPortFor(scheme: string): string {
  if (scheme === "http") return "80";
  if (scheme === "https") return "443";
  return "";
}

/** The host a chip prints: lowercased, `www.` dropped, a trailing dot dropped,
 *  and the port kept only when it is not the scheme's default. Empty when the
 *  address has no authority to print. */
export function hostOf(url: string): string {
  const authority = authorityOf(url);
  if (authority === null) return "";
  const bare = authority.host.replace(/^www\./, "").replace(/\.$/, "");
  if (bare === "") return "";
  return authority.port !== "" && authority.port !== defaultPortFor(authority.scheme)
    ? `${bare}:${authority.port}`
    : bare;
}

/** 127/8, 10/8, 0/8, 192.168/16, 172.16-31/12, 169.254/16, 100.64-127/10 (CGNAT). */
function isLocalIpv4(host: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  const a = Number(match[1]);
  const b = Number(match[2]);
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

/**
 * True for a host that resolves to this machine or to the network it sits on:
 * loopback, the private and link-local ranges, the CGNAT range, mDNS and
 * `.localhost` names, IPv6 loopback, link-local (fe80::/10) and unique-local
 * (fc00::/7) addresses, IPv4-mapped IPv6, and any single-label name — a name
 * with no dot is not a public name, it is a host on the LAN or nothing.
 *
 * Takes the bare host, with or without brackets and with or without a port, so
 * a caller cannot get the answer wrong by forgetting to split them.
 */
export function isLocalNetworkHost(host: string): boolean {
  if (typeof host !== "string") return false;
  let bare = host.trim().toLowerCase().replace(/\.$/, "");
  // An IPv6 literal is bracketed when it carries a port; inside the brackets a
  // colon is part of the address, not a port separator.
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(bare);
  if (bracketed) {
    bare = bracketed[1];
  } else if ((bare.match(/:/g) ?? []).length === 1) {
    // Exactly one colon and no brackets: a trailing `:port`.
    bare = bare.replace(/:\d+$/, "");
  }
  if (bare === "::" || bare === "::1") return true;
  if (bare.startsWith("::ffff:")) return isLocalIpv4(bare.slice(7));
  // fe80::/10 link-local, fc00::/7 unique-local.
  if (/^fe[89ab][0-9a-f]?:/.test(bare)) return true;
  if (/^f[cd][0-9a-f]{0,2}:/.test(bare)) return true;
  if (isLocalIpv4(bare)) return true;
  if (
    bare === "localhost" ||
    bare.endsWith(".localhost") ||
    bare.endsWith(".local") ||
    bare.endsWith(".internal")
  ) {
    return true;
  }
  // A global IPv6 literal is public; a single-label name is not.
  if (bare.includes(":")) return false;
  return !bare.includes(".");
}

/** How much of an address a chip prints when it has no host to show. */
const FALLBACK_TEXT_MAX = 48;

/**
 * The chip's own words when no host can be parsed, in this order: the source's
 * title, then the address clipped. The address is clipped because a source can
 * be a `data:` URL whose text would otherwise fill the band.
 */
function fallbackText(url: string, title: string): string {
  const trimmed = title.trim();
  if (trimmed !== "") return trimmed;
  const raw = typeof url === "string" ? url.trim() : "";
  return raw.length > FALLBACK_TEXT_MAX ? `${raw.slice(0, FALLBACK_TEXT_MAX)}…` : raw;
}

export type SourceChipDecision = {
  /** True only for a public `http(s)` address: the chip is a link then. */
  tappable: boolean;
  /** What the chip prints next to its citation index: the host, or the
   *  fallback above when there is no host. Never empty when the address has any
   *  text in it. */
  text: string;
};

/**
 * The whole policy for one source: may it be tapped, and what does it say.
 *
 * `tappable` requires all of: a parsed scheme of exactly http/https, an
 * authority, and a host that is not this machine's own network.
 */
export function sourceChipDecision(url: string, title = ""): SourceChipDecision {
  const authority = authorityOf(url);
  if (authority === null) {
    return { tappable: false, text: fallbackText(url, title) };
  }
  const host = hostOf(url);
  const tappable =
    isSafeHttpUrl(url) && host !== "" && !isLocalNetworkHost(authority.host);
  return { tappable, text: host !== "" ? host : fallbackText(url, title) };
}
