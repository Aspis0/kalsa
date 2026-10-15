//! The credential the engine refuses to answer without.
//!
//! llama-server serves its whole loopback port to whatever asks, and answers
//! `Access-Control-Allow-Origin: *`, so without this any web page the owner
//! opens can drive the local model and reach the slot routes. The key is what
//! makes the port private to this process: the fork takes it from the
//! environment and refuses every route without it except `/health`,
//! `/v1/health` and its UI assets (kalsallama `common/arg.cpp:3496-3506`,
//! `server-http.cpp:251-300`).
//!
//! It lives in memory and nowhere else. Not in argv, which the supervisor logs
//! whole and writes into the instance state file; not in a file, not in the
//! Keychain, not in an event or an error string. So `Debug` prints a fixed
//! word and every holder is a value that cannot be rendered by accident.

use std::sync::Arc;

/// The name the fork reads the key from — `--api-key`'s environment
/// spelling (`common/arg.cpp:3506`), which keeps it out of argv and out of
/// every renderer's reach.
pub const API_KEY_ENV: &str = "LLAMA_API_KEY";

/// 256 bits, lowercase hex. Minted once per app run and handed to every engine
/// child and every client in this process; a key another process cannot read
/// is the whole of what the loopback port has.
#[derive(Clone)]
pub struct EngineKey(Arc<str>);

impl EngineKey {
    pub fn mint() -> Result<Self, getrandom::Error> {
        let mut bytes = [0u8; 32];
        getrandom::fill(&mut bytes)?;
        Ok(Self(Arc::from(
            bytes
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>(),
        )))
    }

    /// The hex the engine reads, for its environment and for the
    /// `Authorization` header every client sends. The one place the key
    /// leaves this type.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// A key this process was told rather than minted: the two standalone
    /// harnesses run against an engine somebody else started. `None` for
    /// anything that is not exactly what `mint` produces, so a mistyped flag
    /// fails at the door instead of as a 401 nobody can explain.
    pub fn from_hex(value: &str) -> Option<Self> {
        if value.len() != MINTED_HEX {
            return None;
        }
        if !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return None;
        }
        Some(Self(Arc::from(value)))
    }
}

/// 32 bytes of lowercase hex.
const MINTED_HEX: usize = 64;

impl std::fmt::Debug for EngineKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("engine key")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_minted_key_is_256_bits_of_hex_and_not_another_run_s() {
        let one = EngineKey::mint().expect("the OS has randomness");
        let other = EngineKey::mint().expect("the OS has randomness");
        assert_eq!(one.as_str().len(), 64);
        assert!(one.as_str().bytes().all(|b| b.is_ascii_hexdigit()));
        assert!(
            one.as_str().bytes().all(|b| !b.is_ascii_uppercase()),
            "hex is lowercase: the engine compares the value it is given"
        );
        assert_ne!(one.as_str(), other.as_str());
    }

    /// The key is a secret, so a derived `Debug` — on this type, and on any
    /// config that holds one — must not be a way to print it.
    #[test]
    fn a_key_debugs_as_a_fixed_word() {
        let rendered = format!("{:?}", EngineKey::mint().unwrap());
        assert_eq!(rendered, "engine key");
        assert!(!rendered.contains(&EngineKey::mint().unwrap().as_str()[..8]));
    }

    /// The round trip a harness depends on, and the refusals that make a
    /// mistyped `--api-key` a start-up error rather than a 401 later.
    #[test]
    fn a_told_key_is_the_same_key_and_a_wrong_one_is_refused() {
        let minted = EngineKey::mint().unwrap();
        let told = EngineKey::from_hex(minted.as_str()).expect("what mint produced comes back");
        assert_eq!(told.as_str(), minted.as_str());
        assert!(EngineKey::from_hex("").is_none());
        assert!(EngineKey::from_hex(&minted.as_str()[..63]).is_none());
        assert!(EngineKey::from_hex(&minted.as_str().to_uppercase()).is_none());
        assert!(EngineKey::from_hex(&format!("{}z", &minted.as_str()[..63])).is_none());
    }
}
