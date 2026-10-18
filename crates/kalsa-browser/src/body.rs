//! What may be shown of a request's body (one responsibility: turn the bytes a
//! page wanted to send into the fields a person may read, or refuse them).
//!
//! The card is only worth the person's attention if it is the request the site
//! would really have received. So a body is shown **field by field, values
//! exactly as sent, hidden fields included**, or not shown at all: a truncated
//! payload presented as the real one is worse than no card, because the person
//! says yes to something they have not seen.
//!
//! Three shapes are renderable and the rest are refused with one line:
//!
//! - `application/x-www-form-urlencoded` — pairs, in the order they were written.
//! - `multipart/form-data` — the **text** parts. A part carrying a file is not a
//!   field: there is no honest way to show a person's résumé in a card, and the
//!   file itself never goes anywhere Kalsa can see.
//! - `application/json` up to [`MAX_BODY`] — an object, one field per key.
//!
//! **Nothing is ever taken out of a card.** A value the person typed into a
//! password field is on the card in full, because the card exists so a person can
//! check what a stranger's site is about to receive, and a card that quietly
//! blanks one of its own fields is a card that cannot be checked. It is *marked*
//! instead — [`Field::secret`] — and the window draws that field as dots with a
//! Show button beside it.
//!
//! The flag can only add dots. It is decided on the field's own shape when we
//! have it and on its name when we do not, and **a page that marks all of its
//! fields is a page whose fields are all dotty**: the one thing it cannot do is
//! remove a value, which is the thing a card has to be trusted about.
//!
//! What a value may not reach is everything that is not the card: the model's
//! text, a log line, a diagnostics dump, the store. That is why [`Field`]'s
//! `Debug` is masked and its `Serialize` is not — Debug is how a field would end
//! up in a log, and Serialize is how it reaches the person who asked.

use std::fmt;

use serde::Serialize;
use serde_json::Value;

/// Why a body is refused when its text is not UTF-8. One line, and it names the kind.
const NOT_TEXT: &str = "the request carries bytes that are not text, so it cannot be shown";

/// The most of a body a card may carry. Sixteen kilobytes is a card, not a
/// scroll: past this the person is being asked to approve something they cannot
/// read, which is the thing this module exists to prevent.
pub(crate) const MAX_BODY: usize = 16 * 1024;

/// What a body is turned into for a person to read.
///
/// **Debug goes through its fields' masked one**, so an assertion failure over a
/// body carrying a password prints dots rather than the request.
#[derive(PartialEq, Eq)]
pub(crate) enum Shown {
    /// The fields, in the order the page wrote them.
    Fields(Vec<Field>),
    /// Why there is no card for this body. One line, and it names the kind
    /// rather than the content: nothing here may echo a payload back.
    Refused(&'static str),
}

/// One field as it was sent — **all of it**, with `secret` saying whether the
/// window should draw it as dots.
#[derive(Clone, PartialEq, Eq, Serialize)]
pub struct Field {
    pub name: String,
    pub value: String,
    /// This one is a password-class field: the page's own element said so, or
    /// its name reads that way. **It changes how the card is drawn and nothing
    /// else** — the value above is the value that will be sent, and the person
    /// can read it with the Show button.
    pub secret: bool,
    /// The words the page puts beside this field, cleaned and capped (see
    /// [`crate::label`]). **Display only**: nothing decides on it, and a field the
    /// page gave no words to is drawn with its name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

/// What a `Debug` prints for a value: dots, and never the value.
///
/// The one place a field could leak without anybody deciding to send it — a log
/// line, a panic message, a test failure. A card is checked through `Serialize`,
/// which carries the real value to the window and nowhere else.
impl fmt::Debug for Shown {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Shown::Fields(fields) => formatter.debug_tuple("Fields").field(fields).finish(),
            Shown::Refused(why) => formatter.debug_tuple("Refused").field(why).finish(),
        }
    }
}

impl fmt::Debug for Field {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.secret {
            formatter
                .debug_struct("Field")
                .field("name", &self.name)
                .field("value", &DOTS)
                .field("secret", &true)
                .finish()
        } else {
            formatter
                .debug_struct("Field")
                .field("name", &self.name)
                .field("value", &self.value)
                .field("secret", &false)
                .finish()
        }
    }
}

/// What stands in for a value in anything that is not the card.
pub(crate) const DOTS: &str = "\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}";

