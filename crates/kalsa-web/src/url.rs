//! Which addresses this crate will talk to, and which address it will actually
//! connect to.
//!
//! Two layers, because spelling alone is not an SSRF boundary. [`fetchable`]
//! is the cheap first pass over the URL text: canonical dotted-quad IPv4 that
//! is publicly routable, or a DNS name with at least two labels and an
//! alphabetic TLD. Shorthand IPv4 (`http://2130706433/`), IPv6 literals,
//! userinfo, percent-encoded authorities and backslashes are refused without
//! being resolved, because predicting a resolver's reading of a clever host is
//! how a gate is bypassed. Same shape as the phone's gate, kalsa
//! `src/agent/webFetchTool.ts` `isPubliclyRoutableHttpUrl`.
//!
//! Spelling is not enough, and the second layer is the one that matters:
//! `foo.127.0.0.1.nip.io` is a perfectly boring name that resolves to loopback,
//! and a hostile name can resolve publicly while it is being checked and
//! privately when the request is made. So the agent is built with
//! [`resolver`], which resolves the name and keeps only public addresses, and
//! `ureq` connects to one of the addresses that were returned. Nothing is
//! resolved twice.

use std::io;
use std::net::{IpAddr, SocketAddr, ToSocketAddrs};

/// Reserved suffixes that never name a public page. `.localhost` and `.local`
/// are resolved to loopback by RFC 6761 and mDNS; nothing here should ever
/// read this machine's own services.
const RESERVED_SUFFIXES: [&str; 4] = ["localhost", "local", "internal", "home.arpa"];

/// True when `url` is an http(s) URL on a publicly routable host, judged by
/// its spelling alone. The DNS half of the decision is [`resolver`]'s.
pub(crate) fn fetchable(url: &str) -> bool {
    let s = url.trim();
    if s.is_empty() || !s.is_ascii() {
        return false;
    }
    // A backslash in the authority is read as a path by one library and as a
    // separator by another; whitespace and control bytes are never valid.
    if s.bytes().any(|b| b == b'\\' || b <= 0x20 || b == 0x7f) {
        return false;
    }

    let rest = match s.split_once("://") {
        Some((scheme, rest))
            if scheme.eq_ignore_ascii_case("http") || scheme.eq_ignore_ascii_case("https") =>
        {
            rest
        }
        _ => return false,
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.is_empty() || authority.contains('@') || authority.contains('%') {
        return false;
    }
    // Bracketed IPv6 and anything else with a bracket is refused outright.
    if authority.contains('[') || authority.contains(']') {
        return false;
    }

    let host = match authority.rsplit_once(':') {
        Some((host, port)) => {
            if port.is_empty() || port.len() > 5 || !port.bytes().all(|b| b.is_ascii_digit()) {
                return false;
            }
            match port.parse::<u32>() {
                Ok(n) if (1..=65535).contains(&n) => host,
                _ => return false,
            }
        }
        None => authority,
    };
    if host.is_empty() {
        return false;
    }

    // IPv4-shaped means digits and dots and nothing else, so a real domain
    // like `1password.com` or `3m.com` is a name, not a broken address.
    if host.bytes().all(|b| b.is_ascii_digit() || b == b'.') {
        return parse_v4(host).is_some_and(|octets| address_allowed(IpAddr::from(octets)));
    }
    public_name(host)
}

/// `ureq`'s resolver. Resolving is the only place a name becomes an address,
/// and only the addresses returned here are ever connected to.
pub(crate) fn resolver(netloc: &str) -> io::Result<Vec<SocketAddr>> {
    let resolved = netloc.to_socket_addrs()?;
    let kept: Vec<SocketAddr> = resolved.filter(|addr| address_allowed(addr.ip())).collect();
    if kept.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "the name resolves to an address on this machine or a private network",
        ));
    }
    Ok(kept)
}

/// True when this address is on the public internet. The one list the spelling
/// gate and the resolver both answer to.
fn address_allowed(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(v4) => {
            let [a, b, c, _] = v4.octets();
            !(a == 0                       // 0.0.0.0/8, "this network"
                || a == 10                 // 10/8
                || (a == 100 && (64..=127).contains(&b)) // 100.64/10 carrier NAT
                || a == 127                // 127/8 loopback
                || (a == 169 && b == 254)  // 169.254/16 link-local
                || (a == 172 && (16..=31).contains(&b)) // 172.16/12
                || (a == 192 && b == 0 && c == 0) // 192.0.0/24
                || (a == 192 && b == 168)  // 192.168/16
                || (a == 198 && (b == 18 || b == 19)) // 198.18/15 benchmarking
                || a >= 224)               // multicast, reserved, broadcast
        }
        // Global unicast only. Loopback `::1`, link-local `fe80::/10`,
        // unique-local `fc00::/7`, multicast `ff00::/8`, IPv4-mapped
        // `::ffff:a.b.c.d` and NAT64 `64:ff9b::/96` are all outside `2000::/3`.
        IpAddr::V6(v6) => {
            let segments = v6.segments();
            let global = (segments[0] & 0xe000) == 0x2000;
            let documentation = segments[0] == 0x2001 && segments[1] == 0x0db8;
            global && !documentation
        }
    }
}

/// Exactly four decimal octets, no leading zeros.
fn parse_v4(host: &str) -> Option<[u8; 4]> {
    let parts: Vec<&str> = host.split('.').collect();
    if parts.len() != 4 {
        return None;
    }
    let mut octets = [0u8; 4];
    for (index, part) in parts.iter().enumerate() {
        if part.is_empty() || (part.len() > 1 && part.starts_with('0')) || part.len() > 3 {
            return None;
        }
        match part.parse::<u16>() {
            Ok(n) if n <= 255 => octets[index] = n as u8,
            _ => return None,
        }
    }
    Some(octets)
}

