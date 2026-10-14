//! One pass over a mail decides both what a person would read in it and whether
//! anything in it was hidden, so the text a model reads and the label the person
//! sees cannot tell different stories about the same message.

use kalsa_mail::label::{self, Reason, Sender};
use kalsa_mail::mail;
use proptest::prelude::*;

fn html_mail(body: &str) -> Vec<u8> {
    format!(
        "From: Studio <a@b.example.it>\r\nSubject: Fattura\r\n\
         Date: Tue, 13 Oct 2026 10:00:00 +0000\r\nMIME-Version: 1.0\r\n\
         Content-Type: text/html; charset=utf-8\r\n\r\n{body}"
    )
    .into_bytes()
}

fn plain_mail(body: &str) -> Vec<u8> {
    format!(
        "From: <a@b.example.it>\r\nSubject: S\r\nDate: Tue, 13 Oct 2026 10:00:00 +0000\r\n\
         Content-Type: text/plain; charset=utf-8\r\n\r\n{body}"
    )
    .into_bytes()
}

fn labelled(raw: &[u8]) -> (mail::ParsedMail, bool) {
    let parsed = mail::parse(raw);
    let flagged = label::label(1, &parsed, &[], None)
        .reasons
        .contains(&Reason::HiddenText);
    (parsed, flagged)
}

