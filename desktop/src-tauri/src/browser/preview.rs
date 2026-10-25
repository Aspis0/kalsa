//! The phone's preview of the page this computer is showing: the codes it is
//! refused with, the sidecar's answer read as one of them, and the shape that
//! goes to the phone.
//!
//! **The picture is the person's page and it goes to the phone that asked for
//! it.** It is never put in the model's context, never written to a file and
//! never logged: it crosses the road once and is gone.

use serde_json::{json, Value};

/// The largest picture that crosses, as the base64 the road carries it.
pub(crate) const MAX_BASE64: usize = 349_528;

/// Why there is no picture. A closed set, because these are the words the
/// phone reads and the phone cannot be handed a stranger's code.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Code {
    /// No browser is open, so there is nothing to show — and nothing was
    /// started to find out.
    NoPage,
    /// The page belongs to another conversation, or to nobody.
    NotYours,
    /// Another call is driving the browser.
    Busy,
    /// The picture is bigger than the road can carry.
    TooLarge,
    /// The phone was gone, or the pairing changed, while the picture was being
    /// taken.
    Cancelled,
    /// This computer will not show that page, or could not take the picture.
    Unavailable,
}

impl Code {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::NoPage => "no_page",
            Self::NotYours => "not_yours",
            Self::Busy => "busy",
            Self::TooLarge => "too_large",
            Self::Cancelled => "cancelled",
            Self::Unavailable => "unavailable",
        }
    }

    /// The code the sidecar named, read against the words this build knows. A
    /// word outside the set is a refusal: it says the truth this build can
    /// stand behind rather than a code the phone has no words for.
    fn named(code: &str) -> Self {
        match code {
            "no_page" => Self::NoPage,
            "not_yours" => Self::NotYours,
            "busy" => Self::Busy,
            "too_large" => Self::TooLarge,
            "cancelled" => Self::Cancelled,
            _ => Self::Unavailable,
        }
    }
}

/// Whether the picture may be handed over. **The session has to be the one the
/// picture was taken in**: a window that closed under the capture leaves a
/// picture of a window that is not there.
pub(crate) fn handed_over(kept: bool) -> Result<(), Code> {
    if kept { Ok(()) } else { Err(Code::Cancelled) }
}

/// Reads the sidecar's answer: the picture, or the reason there is none.
///
/// **The sidecar's own words are read as JSON, never as prose.** A prose
/// refusal would be a stranger's sentence, and a code smuggled into one would
/// be a code nobody here wrote.
pub(crate) fn read(said: &str) -> Result<Value, Code> {
    let Ok(value) = serde_json::from_str::<Value>(said) else {
        return Err(Code::Unavailable);
    };
    let Some(object) = value.as_object() else {
        return Err(Code::Unavailable);
    };
    match object.get("ok").and_then(Value::as_bool) {
        Some(false) => Err(Code::named(object.get("error").and_then(Value::as_str).unwrap_or_default())),
        Some(true) => picture(object),
        None => Err(Code::Unavailable),
    }
}

/// The picture, as the phone reads it. **The four fields and no others**: the
/// phone is owed a picture and two facts, not everything the sidecar said.
fn picture(object: &serde_json::Map<String, Value>) -> Result<Value, Code> {
    let image = object.get("image").and_then(Value::as_str).ok_or(Code::Unavailable)?;
    if image.len() > MAX_BASE64 {
        return Err(Code::TooLarge);
    }
    if object.get("media_type").and_then(Value::as_str) != Some("image/jpeg") {
        return Err(Code::Unavailable);
    }
    let host = object.get("host").and_then(Value::as_str).ok_or(Code::Unavailable)?;
    let taken_at = object.get("taken_at").and_then(Value::as_u64).ok_or(Code::Unavailable)?;
    Ok(json!({
        "image": image,
        "media_type": "image/jpeg",
        "host": host,
        "taken_at": taken_at,
    }))
}

#[cfg(test)]
mod tests {
    use super::{handed_over, read, Code, MAX_BASE64};
    use serde_json::json;

    /// The picture crosses in the shape the phone reads: the fields are the
    /// contract's, and nothing else travels with them.
    #[test]
    fn a_picture_crosses_as_the_phone_reads_it() {
        let said = serde_json::to_string(&json!({
            "ok": true,
            "image": "QUJD",
            "media_type": "image/jpeg",
            "host": "shop.example",
            "taken_at": 1_700_000_000_000_u64,
        }))
        .expect("the answer serializes");
        let wire = read(&said).expect("the picture is read");
        assert_eq!(
            wire,
            json!({
                "image": "QUJD",
                "media_type": "image/jpeg",
                "host": "shop.example",
                "taken_at": 1_700_000_000_000_u64,
            })
        );
    }

    /// A refusal keeps the code the sidecar named: the code is the phone's
    /// vocabulary and a collapsed refusal would leave the phone guessing.
    #[test]
    fn every_refusal_keeps_its_code() {
        for (code, expected) in [
            ("no_page", Code::NoPage),
            ("not_yours", Code::NotYours),
            ("busy", Code::Busy),
            ("too_large", Code::TooLarge),
        ] {
            let said = serde_json::to_string(&json!({"ok": false, "error": code})).expect("serializes");
            assert_eq!(read(&said).err(), Some(expected), "{code}");
        }
    }

    /// A code this build does not know is a refusal, not a guess: the phone is
    /// owed a code it has words for.
    #[test]
    fn a_code_nobody_here_wrote_is_refused() {
        for said in [
            r#"{"ok":false,"error":"page.timeout"}"#,
            r#"{"ok":false}"#,
            r#"{"ok":"yes"}"#,
            r#"{"image":"QUJD"}"#,
            "not json at all",
        ] {
            assert_eq!(read(said).err(), Some(Code::Unavailable), "{said}");
        }
    }

    /// A picture too big for the road is refused as too big: the cap is the
    /// road's, and the picture is not carried anyway.
    #[test]
    fn a_picture_bigger_than_the_road_is_refused() {
        let said = json!({
            "ok": true,
            "image": "A".repeat(MAX_BASE64 + 1),
            "media_type": "image/jpeg",
            "host": "shop.example",
            "taken_at": 1_u64,
        })
        .to_string();
        assert_eq!(read(&said).err(), Some(Code::TooLarge));
    }

    /// Only a JPEG is a picture: anything else the sidecar claims to have
    /// taken is not one, and the phone is not handed a file of another kind.
    #[test]
    fn only_a_jpeg_is_a_picture() {
        let said = json!({
            "ok": true,
            "image": "QUJD",
            "media_type": "image/png",
            "host": "shop.example",
            "taken_at": 1_u64,
        })
        .to_string();
        assert_eq!(read(&said).err(), Some(Code::Unavailable));
    }

    /// A picture of a session that ended is not handed over: the window closed
    /// under the capture, so the picture is of a window that is not there.
    #[test]
    fn a_picture_of_a_session_that_ended_is_refused() {
        assert_eq!(handed_over(true), Ok(()));
        assert_eq!(handed_over(false), Err(Code::Cancelled));
    }
}
