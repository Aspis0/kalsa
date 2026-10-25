//! RFC 2047 encoded words, as a subject, a display name or an attachment
//! filename may carry them: `=?utf-8?B?…?=` and `=?utf-8?Q?…?=`.

use base64::Engine;

/// One encoded word, decoded. `None` when it is not one, or when what it says
/// is not text — a sender can put anything in there, and this server does not
/// have to understand it to refuse it.
pub(crate) fn decode(word: &str) -> Option<String> {
    let after_name = word.strip_prefix("=?")?.split_once('?')?.1;
    let (encoding, rest) = after_name.split_once('?')?;
    let payload = rest.strip_suffix("?=")?;
    let bytes = if encoding.eq_ignore_ascii_case("b") {
        base64::engine::general_purpose::STANDARD
            .decode(payload)
            .ok()?
    } else {
        decode_q(payload)
    };
    String::from_utf8(bytes).ok()
}

/// The quoted-printable form, where `_` is a space and `=XX` is a byte.
fn decode_q(data: &str) -> Vec<u8> {
    let bytes = data.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'_' => {
                out.push(b' ');
                i += 1;
            }
            b'=' if i + 2 < bytes.len() => {
                let hex = String::from_utf8_lossy(&bytes[i + 1..i + 3]).to_string();
                match u8::from_str_radix(&hex, 16) {
                    Ok(byte) => {
                        out.push(byte);
                        i += 3;
                    }
                    Err(_) => {
                        out.push(bytes[i]);
                        i += 1;
                    }
                }
            }
            byte => {
                out.push(byte);
                i += 1;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn both_encodings_come_back_as_they_were_written() {
        assert_eq!(decode("=?utf-8?B?Q2lhbyA=?=").as_deref(), Some("Ciao "));
        assert_eq!(
            decode("=?utf-8?Q?Ciao_Giuseppe?=").as_deref(),
            Some("Ciao Giuseppe")
        );
        assert_eq!(decode("=?UTF-8?q?a=3Db?=").as_deref(), Some("a=b"));
    }

    #[test]
    fn what_is_not_an_encoded_word_is_not_decoded() {
        assert_eq!(decode("fattura.pdf"), None);
        assert_eq!(decode("=?utf-8?B?not base64!?"), None);
        assert_eq!(decode(""), None);
    }

    /// The sender chooses the bytes, so what comes back may not be text at all.
    #[test]
    fn an_encoded_word_that_is_not_text_is_refused() {
        assert_eq!(decode("=?utf-8?B?//5oAGkA?="), None);
    }

    #[test]
    fn a_malformed_escape_is_kept_as_it_was_written() {
        assert_eq!(decode("=?utf-8?Q?a=zz?=").as_deref(), Some("a=zz"));
        assert_eq!(decode("=?utf-8?Q?trailing=").as_deref(), None);
        assert_eq!(decode("=?utf-8?Q?trailing=?").as_deref(), None);
    }
}
