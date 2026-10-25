//! Which addresses are refused, proved over a table.
//!
//! The rules themselves are unit-tested where they live, in `guard.rs`. What is
//! proved here is the whole address as a browser hands it over: the spellings
//! that reach the same host, the dot that ends a name, and a name whose
//! destination we had to ask a resolver about.

use kalsa_browser::guard::{self, Refusal, Verdict};

fn refused(url: &str) -> Refusal {
    match guard::verdict(url) {
        Verdict::Refused(refusal) => refusal,
        Verdict::Allow => panic!("{url} must be refused"),
    }
}

/// The dot that ends the whole name is not part of it. Without this,
/// `localhost.` and `router.local.` were ordinary names as far as the rules
/// were concerned.
#[test]
fn a_trailing_dot_does_not_hide_the_name_it_ends() {
    for url in [
        "http://localhost./",
        "http://localhost.:8080/admin",
        "http://LOCALHOST./",
        "http://app.localhost./",
        "http://router.local./",
        "http://printer.local.:9100/",
    ] {
        assert_eq!(refused(url), Refusal::Address, "{url}");
    }
    // An address keeps the dot too: `url` reads it back as the address it is.
    assert_eq!(refused("http://127.0.0.1./"), Refusal::Address);
    assert_eq!(refused("http://[::1]./"), Refusal::Scheme);
}

/// `url` reads the non-decimal spellings of an IPv4 address as the address they
/// are, so all four go through as loopback rather than as four odd names.
#[test]
fn a_decimal_octal_or_hexadecimal_address_is_the_address_it_spells() {
    for url in [
        "http://2130706433/",       // 127.0.0.1 as one number
        "http://0x7f.1/",           // 0x7f.0.0.1
        "http://017700000001/",     // 0177.0.0.1, octal
        "http://127.1/",            // 127.0.0.1 with the last two parts implied
        "https://[::ffff:7f00:1]/", // the same host, IPv6
    ] {
        assert_eq!(refused(url), Refusal::Address, "{url}");
    }

    // And the same trick cannot smuggle a public address past us.
    assert_eq!(guard::verdict("http://134744072/"), Verdict::Allow);
}

/// 100.64.0.0/10 is shared address space, and it is where a tailnet lives.
#[test]
fn a_tailnet_address_is_refused_and_the_two_ends_of_the_range_are_not() {
    for url in [
        "http://100.64.0.1/",
        "http://100.100.100.100/", // the address a Tailscale node carries
        "http://100.127.255.255/",
        "http://100.64.0.0/",
    ] {
        assert_eq!(refused(url), Refusal::Address, "{url}");
    }
    for url in ["http://100.63.255.255/", "http://100.128.0.0/", "http://99.255.255.255/"] {
        assert_eq!(guard::verdict(url), Verdict::Allow, "{url}");
    }
}

#[test]
fn the_addresses_that_mean_this_network_are_refused() {
    for url in ["http://0.0.0.0/", "http://0.1.2.3/", "http://0.255.255.254/"] {
        assert_eq!(refused(url), Refusal::Address, "{url}");
    }
}

/// An IPv4 address can be carried inside an IPv6 one in three spellings, and all
/// three are the same machine.
#[test]
fn an_ipv4_carried_inside_an_ipv6_address_is_refused_in_every_spelling() {
    for url in [
        "http://[::ffff:127.0.0.1]/",     // mapped
        "http://[::127.0.0.1]/",          // compatible, deprecated
        "http://[64:ff9b::7f00:1]/",      // NAT64, the same host
        "http://[64:ff9b::c0a8:1]/",      // NAT64, a private address
        "http://[64:ff9b:1::7f00:1]/",    // NAT64, the local-use prefix
        "http://[64:ff9b:1::c0a8:1]/",
        "http://[::ffff:a00:1]/",         // mapped, in hexadecimal
        "http://[fec0::1]/",              // site local, deprecated
        "http://[fd00::1]/",              // unique local
        "http://[fe80::1]/",              // link local
        "http://[::]/",
    ] {
        assert_eq!(refused(url), Refusal::Address, "{url}");
    }
    // A NAT64 prefix carrying a public address is one.
    assert_eq!(guard::verdict("http://[64:ff9b::5db8:d822]/"), Verdict::Allow);
}

