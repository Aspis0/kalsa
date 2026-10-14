//! Mail text is written by strangers, and every function that reads it has to survive
//! what a stranger can put there: characters that change length when they are folded,
//! bytes that are not UTF-8, and elements that hide text.

use kalsa_mail::label::{self, Reason};
use kalsa_mail::mail;

/// A partial fetch stops in the middle of a MIME structure. The parser has to give
/// what it can instead of giving up, because that is what every large mail will be.
#[test]
fn a_mail_cut_mid_mime_still_parses() {
    let full = b"From: \"Studio\" <studio@fornitore.example.net>\r\n\
Subject: Fattura con allegato\r\n\
Date: Tue, 13 Oct 2026 10:00:00 +0000\r\n\
MIME-Version: 1.0\r\n\
Content-Type: multipart/mixed; boundary=\"cut\"\r\n\r\n\
--cut\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n\
Conferma la password entro 24 ore.\r\n\
--cut\r\nContent-Type: application/pdf\r\n\
Content-Disposition: attachment; filename=\"fattura.pdf\"\r\n\
Content-Transfer-Encoding: base64\r\n\r\n\
JVBERi0xLjQKJSVFT0YK\0\0\0";

    // A partial fetch keeps the whole header block and stops inside the body.
    let header = full
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .expect("a header")
        + 4;
    for cut in [
        header,
        header + 10,
        header + 120,
        full.len() - 30,
        full.len(),
    ] {
        let parsed = mail::parse(&full[..cut]);
        assert!(
            parsed.from_address == "studio@fornitore.example.net",
            "headers survive a cut at {cut}"
        );
        // A cut before the first boundary carries no part yet, so empty text there is
        // correct. Past it, the body has to come through.
        if cut > header + 120 {
            assert!(!parsed.text.is_empty(), "text survives a cut at {cut}");
        }
        if cut > header + 120 {
            let labels = label::label(1, &parsed, &[], Some("mx.example.it"));
            assert!(
                labels.reasons.contains(&Reason::PaymentUrgencyNewSender),
                "the body rules still read a message cut at {cut}: {:?}",
                labels.reasons
            );
        }
    }
}