/// The words a site uses for a field that holds a secret.
///
/// **This only ever adds dots.** The rule that used to blank a value on the
/// strength of its name let a page pick what a person could read; here a page can
/// make its own fields dotty and nothing else, which costs it nothing and hides
/// nothing from the person who has to decide.
const SECRET_WORDS: &[&str] = &[
    "password", "passwd", "passphrase", "pass", "pwd", "secret", "token", "otp", "cvv", "cvc", "pin", "ssn",
    "fiscal",
];

/// Whether a name reads as a secret field. Split on everything that is not a
/// letter or a figure, so `user_password_2` and `passphrase_2` are both found.
pub(crate) fn secret_name(name: &str) -> bool {
    let lowered = name.to_ascii_lowercase();
    SECRET_WORDS.contains(&lowered.as_str())
        || lowered.split(|character: char| !character.is_alphanumeric()).any(|word| SECRET_WORDS.contains(&word))
}

/// The body as the card may show it, or the one line that says it may not.
pub(crate) fn show(content_type: &str, body: &[u8]) -> Shown {
    if body.is_empty() {
        return Shown::Fields(Vec::new());
    }
    if body.len() > MAX_BODY {
        return Shown::Refused("the request carries a body too large to be shown");
    }
    let kind = content_type.split(';').next().unwrap_or("").trim().to_ascii_lowercase();
    match kind.as_str() {
        "application/x-www-form-urlencoded" => match urlencoded(body) {
            Some(fields) => Shown::Fields(fields),
            None => Shown::Refused(NOT_TEXT),
        },
        "multipart/form-data" => multipart(content_type, body),
        "application/json" | "text/json" => json(body),
        _ => Shown::Refused("the request is sent in a form the person cannot read"),
    }
}

/// The fields of a write that never became a request — one the page read out of
/// its own `FormData` — judged by the same rules as a body off the wire, so
/// there is one policy and not two that can drift apart.
pub(crate) fn fields_of(pairs: &[(String, String)], secrets: &[String]) -> Shown {
    let size: usize = pairs.iter().map(|(name, value)| name.len() + value.len() + 1).sum();
    if size > MAX_BODY {
        return Shown::Refused("the request carries a body too large to be shown");
    }
    // **Either** the element said so **or** the name reads that way. The first
    // is the accurate one and only exists while there is a document behind the
    // request; the second is what a request that has lost its elements has.
    Shown::Fields(
        pairs
            .iter()
            .map(|(name, value)| field(name, value, secrets.contains(name) || secret_name(name)))
            .collect(),
    )
}

/// One field, as it was sent. The value is carried whatever it is; `secret` says
/// only how the card draws it.
fn field(name: &str, value: &str, secret: bool) -> Field {
    Field { name: name.to_owned(), value: value.to_owned(), secret, label: None }
}

/// The pairs of a form post, in the order the page wrote them.
///
/// **Strictly**: a field whose bytes are not UTF-8 is not text. A card that showed it
/// with replacement characters would be showing a value nobody sent, so the whole body
/// is refused instead.
fn urlencoded(body: &[u8]) -> Option<Vec<Field>> {
    body.split(|byte| *byte == b'&')
        .filter(|pair| !pair.is_empty())
        .map(|pair| {
            let (name, value) = match pair.iter().position(|byte| *byte == b'=') {
                Some(at) => (&pair[..at], &pair[at + 1..]),
                None => (pair, &pair[pair.len()..]),
            };
            let (name, value) = (form_text(name)?, form_text(value)?);
            Some(field(&name, &value, secret_name(&name)))
        })
        .collect()
}

/// One name or value of a form body: `+` is a space and `%XX` is the byte it names. A
/// `%` that names no byte is kept as written, as a form decoder keeps it. The bytes
/// must be UTF-8, or there is no text to show.
fn form_text(bytes: &[u8]) -> Option<String> {
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        let byte = bytes[index];
        if byte == b'+' {
            out.push(b' ');
            index += 1;
            continue;
        }
        if byte == b'%' && index + 2 < bytes.len() {
            if let (Some(high), Some(low)) =
                ((bytes[index + 1] as char).to_digit(16), (bytes[index + 2] as char).to_digit(16))
            {
                out.push((high * 16 + low) as u8);
                index += 3;
                continue;
            }
        }
        out.push(byte);
        index += 1;
    }
    String::from_utf8(out).ok()
}

