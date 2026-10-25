//! The text a person reads and the text a model reads are the same string, so a
//! sender's tracking redirects are shortened in one place: the readable body. The
//! rules that judge a link are not that place, and must keep the real hrefs.

use kalsa_mail::mail::{self, ParsedMail};

const TRACKING: &str = "https://email.nebius.com/e3t/Ctc/X+113/d38dPw04/VVCq4Y4P";

/// A mail whose HTML half is small enough to parse, next to the plain half the
/// sender wrote. `padding` grows the HTML past the converter's cap, which is the
/// case that falls back to that plain half.
fn halves(html_body: &str, plain_body: &str) -> Vec<u8> {
    let boundary = "kalsa-boundary";
    format!(
        "From: Nebius <news@nebius.com>\r\nSubject: Le tue email\r\n\
         Date: Tue, 13 Oct 2026 10:00:00 +0000\r\nMIME-Version: 1.0\r\n\
         Content-Type: multipart/alternative; boundary=\"{boundary}\"\r\n\r\n\
         --{boundary}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n{html_body}\r\n\
         --{boundary}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n{plain_body}\r\n\
         --{boundary}--\r\n"
    )
    .into_bytes()
}

fn body_of(parsed: &ParsedMail) -> &str {
    &parsed.text
}

/// The owner's own newsletter, read the way a mail client would: over the
/// converter's cap, so the body is the sender's alternative. The redirect it
/// wrote must not survive into what the model reads.
#[test]
fn a_body_over_the_html_cap_still_reads_as_a_host() {
    let padding = "p".repeat(17 * 1024);
    let parsed = mail::parse(&halves(
        &format!("<p>{padding}</p><p>Ciao Marco</p>"),
        &format!("logo-nebius\n({TRACKING})\nCiao Marco,"),
    ));
    assert!(parsed.unparsed, "the HTML half was expected to be over the cap");
    assert_eq!(body_of(&parsed), "logo-nebius\n(email.nebius.com)\nCiao Marco,");
}

/// The other branch: small enough to parse, so the body is our own conversion.
/// A URL typed as prose in the HTML reaches that text whole, and is shortened
/// there too — an anchor's href never reaches it at all, on either half.
#[test]
fn a_body_the_converter_read_also_drops_the_whole_url() {
    let parsed = mail::parse(&halves(
        &format!("<p>Conferma qui: {TRACKING}</p>"),
        &format!("Conferma qui: {TRACKING}"),
    ));
    assert!(!parsed.unparsed);
    assert_eq!(body_of(&parsed), "Conferma qui: email.nebius.com");
}

/// The rules that judge a link read the mail as it arrived. Shortening the text
/// must not hide where a link points, or a spoofed sender would go unread.
#[test]
fn the_link_rules_still_read_the_real_href() {
    let parsed = mail::parse(&halves(
        &format!("<p>Ciao</p><p><a href=\"{TRACKING}\">Conferma</a></p>"),
        &format!("Ciao\n({TRACKING})"),
    ));
    let hrefs: Vec<&str> = parsed.links.iter().map(|link| link.href.as_str()).collect();
    assert!(
        hrefs.contains(&TRACKING),
        "the tracking href is gone from the mail: {hrefs:?}"
    );
    assert_eq!(body_of(&parsed), "Ciao\nConferma");
}

/// Shortening runs after the question of whether the sender's two halves say the
/// same thing, so comparing them never sees our own rendering of a URL.
#[test]
fn two_halves_that_agree_are_still_the_same_mail() {
    let parsed = mail::parse(&halves(
        &format!("<p>Ciao gentile</p><p>{TRACKING}</p>"),
        &format!("Ciao gentile\n{TRACKING}"),
    ));
    assert!(
        !parsed.hidden,
        "a mail whose halves agree was flagged: {:?}",
        parsed.text
    );
    assert_eq!(body_of(&parsed), "Ciao gentile\nemail.nebius.com");
}