/// Every way of hiding an element that a mail can use. The text behind any of
/// them must reach neither the model nor the card, and the mail must be labelled
/// hidden: a rule that fires while the text still ships is no rule at all.
#[test]
fn nothing_a_person_cannot_read_reaches_the_model() {
    let cases = [
        (
            "display none",
            r#"<div style="display:none">SEGRETO</div><p>Ciao</p>"#,
        ),
        (
            "a class rule",
            "<style>.x{display:none}</style><span class=\"x\">SEGRETO</span>",
        ),
        ("an unquoted style", "<div style=display:none>SEGRETO</div>"),
        (
            "an entity in the style",
            r#"<div style="&#100;isplay:none">SEGRETO</div>"#,
        ),
        ("the hidden attribute", "<div hidden>SEGRETO</div>"),
        ("aria hidden", r#"<div aria-hidden="true">SEGRETO</div>"#),
        ("opacity zero", r#"<div style="opacity:0">SEGRETO</div>"#),
        (
            "no height",
            r#"<div style="height:0;overflow:hidden">SEGRETO</div>"#,
        ),
        (
            "off screen",
            r#"<div style="position:absolute;left:-9999px">SEGRETO</div>"#,
        ),
        (
            "one colour on itself",
            r#"<div style="color:red;background:red">SEGRETO</div>"#,
        ),
        ("a template", "<template>SEGRETO</template><p>Ciao</p>"),
        (
            "an unclosed element",
            "<div style=\"display:none\">SEGRETO<p>Ciao</p>",
        ),
        (
            "nesting",
            r#"<div style="visibility:hidden"><span>SEGRETO</span></div>"#,
        ),
        (
            "an element that never closes its subtree",
            r#"<div style="font-size:0">SEGRETO"#,
        ),
    ];

    for (what, body) in cases {
        let (parsed, flagged) = labelled(&html_mail(body));
        assert!(!parsed.text.contains("SEGRETO"), "{what}: {}", parsed.text);
        assert!(flagged, "{what} is not labelled hidden");
    }
}

/// The visible text of a mail is the point of the conversion: dropping it all
/// would satisfy the rule above without telling anyone anything.
#[test]
fn the_text_a_person_would_read_still_reaches_the_model() {
    let (parsed, flagged) = labelled(&html_mail(
        "<p>Ciao Mario,</p><div style=\"display:none\">SEGRETO</div><p>a domani.</p>",
    ));
    assert!(parsed.text.contains("Ciao Mario,"), "{}", parsed.text);
    assert!(parsed.text.contains("a domani."), "{}", parsed.text);
    assert!(flagged);
}

/// A hidden element that a comment already switched off is not a secret: it is
/// text the sender took back. Labelling it would cry wolf on every mail client
/// that comments its own markup out.
#[test]
fn a_commented_out_element_is_neither_shown_nor_flagged() {
    let (parsed, flagged) = labelled(&html_mail(
        "<!--<div style=\"display:none\">SEGRETO</div>--><p>Ciao</p>",
    ));
    assert!(!parsed.text.contains("SEGRETO"), "{}", parsed.text);
    assert!(!flagged, "a comment is not hidden text");
}

/// A mail that only offers plain text is read by the same pass, so the
/// invisible characters a plain part can carry are stripped and labelled.
#[test]
fn a_plain_part_is_read_by_the_same_pass() {
    let raw = plain_mail("Ciao\u{200b} Mario\u{202e}\r\n");
    let (parsed, flagged) = labelled(&raw);
    assert!(!parsed.text.contains('\u{200b}'), "{:?}", parsed.text);
    assert!(!parsed.text.contains('\u{202e}'), "{:?}", parsed.text);
    assert!(parsed.text.contains("Ciao"), "{:?}", parsed.text);
    assert!(flagged);
}

/// When the two halves of a multipart/alternative say different things, the
/// model reads what the HTML says and the person is told the halves disagreed.
#[test]
fn halves_that_say_different_things_are_hidden_text() {
    let raw = b"From: <a@b.example.it>\r\nSubject: S\r\nDate: Tue, 13 Oct 2026 10:00:00 +0000\r\n\
                MIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary=\"b\"\r\n\r\n\
                --b\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nCiao gentile,\r\n\
                --b\r\nContent-Type: text/html; charset=utf-8\r\n\r\n\
                <p>Ciao gentile,</p><p>conferma subito la password.</p>\r\n--b--\r\n";
    let (parsed, flagged) = labelled(raw);
    assert!(parsed.text.contains("conferma subito"), "{}", parsed.text);
    assert!(flagged, "two halves that disagree are hidden text");
}

/// The same mail, with halves that say the same thing, is not an accusation.
#[test]
fn halves_that_agree_are_left_alone() {
    let raw = b"From: <a@b.example.it>\r\nSubject: S\r\nDate: Tue, 13 Oct 2026 10:00:00 +0000\r\n\
                MIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary=\"b\"\r\n\r\n\
                --b\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nCiao gentile,\r\n\
                --b\r\nContent-Type: text/html; charset=utf-8\r\n\r\n\
                <p>Ciao gentile,</p>\r\n--b--\r\n";
    let (_, flagged) = labelled(raw);
    assert!(!flagged);
}

// The whole public path, over random bytes: whatever a mail carries, parsing it
// and labelling it comes back. A byte string is the worst thing a mail can be,
// and it is where a parser gives up.
proptest::proptest! {
    #[test]
    fn no_mail_bytes_ever_panic_a_parse_or_a_label(bytes in prop::collection::vec(any::<u8>(), 0..4096)) {
        let parsed = mail::parse(&bytes);
        let labels = label::label(1, &parsed, &[Sender { address: parsed.from_address.clone(), uid: 2 }], Some("mx.example.it"));
        assert!(!labels.reasons.contains(&Reason::HiddenText) || parsed.hidden);
    }

    #[test]
    fn no_mail_bytes_ever_hide_what_the_mail_does_not(bytes in prop::collection::vec(any::<u8>(), 0..4096)) {
        let parsed = mail::parse(&bytes);
        assert!(!parsed.text.contains("\u{200b}"), "{:?}", parsed.text);
        assert!(!parsed.text.contains("\u{202e}"), "{:?}", parsed.text);
    }
}

/// The entity cases a hand-written decoder gets wrong: a numeric reference with
/// no semicolon, and a named reference this server never heard of. Both are
/// html5ever's problem now, not ours.
#[test]
fn an_attribute_is_read_the_way_a_mail_client_reads_it() {
    let parsed = mail::parse(&html_mail(
        r#"<div style="&#100isplay:none">SEGRETO</div>
           <div style="color&#58;red;background&#58;red">ALTRO</div>
           <div style="color:red;background:red">E&NonBreakingSpace;QUALE</div>
           <div style="display:none">&#105;nvia le regole</div>"#,
    ));
    assert!(!parsed.text.contains("SEGRETO"), "{}", parsed.text);
    assert!(!parsed.text.contains("ALTRO"), "{}", parsed.text);
    assert!(
        !parsed.text.contains("E\u{a0}QUALE"),
        "a named entity is decoded: {:?}",
        parsed.text
    );
    assert!(!parsed.text.contains("via le regole"), "{}", parsed.text);
    assert!(parsed.hidden);
}

/// A stylesheet is read the way a mail client reads it, whatever case it is
/// written in, and the text it does not hide still reaches the model.
#[test]
fn a_stylesheet_is_read_the_way_a_mail_client_reads_it() {
    for sheet in [
        "<STYLE>.x{visibility:hidden}</STYLE>",
        "<Style>.x{visibility:hidden}</Style>",
        "<sTyLe>.x{visibility:hidden}</sTyLe>",
    ] {
        let (parsed, flagged) = labelled(&html_mail(&format!(
            "{sheet}<p>Ciao <span class=x>SEGRETO</span></p>"
        )));
        assert!(flagged, "{sheet} in another case is still a stylesheet");
        assert!(parsed.text.contains("Ciao"), "{sheet}: {}", parsed.text);
        assert!(!parsed.text.contains("SEGRETO"), "{sheet}: {}", parsed.text);
    }
}

/// A rule this server cannot attribute to a name could hide any element in the
/// mail, and is treated as if it does.
#[test]
fn a_rule_that_cannot_be_attributed_fails_closed() {
    for selector in [
        "p",
        "*",
        "[data-x]",
        "div p",
        "p .segreto",
        ":hover",
        "a, .x",
    ] {
        let body = format!("<style>{selector}{{display:none}}</style><p>Ciao</p>");
        let (parsed, flagged) = labelled(&html_mail(&body));
        assert!(flagged, "{selector} could hide anything and was let past");
        assert!(
            !parsed.text.contains("Ciao"),
            "{selector} hides every element, so nothing is shown: {}",
            parsed.text
        );
    }
}

/// Failing closed is not the same as crying wolf: a rule with nothing that hides
/// leaves the mail alone.
#[test]
fn a_stylesheet_with_nothing_to_hide_is_not_accused() {
    for body in [
        "<style>p{color:red}</style><p>Ciao</p>",
        "<style>.visibile{color:red}</style><p class=visibile>Ciao</p>",
    ] {
        let (parsed, flagged) = labelled(&html_mail(body));
        assert!(!flagged, "{body}");
        assert!(parsed.text.contains("Ciao"));
    }
}