/// The name a part's `Content-Disposition` gives, read from the header as the browser
/// wrote it: its case is the page's. `name="` counts only at the start of a parameter,
/// so `filename="` is never taken for it.
fn name_of(head: &str) -> Option<String> {
    let lowered = head.to_ascii_lowercase();
    let mut from = 0;
    while let Some(found) = lowered[from..].find("name=\"") {
        let at = from + found;
        let start = at + "name=\"".len();
        let parameter_start = at == 0 || matches!(lowered.as_bytes()[at - 1], b';' | b' ' | b'\t');
        if parameter_start {
            let end = head[start..].find('"')? + start;
            return Some(head[start..end].to_owned());
        }
        from = start;
    }
    None
}

/// The text parts of a multipart post. A part that carries a file refuses the
/// whole body: a card that showed the fields around it would be showing half a
/// request and calling it the request.
fn multipart(content_type: &str, body: &[u8]) -> Shown {
    let Some(boundary) = boundary_of(content_type) else {
        return Shown::Refused("the request is sent in a form the person cannot read");
    };
    let separator = format!("--{boundary}").into_bytes();
    let mut fields = Vec::new();
    for part in split_on(body, &separator) {
        let Some(part) = part.strip_prefix(b"\r\n") else {
            continue; // the preamble, and the closing `--boundary--`
        };
        let Some(split) = find(part, b"\r\n\r\n") else {
            continue;
        };
        // Strictly: a header or a value that is not UTF-8 is not text, and is refused.
        let (Ok(head), Ok(value)) = (std::str::from_utf8(&part[..split]), std::str::from_utf8(&part[split + 4..])) else {
            return Shown::Refused(NOT_TEXT);
        };
        let value = value.trim_end_matches("\r\n");
        let lowered = head.to_ascii_lowercase();
        if lowered.contains("filename=") {
            return Shown::Refused("the request carries a file, and a card cannot show a file");
        }
        // A part with its own content type is a part that is not text, whether
        // or not the page gave it a filename.
        if lowered.contains("content-type:") && !lowered.contains("content-type: text/") {
            return Shown::Refused("the request carries a file, and a card cannot show a file");
        }
        let Some(name) = name_of(head) else {
            return Shown::Refused("the request is sent in a form the person cannot read");
        };
        fields.push(field(&name, value, secret_name(&name)));
    }
    Shown::Fields(fields)
}

/// A JSON object, one field per key. An array or a bare value has no field
/// names to show, and a card of raw JSON the person cannot check against the
/// form is not the card this plan asks for.
fn json(body: &[u8]) -> Shown {
    let Ok(Value::Object(map)) = serde_json::from_slice::<Value>(body) else {
        return Shown::Refused("the request is sent in a form the person cannot read");
    };
    let fields = map
        .iter()
        .map(|(name, value)| {
            let shown = match value {
                Value::String(text) => text.clone(),
                other => other.to_string(),
            };
            field(name, &shown, secret_name(name))
        })
        .collect();
    Shown::Fields(fields)
}

/// The boundary a multipart body is cut on, which is named in the content type
/// and nowhere else.
fn boundary_of(content_type: &str) -> Option<String> {
    let lowered = content_type.to_ascii_lowercase();
    let at = lowered.find("boundary=")? + "boundary=".len();
    let rest = &content_type[at..];
    let end = rest.find(';').unwrap_or(rest.len());
    let boundary = rest[..end].trim().trim_matches('"');
    (!boundary.is_empty()).then(|| boundary.to_owned())
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    haystack.windows(needle.len()).position(|window| window == needle)
}

/// The pieces between each occurrence of `needle`. A multipart body is cut on
/// its boundary and nothing else, so this is where that happens.
fn split_on<'a>(haystack: &'a [u8], needle: &[u8]) -> Vec<&'a [u8]> {
    let mut pieces = Vec::new();
    let mut rest = haystack;
    while let Some(at) = find(rest, needle) {
        pieces.push(&rest[..at]);
        rest = &rest[at + needle.len()..];
    }
    pieces.push(rest);
    pieces
}

#[cfg(test)]
mod tests {
    use super::{field, fields_of, secret_name, show, Field, Shown, DOTS, MAX_BODY};

    fn fields(shown: Shown) -> Vec<Field> {
        match shown {
            Shown::Fields(fields) => fields,
            Shown::Refused(why) => panic!("refused: {why}"),
        }
    }

