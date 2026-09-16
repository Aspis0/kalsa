//! Job identity. A token is 128 random bits minted when an answer becomes a
//! job; it rides to the phone inside standard SSE `id:` lines and comes back
//! in `Last-Event-ID`. Resuming also needs the bearer credential, so a job
//! answers to the phone it was created for and nobody else.

/// 128 random bits: an id nobody can put into a resume request by guessing.
/// Never logged, never in a derived `Debug`, never in an error message.
pub(super) struct Token([u8; 16]);

impl Token {
    pub(super) fn mint() -> Result<Self, getrandom::Error> {
        let mut bytes = [0u8; 16];
        getrandom::fill(&mut bytes)?;
        Ok(Self(bytes))
    }

    /// The id namespace inside one job: `token:index`, index from zero. This
    /// is the only place the token becomes visible: it travels to the phone
    /// over the confidential road as an SSE `id:`, and a resume has to echo
    /// it back together with the credential.
    pub(super) fn event_id(&self, index: usize) -> String {
        format!("{}:{}", self.hex(), index)
    }

    /// The registry's key. Bytes, never rendered.
    pub(super) fn key(&self) -> [u8; 16] {
        self.0
    }

    pub(super) fn hex(&self) -> String {
        self.0.iter().map(|byte| format!("{byte:02x}")).collect()
    }

    pub(super) fn from_hex(value: &[u8]) -> Option<Self> {
        let text = std::str::from_utf8(value).ok()?;
        if text.len() != 32 || !text.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return None;
        }
        let mut bytes = [0u8; 16];
        for (index, pair) in text.as_bytes().chunks(2).enumerate() {
            let high = (pair[0] as char).to_digit(16)?;
            let low = (pair[1] as char).to_digit(16)?;
            bytes[index] = ((high << 4) | low) as u8;
        }
        Some(Self(bytes))
    }
}

impl std::fmt::Debug for Token {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("token")
    }
}

/// What a client's `Last-Event-ID` names: the job and the index it last saw.
pub(super) struct Resume {
    pub(super) token: Token,
    pub(super) seen: usize,
}

pub(super) fn parse_resume(value: &[u8]) -> Option<Resume> {
    let colon = value.iter().position(|byte| *byte == b':')?;
    let token = Token::from_hex(&value[..colon])?;
    let index = std::str::from_utf8(&value[colon + 1..]).ok()?;
    let seen = index.parse::<usize>().ok()?;
    Some(Resume { token, seen })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_round_trip_through_the_wire_spelling() {
        let token = Token::mint().unwrap();
        let resume = parse_resume(token.event_id(3).as_bytes()).expect("the id parses back");
        assert_eq!(resume.seen, 3);
        assert_eq!(resume.token.key(), token.key());
    }

    #[test]
    fn a_malformed_resume_id_names_nothing() {
        assert!(parse_resume(b"").is_none());
        assert!(parse_resume(b"zz:1").is_none());
        assert!(parse_resume(b"00112233445566778899aabbccddeeff").is_none());
        assert!(parse_resume(b"00112233445566778899aabbccddeeff:x").is_none());
        assert!(parse_resume(b"00112233445566778899aabbccddeeff:1:2").is_none());
    }

    #[test]
    fn a_token_debugs_as_nothing() {
        assert_eq!(format!("{:?}", Token::mint().unwrap()), "token");
    }
}