/// At least two labels, each ASCII alnum/hyphen with no leading or trailing
/// hyphen, and an alphabetic TLD of two or more letters.
fn public_name(host: &str) -> bool {
    if host.len() > 253 || host.ends_with('.') {
        return false;
    }
    let host = host.to_ascii_lowercase();
    let labels: Vec<&str> = host.split('.').collect();
    if labels.len() < 2 {
        return false;
    }
    for label in &labels {
        if label.is_empty() || label.len() > 63 || label.starts_with('-') || label.ends_with('-') {
            return false;
        }
        if !label.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
            return false;
        }
    }
    let tld = labels[labels.len() - 1];
    if tld.len() < 2 || !tld.bytes().all(|b| b.is_ascii_alphabetic()) {
        return false;
    }
    // `home.arpa` is reserved by its last two labels, not by `arpa` alone.
    let suffix = format!("{}.{}", labels[labels.len() - 2], tld);
    !RESERVED_SUFFIXES.contains(&tld) && !RESERVED_SUFFIXES.contains(&suffix.as_str())
}

#[cfg(test)]
mod tests {
    use super::{fetchable, resolver};

    #[test]
    fn accepts_public_addresses() {
        assert!(fetchable("https://example.com"));
        assert!(fetchable("http://example.com/path?q=1#frag"));
        assert!(fetchable("https://news.ycombinator.com/item?id=1"));
        assert!(fetchable("https://example.com:8443/x"));
        assert!(fetchable("https://93.184.216.34/"));
        assert!(fetchable("HTTPS://Example.COM/"));
    }

    #[test]
    fn accepts_public_names_that_begin_with_a_digit() {
        assert!(fetchable("https://1password.com/"));
        assert!(fetchable("https://3m.com/"));
        assert!(fetchable("https://123abc.example.com/"));
    }

    #[test]
    fn refuses_other_schemes() {
        assert!(!fetchable("file:///etc/passwd"));
        assert!(!fetchable("ftp://example.com/x"));
        assert!(!fetchable("data:text/html,<h1>hi</h1>"));
        assert!(!fetchable("javascript:alert(1)"));
        assert!(!fetchable("example.com/no-scheme"));
    }

    #[test]
    fn refuses_this_machine() {
        assert!(!fetchable("http://127.0.0.1:8130/v1/chat/completions"));
        assert!(!fetchable("http://localhost:8130/"));
        assert!(!fetchable("http://0.0.0.0/"));
        assert!(!fetchable("http://[::1]/"));
    }

    #[test]
    fn refuses_private_and_link_local_ranges() {
        assert!(!fetchable("http://10.0.0.5/"));
        assert!(!fetchable("http://192.168.1.1/"));
        assert!(!fetchable("http://172.16.4.4/"));
        assert!(!fetchable("http://172.31.255.254/"));
        assert!(!fetchable("http://169.254.169.254/latest/meta-data/"));
        assert!(!fetchable("http://100.64.0.1/"));
        assert!(!fetchable("http://198.18.0.1/"));
        assert!(!fetchable("http://224.0.0.1/"));
        // 172.32 is public; the /12 block must not swallow it.
        assert!(fetchable("http://172.32.0.1/"));
    }

    #[test]
    fn refuses_reserved_suffixes() {
        assert!(!fetchable("http://printer.local/"));
        assert!(!fetchable("http://router.internal/"));
        assert!(!fetchable("http://thing.home.arpa/"));
    }

    #[test]
    fn refuses_smuggled_authorities() {
        assert!(!fetchable("https://example.com\\@127.0.0.1/"));
        assert!(!fetchable("https://user@example.com/"));
        assert!(!fetchable("https://exa%6dple.com/"));
        assert!(!fetchable("https://2130706433/"));
        assert!(!fetchable("https://0x7f.0.0.1/"));
        assert!(!fetchable("https://0177.0.0.1/"));
        assert!(!fetchable("https://1.2.3.4.5/"));
        assert!(!fetchable("https://example.com:0/"));
        assert!(!fetchable("https://example.com:99999/"));
        assert!(!fetchable("https://exa mple.com/"));
        assert!(!fetchable("https://exämple.com/"));
        assert!(!fetchable(""));
    }

    /// The half a spelling gate cannot do. Every name a hostile URL could use
    /// to reach this machine ends up here, and here it is an address.
    #[test]
    fn the_resolver_refuses_inward_addresses() {
        assert!(resolver("93.184.216.34:443").is_ok());
        for netloc in [
            "127.0.0.1:8130",
            "10.1.2.3:80",
            "192.168.0.1:80",
            "169.254.169.254:80",
            "172.16.0.1:80",
            "100.64.0.1:80",
            "0.0.0.0:80",
            "224.0.0.1:80",
            "[::1]:80",
            "[fe80::1]:80",
            "[fc00::1]:80",
            "[::ffff:127.0.0.1]:80",
            "[64:ff9b::7f00:1]:80",
        ] {
            assert!(resolver(netloc).is_err(), "{netloc} was allowed");
        }
        assert!(resolver("[2001:4860:4860::8888]:443").is_ok());
        // A name with nothing to resolve is a failure, never an empty list
        // that ureq could read as "try again".
        assert!(resolver("no-such-host.invalid:80").is_err());
    }
}