    fn refused(shown: Shown) -> &'static str {
        match shown {
            Shown::Refused(why) => why,
            Shown::Fields(_) => panic!("was shown"),
        }
    }

    /// A form post is shown exactly as it was written, in order — the card is
    /// checked against the form the person can see.
    #[test]
    fn a_form_post_is_shown_as_the_fields_it_was_written_with() {
        let shown = fields(show("application/x-www-form-urlencoded", b"name=giulia&note=hello+there&csrf=a%2Fb%20c"));
        assert_eq!(
            shown,
            vec![
                field("name", "giulia", false),
                field("note", "hello there", false),
                field("csrf", "a/b c", false),
            ]
        );
    }

    /// The same body with a different content type is a different body, so the
    /// card is different too.
    #[test]
    fn the_content_type_decides_which_body_it_is() {
        assert_eq!(
            refused(show("application/octet-stream", b"name=giulia")),
            "the request is sent in a form the person cannot read"
        );
        assert_eq!(fields(show("application/octet-stream; charset=utf-8", b"")), Vec::<Field>::new());
    }

    /// A file is not a field. Nothing here may show half a request and call it the
    /// request, so one part with a file refuses the whole body.
    #[test]
    fn a_multipart_part_that_carries_a_file_is_refused_with_the_whole_body() {
        let body = b"--X\r\nContent-Disposition: form-data; name=\"cv\"\r\n\r\n1234\r\n\
                     --X\r\nContent-Disposition: form-data; name=\"cv-file\"; filename=\"cv.pdf\"\r\n\
                     Content-Type: application/pdf\r\n\r\n%PDF\r\n--X--\r\n";
        assert_eq!(
            refused(show("multipart/form-data; boundary=X", body)),
            "the request carries a file, and a card cannot show a file"
        );
    }

    #[test]
    fn the_text_parts_of_a_multipart_body_are_fields() {
        let body = b"--X\r\nContent-Disposition: form-data; name=\"city\"\r\n\r\nBologna\r\n\
                     --X\r\nContent-Disposition: form-data; name=\"note\"\r\n\r\nhello\r\n--X--\r\n";
        assert_eq!(
            fields(show("multipart/form-data; boundary=X", body)),
            vec![field("city", "Bologna", false), field("note", "hello", false)]
        );
    }

    /// JSON is shown as an object, one field per key; anything without field
    /// names to show has no card.
    #[test]
    fn json_is_shown_as_an_object_and_nothing_else_is_shown_as_json() {
        assert_eq!(
            fields(show("application/json", br#"{"city":"Bologna","n":3}"#)),
            vec![field("city", "Bologna", false), field("n", "3", false)]
        );
        assert!(matches!(show("application/json", b"[1,2,3]"), Shown::Refused(_)));
        assert!(matches!(show("application/json", b"not json at all"), Shown::Refused(_)));
    }

    /// Over the cap there is no card. A person asked to approve sixteen kilobytes
    /// they cannot read approves nothing.
    #[test]
    fn a_body_over_the_cap_is_refused_rather_than_truncated() {
        let big = vec![b'a'; MAX_BODY + 1];
        assert_eq!(refused(show("application/json", &big)), "the request carries a body too large to be shown");
        assert!(matches!(show("application/json", &vec![b'a'; MAX_BODY - 2]), Shown::Refused(_)));
    }

    /// **Nothing is taken out of a card, whatever the field is called.** This is
    /// the rule the value-dropping one is replaced by: the card is the request,
    /// and a field that is blanked on the page's word — or on the page's own
    /// `__kalsaTyped` call — is a field the person cannot check.
    #[test]
    fn a_field_never_loses_its_value_however_much_it_looks_like_a_secret() {
        for name in ["password", "Password", "user_password", "pin", "cvv", "otp", "api_token", "passphrase_2"] {
            let shown = field(name, "hunter2", secret_name(name));
            assert_eq!(shown.value, "hunter2", "{name} is on the card in full");
            assert!(shown.secret, "{name} still reads as a secret name, and only that changes");
        }
        for name in ["username", "city", "comment", "pinned"] {
            assert!(!secret_name(name), "{name} is not a secret name");
        }
    }

    /// **A page can make its fields dotty and nothing else.** Every field marked
    /// as a secret by the page keeps its value: the flag draws dots, and the Show
    /// button gives the value back to the person who has to decide.
    #[test]
    fn a_page_that_calls_everything_a_secret_still_cannot_hide_a_value() {
        let pairs = vec![
            ("payload".to_owned(), "the-exfiltrated-thing".to_owned()),
            ("x".to_owned(), "another".to_owned()),
        ];
        let shown = fields(fields_of(&pairs, &["payload".to_owned(), "x".to_owned()]));
        assert!(shown.iter().all(|one| one.secret), "the page marked all of them");
        assert_eq!(
            shown.iter().map(|one| one.value.as_str()).collect::<Vec<&str>>(),
            vec!["the-exfiltrated-thing", "another"],
            "and every value is still on the card"
        );
    }

    /// **`Debug` is the leak path, so it is masked; `Serialize` is the card, so
    /// it is not.** A log line, a panic or a failing test prints the first, and
    /// the person reads the second.
    #[test]
    fn debug_is_masked_and_serialization_is_not() {
        let shown = field("passphrase_2", "hunter2", true);
        let printed = format!("{shown:?}");
        assert!(!printed.contains("hunter2"), "a field is never printed: {printed}");
        assert!(printed.contains(DOTS), "and says there is one: {printed}");
        assert_eq!(serde_json::to_string(&shown).expect("serializes"), r#"{"name":"passphrase_2","value":"hunter2","secret":true}"#);

        let plain = field("city", "Bologna", false);
        assert!(format!("{plain:?}").contains("Bologna"), "what is not a secret is printed as it is");
    }

    /// A write the page read out of its own `FormData` is judged by the same
    /// rules as one that came off the wire, and the two must not drift.
    #[test]
    fn the_pairs_a_page_read_are_judged_by_the_rules_a_body_is_judged_by() {
        let pairs = vec![("user".to_owned(), "giulia".to_owned()), ("note".to_owned(), "hello".to_owned())];
        assert_eq!(
            fields_of(&pairs, &[]),
            Shown::Fields(fields(show("application/x-www-form-urlencoded", b"user=giulia&note=hello")))
        );
        assert_eq!(
            fields_of(&pairs, &["note".to_owned()]),
            Shown::Fields(vec![field("user", "giulia", false), field("note", "hello", true)]),
            "and what the page said was a secret is dotted, with its value intact"
        );

        let big = vec![("note".to_owned(), "a".repeat(MAX_BODY + 1))];
        assert_eq!(
            refused(fields_of(&big, &[])),
            "the request carries a body too large to be shown",
            "over the cap there is no card, whichever way the request arrived"
        );
    }

    /// **A field whose bytes are not text is not shown as text.** A replacement character
    /// on the card would be a value nobody sent, so the body is refused, in each of the
    /// three shapes, and the refusal names the kind rather than the content.
    #[test]
    fn a_body_whose_text_is_not_utf8_is_refused_not_shown_with_replacements() {
        assert_eq!(refused(show("application/x-www-form-urlencoded", b"city=%FF")), super::NOT_TEXT);
        assert_eq!(refused(show("application/x-www-form-urlencoded", b"city=\xFF")), super::NOT_TEXT);
        let multipart = b"--b\r\nContent-Disposition: form-data; name=\"city\"\r\n\r\n\xFF\r\n--b--";
        assert_eq!(refused(show("multipart/form-data; boundary=b", multipart)), super::NOT_TEXT);
        assert!(matches!(show("application/json", b"{\"city\":\"\xFF\"}"), Shown::Refused(_)), "JSON that is not UTF-8 is refused");
    }

    /// Valid percent-encoding is still decoded, and `+` is still a space, so the strict
    /// reader changes nothing about a body that is text.
    #[test]
    fn a_form_body_of_text_decodes_as_a_form_does() {
        let shown = fields(show("application/x-www-form-urlencoded", b"city=B%C3%B3logna+x&bad=100%"));
        assert_eq!(shown[0].value, "Bólogna x");
        assert_eq!(shown[1].value, "100%", "a % that names no byte is kept as written");
    }

    /// **A multipart field keeps the name the page wrote, case and all.** Lowercasing the
    /// header made the card show a name the browser never sent.
    #[test]
    fn a_multipart_name_keeps_its_case_and_a_filename_is_never_taken_for_it() {
        let body = b"--b\r\nContent-Disposition: form-data; name=\"CustName\"\r\n\r\nGiulia\r\n--b--";
        let shown = fields(show("multipart/form-data; boundary=b", body));
        assert_eq!(shown[0].name, "CustName");
        assert_eq!(shown[0].value, "Giulia");
    }

}
