//! The handshake result: what exists once the ceremony completes. The
//! long-lived credential is what the phone will present from now on — after
//! pairing, the phone can reach this computer and nothing else can — and the
//! `PhoneModel` is the phone's own description, taken as given: every field
//! optional, because a phone that declines to say leaves the field empty
//! rather than being guessed about.

use std::fmt;

use getrandom::fill;
use kalsa_catalog::PhoneModel;

use crate::error::EntropyError;

pub(crate) const CREDENTIAL_BYTES: usize = 32;

pub(crate) struct Credential {
    bytes: [u8; CREDENTIAL_BYTES],
}

impl Credential {
    pub(crate) fn generate() -> Result<Self, EntropyError> {
        let mut bytes = [0u8; CREDENTIAL_BYTES];
        fill(&mut bytes).map_err(|_| EntropyError)?;
        Ok(Self { bytes })
    }

    pub(crate) fn hex(&self) -> String {
        hex::encode(self.bytes)
    }

    pub(crate) fn from_hex(presented: &str) -> Option<Self> {
        // Length first, decode into the fixed array: a corrupt store file
        // buys no allocation proportional to its size.
        let mut bytes = [0u8; CREDENTIAL_BYTES];
        hex::decode_to_slice(presented, &mut bytes).ok()?;
        Some(Self { bytes })
    }

    pub(crate) fn bytes(&self) -> &[u8; CREDENTIAL_BYTES] {
        &self.bytes
    }
}

// Same reasoning as the other secrets in this crate: a derived Debug would
// print the credential the first time anything logged the struct.
impl fmt::Debug for Credential {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Credential(_)")
    }
}

pub struct Handshake {
    /// The phone, as it declared itself. Optional fields stay optional: the
    /// rest of the app branches on what the phone actually said.
    pub phone: PhoneModel,
    credential: Credential,
}

impl Handshake {
    pub(crate) fn new(phone: PhoneModel, credential: Credential) -> Self {
        Self { phone, credential }
    }

    /// The credential's rendering — the one delivery path: sent to the phone
    /// over the freshly paired connection, then read back from the store on
    /// later boots. This is not a logging accessor; the `Debug` below never
    /// prints it.
    pub fn credential_hex(&self) -> String {
        self.credential.hex()
    }
}

// The phone's description is safe to show; the credential is not.
impl fmt::Debug for Handshake {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Handshake")
            .field("phone", &self.phone)
            .field("credential", &"Credential(_)")
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::{Credential, Handshake};
    use kalsa_catalog::PhoneModel;

    #[test]
    fn credentials_are_unique_and_roundtrip_through_hex() {
        let first = Credential::generate().unwrap();
        let second = Credential::generate().unwrap();
        assert_ne!(first.hex(), second.hex());
        let roundtripped = Credential::from_hex(&first.hex()).unwrap();
        assert_eq!(roundtripped.bytes(), first.bytes());
    }

    #[test]
    fn a_credential_that_is_not_exactly_64_hex_characters_is_not_one() {
        let credential = Credential::generate().unwrap();
        assert!(Credential::from_hex(&credential.hex()[..62]).is_none());
        assert!(Credential::from_hex("not hex at all").is_none());
    }

    #[test]
    fn the_handshake_debug_carries_the_phone_but_not_the_credential() {
        let handshake = Handshake::new(
            PhoneModel {
                weights_bytes: 1,
                parameters: None,
                measured_tokens_per_second: None,
                battery_powered: None,
            },
            Credential::generate().unwrap(),
        );
        let rendered = format!("{handshake:?}");
        assert!(rendered.contains("weights_bytes: 1"));
        assert!(rendered.contains("Credential(_)"));
        assert!(!rendered.contains(&handshake.credential_hex()));
    }
}