#[test]
fn this_computers_own_network_is_refused() {
    for url in [
        "http://localhost/",
        "http://localhost:8080/admin",
        "http://router.local/",
        "http://127.0.0.1/",
        "http://127.1.2.3/",
        "http://[::1]/",
        "http://[::ffff:127.0.0.1]/",
        "http://192.168.0.1/",
        "http://10.0.0.5/",
        "http://172.16.4.4/",
        "http://169.254.169.254/latest/meta-data/",
    ] {
        assert_eq!(refused(url), Refusal::Address, "{url}");
    }
}

/// A public address next to a private one is the whole point of the check, so
/// the boundary itself is worth a table of its own.
#[test]
fn an_address_one_step_outside_the_refused_ranges_is_not_refused() {
    for url in [
        "https://example.com/",
        "https://sub.example.co.uk/a/b?c=d#e",
        "http://93.184.216.34/",
        "http://8.8.8.8/",
        "http://1.0.0.0/",
        "http://126.255.255.255/",
        "http://128.0.0.0/",
        "http://11.0.0.1/",
        "http://172.15.255.255/",
        "http://172.32.0.1/",
        "http://192.167.255.255/",
        "http://192.169.0.1/",
        "http://169.253.0.1/",
        "https://[2606:4700:4700::1111]/",
        "https://notlocal/",
        "https://example.locally/",
    ] {
        assert_eq!(guard::verdict(url), Verdict::Allow, "{url}");
    }
}

/// A username or a password written into the address is a stranger asking us to
/// send it, and the snapshot would carry it back into the chat.
#[test]
fn an_address_carrying_credentials_is_refused() {
    for url in [
        "https://user@example.com/",
        "https://user:pw@example.com/",
        "https://:pw@example.com/",
        "http://giulia:p4ssw0rd@books.example.com/login",
        "https://token@100.64.0.1/",
    ] {
        assert_eq!(refused(url), Refusal::Credentials, "{url}");
    }
    // An `@` in the path or the query is not credentials.
    assert_eq!(guard::verdict("https://example.com/a@b"), Verdict::Allow);
    assert_eq!(guard::verdict("https://example.com/?to=a@b.example"), Verdict::Allow);
    assert_eq!(guard::verdict("https://example.com/"), Verdict::Allow);
}

#[test]
fn every_scheme_that_is_not_http_or_https_is_refused() {
    for url in [
        "mailto:giulia@example.com",
        "tel:+390000000000",
        "javascript:alert(1)",
        "file:///etc/passwd",
        "data:text/html,<h1>hi</h1>",
        "blob:https://example.com/2b1c",
        "chrome://settings",
        "about:blank",
        "ftp://example.com/x",
        "ws://example.com/socket",
        "",
        "not a url",
        "/relative/path",
    ] {
        assert_eq!(refused(url), Refusal::Scheme, "{url}");
    }
}

/// A name is asked about before it is used, and one that does not answer is
/// refused as well as one that answers wrongly: a destination we could not read
/// is not a destination we know to be harmless.
#[tokio::test]
async fn a_name_that_does_not_resolve_is_refused_as_unchecked() {
    // `.invalid` is reserved and must never resolve (RFC 2606).
    let answer = guard::decide("http://a-name-that-does-not-resolve.invalid/").await;
    assert_eq!(answer, Verdict::Refused(Refusal::Unchecked));
    assert!(!Refusal::Unchecked.reason().contains("invalid"));
}

/// The check must not cost us the web: a name that answers with a public address
/// is allowed, through the same resolver that refused the one above.
#[tokio::test]
async fn a_name_that_resolves_publicly_is_allowed() {
    let answer = guard::decide("https://example.com/").await;
    assert_eq!(answer, Verdict::Allow);
}

/// The rules read the address alone before any resolver is asked, so a refused
/// address costs nothing and cannot be talked round by a resolver that answers.
#[tokio::test]
async fn an_address_refused_on_its_own_is_never_asked_about() {
    for url in ["http://192.168.0.1/", "http://100.64.0.1/", "http://localhost./"] {
        assert_eq!(guard::decide(url).await, Verdict::Refused(Refusal::Address), "{url}");
    }
}