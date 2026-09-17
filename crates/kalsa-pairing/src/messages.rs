//! The completion messages, as data: what the phone sends to finish the
//! handshake, and what the computer answers. The transport carries them; this
//! crate defines them and verifies the first.
//!
//! Both directions are MACs keyed on the one-time secret the QR carried,
//! over domain prefixes that keep the two roles apart — a MAC computed for
//! one direction can never verify in the other:
//!
//! * phone → computer: `HMAC(S, "…/phone-mac/v3" ‖ nonce ‖ len‖reachable ‖
//!   reachable ‖ len‖node ‖ node ‖ len‖token ‖ token ‖ len‖canonical ‖
//!   canonical)` — every field carries its byte length in front of it, so
//!   two different fields can never concatenate into the same bytes (a
//!   reachable shorter by one character and a node id longer by one would,
//!   under a bare concatenation, produce the same MAC). The metadata stops
//!   being asserted and becomes bound, and so does everything the square
//!   showed: the address and, since the square carries the iroh node id,
//!   that too. A square whose node id was swapped produces a declaration
//!   this computer refuses — the pairing goes where the square pointed, or
//!   it does not happen;
//! * computer → phone: `HMAC(S, "…/computer-mac/v2" ‖ nonce ‖ ciphertext)`
//!   — the phone learns that the sender of this encrypted credential knows
//!   the QR it scanned, and that the ciphertext is bound to this ceremony.
//!
//! The node is the empty string when the square carried none (the road was
//! off): absence is a value here, so a square with the field and a square
//! without it can never produce the same MAC.
//!
//! The nonce is fresh per offer and travels in the QR, so a proof recorded
//! in one ceremony is worthless in another. "Canonical phone" is the
//! `serde_json` encoding of [`PhoneFields`]: struct serialization is
//! field-ordered and deterministic, so the phone and this crate compute
//! identical bytes for identical values, whatever whitespace the wire
//! carried. A known-answer test freezes that encoding.
//!
//! What neither MAC claims: identity. Key and nonce both ride the QR, so
//! whoever can see the square can compute either — the domain separates the
//! two *messages*, not two *parties*. The ceiling of this scheme is the
//! square, exactly as the pairing screen says; the MACs prove knowledge of
//! it, and nothing beyond it. In particular, `PhoneDeclaration` is a bearer
//! proof: an active on-path intermediary can capture and inject it first, but
//! the computer retains the encrypted delivery under the declaration's
//! signed, per-attempt token. The phone can re-sign a changed measurement
//! with that token and recover the same seal; the replay no longer consumes
//! the pairing. An intermediary that blocks every response can still delay
//! transport, which is availability, not credential disclosure.

use getrandom::fill;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::fmt;
use subtle::ConstantTimeEq;

use kalsa_catalog::{Parameters, PhoneModel};

use crate::handshake::{Credential, CREDENTIAL_BYTES};
use crate::secret::CODE_BYTES;

const PHONE_DOMAIN: &[u8] = b"kalsa-pairing/phone-mac/v3";
const COMPUTER_DOMAIN: &[u8] = b"kalsa-pairing/computer-mac/v2";
const CREDENTIAL_DOMAIN: &[u8] = b"kalsa-pairing/credential-encryption/v1";
const STREAM_DOMAIN: &[u8] = b"kalsa-pairing/credential-stream/v1";

type HmacSha256 = Hmac<Sha256>;

pub(crate) const MAC_BYTES: usize = 32;
pub(crate) const NONCE_BYTES: usize = 32;
const DELIVERY_TOKEN_BYTES: usize = 16;

/// The phone's shape on the wire and in the store: a serialization shell for
/// `kalsa_catalog::PhoneModel`, not a second description of it. `total ==
/// active` is a dense model; anything else must satisfy `1 <= active <=
/// total` — the constraint `Parameters::mixture` asserts on, which is why it
/// is checked on the way back in, and a file or declaration that fails it is
/// corrupt rather than a crash.
///
/// Beyond that structural check, every value here is a **declaration**: the
/// MAC proves the phone *said* it, never that it is true. A zero weight, a
/// zero or negative speed, a battery flag that is wrong — these pass, and
/// whoever consumes them (the catalog, the UI) treats them as claims from
/// the device, not measurements by this crate.
#[derive(Clone, Serialize, Deserialize)]
pub struct PhoneFields {
    weights_bytes: u64,
    parameters: Option<StoredParameters>,
    measured_tokens_per_second: Option<f64>,
    battery_powered: Option<bool>,
}

// No Debug on purpose: nothing here needs one, and a derived Debug on a
// struct that sits next to a MAC invites logging the pair.
#[derive(Clone, Serialize, Deserialize)]
struct StoredParameters {
    total: u64,
    active: u64,
}

impl PhoneFields {
    pub(crate) fn of(phone: PhoneModel) -> Self {
        Self {
            weights_bytes: phone.weights_bytes,
            parameters: phone.parameters.map(|p| StoredParameters {
                total: p.total().count(),
                active: p.active().count(),
            }),
            measured_tokens_per_second: phone.measured_tokens_per_second,
            battery_powered: phone.battery_powered,
        }
    }

    /// Rebuild the catalog's type, or `None` when the values cannot exist.
    pub(crate) fn into_phone(self) -> Option<PhoneModel> {
        let parameters = match self.parameters {
            None => None,
            Some(p) if p.total == p.active => Some(Parameters::dense(p.total)),
            Some(p) if p.active >= 1 && p.active < p.total => {
                Some(Parameters::mixture(p.total, p.active))
            }
            Some(_) => return None,
        };
        Some(PhoneModel {
            weights_bytes: self.weights_bytes,
            parameters,
            measured_tokens_per_second: self.measured_tokens_per_second,
            battery_powered: self.battery_powered,
        })
    }
}

/// The phone's completion message: its own description, bound to the
/// ceremony by a MAC keyed on the QR's one-time secret. The transport
/// deserializes it and hands it to the ceremony; the ceremony verifies it
/// or burns.
#[derive(Serialize, Deserialize)]
pub struct PhoneDeclaration {
    /// The metadata the phone declares about itself. Covered by the MAC.
    pub phone: PhoneFields,
    /// The phone's MAC over (phone domain ‖ nonce ‖ reachable ‖ node ‖
    /// delivery token ‖ canonical phone), hex.
    pub mac: String,
    /// Stable for this pairing attempt so a retry may carry a fresh
    /// measurement without becoming a different claimant.
    pub(crate) delivery_token: String,
}

impl PhoneDeclaration {
    /// The phone's side of the ceremony: everything it scanned, plus what it
    /// says about itself, signed.
    ///
    /// This exists because the recipe cannot be written down accurately
    /// enough to be re-implemented. The MAC covers `serde_json`'s exact bytes
    /// for [`PhoneFields`] — field order, number formatting, which optional
    /// fields are omitted — and a phone that guesses any of that produces a
    /// message this computer refuses, with the same silent refusal it gives
    /// an attacker. One implementation, shared: the phone links this crate
    /// and calls this, or the protocol is a guess on one side.
    ///
    /// `code`, `nonce`, `reachable` and `node` are the values out of the
    /// square — `node` the square's node id, or `None` when the square
    /// carried none. `None` is returned when any hex field is not the hex
    /// this ceremony writes — a square that was mistyped or truncated cannot
    /// be signed, and saying so here is better than sending a message that
    /// will be refused without a reason.
    pub fn sign(
        code: &str,
        nonce: &str,
        reachable: &str,
        node: Option<&str>,
        phone: PhoneModel,
    ) -> Option<Self> {
        let mut token = [0u8; DELIVERY_TOKEN_BYTES];
        fill(&mut token).ok()?;
        Self::sign_with_token(code, nonce, reachable, node, &hex::encode(token), phone)
    }

    /// Re-sign the same pairing attempt after the phone refreshes its
    /// measurement. The token is created once by [`sign`] and is the only
    /// delivery identity the computer accepts after it has saved the seal.
    pub fn sign_again(
        &self,
        code: &str,
        nonce: &str,
        reachable: &str,
        node: Option<&str>,
        phone: PhoneModel,
    ) -> Option<Self> {
        Self::sign_with_token(
            code,
            nonce,
            reachable,
            node,
            &self.delivery_token,
            phone,
        )
    }

    /// The phone keeps this opaque token with its in-flight attempt. It is
    /// signed inside `mac`; it is not a credential and is safe to serialize.
    pub fn delivery_token(&self) -> &str {
        &self.delivery_token
    }

    /// Compare the signed delivery identity without making the stored seal a
    /// public bearer object. Both sides are fixed-size hex values, so the
    /// value comparison is constant-time after decoding.
    pub fn delivery_token_matches(&self, expected: &str) -> bool {
        let mut actual = [0u8; DELIVERY_TOKEN_BYTES];
        let mut presented = [0u8; DELIVERY_TOKEN_BYTES];
        let actual_ok = hex::decode_to_slice(&self.delivery_token, &mut actual).is_ok();
        let presented_ok = hex::decode_to_slice(expected, &mut presented).is_ok();
        actual_ok && presented_ok && bool::from(actual.ct_eq(&presented))
    }

    fn sign_with_token(
        code: &str,
        nonce: &str,
        reachable: &str,
        node: Option<&str>,
        delivery_token: &str,
        phone: PhoneModel,
    ) -> Option<Self> {
        let mut key = [0u8; CODE_BYTES];
        hex::decode_to_slice(code, &mut key).ok()?;
        let mut nonce_bytes = [0u8; NONCE_BYTES];
        hex::decode_to_slice(nonce, &mut nonce_bytes).ok()?;
        let mut token = [0u8; DELIVERY_TOKEN_BYTES];
        hex::decode_to_slice(delivery_token, &mut token).ok()?;
        let fields = PhoneFields::of(phone);
        let mac = phone_mac_with_token(
            &key,
            &nonce_bytes,
            reachable,
            node.unwrap_or_default(),
            delivery_token,
            &fields,
        );
        Some(Self {
            phone: fields,
            mac: hex::encode(mac),
            delivery_token: hex::encode(token),
        })
    }
}

// A MAC next to the data it authenticates: no derived Debug to log them
// together.
impl fmt::Debug for PhoneDeclaration {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("PhoneDeclaration(_)")
    }
}

/// The computer's answer: a MAC keyed on the same one-time secret, over the
/// computer's domain, covering the nonce and the encrypted credential being
/// delivered.
/// The phone that holds the QR verifies it and learns that the sender of
/// this credential knows the QR it scanned — knowledge of the square being
/// the whole ceiling of this scheme, not a deeper identity.
#[derive(Clone, Deserialize, Serialize)]
pub struct PairingSeal {
    /// The credential encrypted under the QR's one-time secret and nonce.
    /// It is opaque to an intermediary that only carries this response.
    credential_ciphertext: String,
    mac: String,
}

impl PairingSeal {
    fn new(credential_ciphertext: Vec<u8>, mac: [u8; MAC_BYTES]) -> Self {
        Self {
            credential_ciphertext: hex::encode(credential_ciphertext),
            mac: hex::encode(mac),
        }
    }

    /// Verify and open the computer's answer on the phone. The phone already
    /// has both values from the QR, so the wire never needs to carry the
    /// decryption key or the credential in clear text.
    pub fn open(&self, code: &str, nonce: &str) -> Option<String> {
        let key = decode_code(code)?;
        let nonce = decode_nonce(nonce)?;
        let ciphertext = hex::decode(&self.credential_ciphertext).ok()?;
        if ciphertext.len() != CREDENTIAL_BYTES {
            return None;
        }
        let expected = computer_mac(&key, &nonce, &ciphertext);
        let mut presented = [0u8; MAC_BYTES];
        hex::decode_to_slice(&self.mac, &mut presented).ok()?;
        if !bool::from(presented.ct_eq(&expected)) {
            return None;
        }
        Some(hex::encode(crypt(&key, &nonce, &ciphertext)))
    }
}

impl fmt::Debug for PairingSeal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("PairingSeal(_)")
    }
}

fn tag(domain: &[u8], key: &[u8], nonce: &[u8], payload: &[u8]) -> [u8; MAC_BYTES] {
    let Ok(mut mac) = <HmacSha256 as Mac>::new_from_slice(key) else {
        // HMAC-SHA256 accepts keys of any length, so with the fixed-size
        // keys this crate passes this arm is not reachable; a domain hash
        // keeps the function total without a panic in a desktop app — such
        // a tag verifies against nothing.
        let mut fallback = Sha256::new();
        use sha2::Digest;
        fallback.update(domain);
        return fallback.finalize().into();
    };
    mac.update(domain);
    mac.update(nonce);
    mac.update(payload);
    mac.finalize().into_bytes().into()
}

/// The phone's MAC, exactly as the recipe above defines it — exposed so
/// the tests can stand where the phone stands and compose a valid message.
#[cfg(test)]
pub(crate) fn phone_mac(
    key: &[u8; CODE_BYTES],
    nonce: &[u8; NONCE_BYTES],
    reachable: &str,
    node: &str,
    phone: &PhoneFields,
) -> [u8; MAC_BYTES] {
    phone_mac_with_token(key, nonce, reachable, node, "", phone)
}

pub(crate) fn phone_mac_with_token(
    key: &[u8; CODE_BYTES],
    nonce: &[u8; NONCE_BYTES],
    reachable: &str,
    node: &str,
    delivery_token: &str,
    phone: &PhoneFields,
) -> [u8; MAC_BYTES] {
    let canonical = match serde_json::to_vec(phone) {
        Ok(bytes) => bytes,
        // A plain struct cannot fail to serialize; an empty buffer simply
        // verifies against nothing.
        Err(_) => Vec::new(),
    };
    let mut payload = Vec::new();
    field(&mut payload, reachable.as_bytes());
    field(&mut payload, node.as_bytes());
    field(&mut payload, delivery_token.as_bytes());
    field(&mut payload, &canonical);
    tag(PHONE_DOMAIN, key, nonce, &payload)
}

/// One length-delimited field: the byte length in front of the bytes, so
/// that no two different field values can compose the same MAC input. A
/// bare concatenation lets the boundary between adjacent fields shift — a
/// reachable shorter by one character and a node id longer by one would
/// authenticate as one another's document.
fn field(payload: &mut Vec<u8>, bytes: &[u8]) {
    payload.extend_from_slice(&(bytes.len() as u64).to_be_bytes());
    payload.extend_from_slice(bytes);
}

/// Constant-time verification of the phone's completion MAC. A malformed,
/// wrong-length, or wrong-value presentation is the same "no": nothing here
/// says how wrong it was.
#[cfg(test)]
pub(crate) fn verify_phone_mac(
    key: &[u8; CODE_BYTES],
    nonce: &[u8; NONCE_BYTES],
    reachable: &str,
    node: &str,
    phone: &PhoneFields,
    presented: &str,
) -> bool {
    verify_phone_mac_with_token(key, nonce, reachable, node, "", phone, presented)
}

pub(crate) fn verify_phone_mac_with_token(
    key: &[u8; CODE_BYTES],
    nonce: &[u8; NONCE_BYTES],
    reachable: &str,
    node: &str,
    delivery_token: &str,
    phone: &PhoneFields,
    presented: &str,
) -> bool {
    let expected = phone_mac_with_token(key, nonce, reachable, node, delivery_token, phone);
    let mut tag_bytes = [0u8; MAC_BYTES];
    if hex::decode_to_slice(presented, &mut tag_bytes).is_err() {
        return false;
    }
    bool::from(tag_bytes.ct_eq(&expected))
}

/// The computer's answer, over the computer's domain.
pub(crate) fn seal_computer(
    key: &[u8; CODE_BYTES],
    nonce: &[u8; NONCE_BYTES],
    credential: &Credential,
) -> PairingSeal {
    let ciphertext = crypt(key, nonce, credential.bytes());
    PairingSeal::new(ciphertext.clone(), computer_mac(key, nonce, &ciphertext))
}

fn computer_mac(
    key: &[u8; CODE_BYTES],
    nonce: &[u8; NONCE_BYTES],
    ciphertext: &[u8],
) -> [u8; MAC_BYTES] {
    tag(COMPUTER_DOMAIN, key, nonce, ciphertext)
}

fn decode_code(code: &str) -> Option<[u8; CODE_BYTES]> {
    let mut key = [0u8; CODE_BYTES];
    hex::decode_to_slice(code, &mut key).ok()?;
    Some(key)
}

fn decode_nonce(nonce: &str) -> Option<[u8; NONCE_BYTES]> {
    let mut bytes = [0u8; NONCE_BYTES];
    hex::decode_to_slice(nonce, &mut bytes).ok()?;
    Some(bytes)
}

/// Derive a one-off stream key from the QR secret and this offer's nonce.
fn credential_key(key: &[u8; CODE_BYTES], nonce: &[u8; NONCE_BYTES]) -> [u8; MAC_BYTES] {
    tag(CREDENTIAL_DOMAIN, key, nonce, b"key")
}

/// XOR the credential with an HMAC-generated keystream. This is a stream
/// cipher: reusing the derived key/nonce pair for two credentials would
/// expose the XOR of their plaintexts. It is safe here only because every
/// offer gets a fresh nonce and only one credential is ever encrypted under
/// it; a delivery retry replays that same ciphertext.
fn crypt(key: &[u8; CODE_BYTES], nonce: &[u8; NONCE_BYTES], input: &[u8]) -> Vec<u8> {
    let stream_key = credential_key(key, nonce);
    let mut output = Vec::with_capacity(input.len());
    for (block, chunk) in input.chunks(MAC_BYTES).enumerate() {
        let counter = (block as u64).to_be_bytes();
        let stream = tag(STREAM_DOMAIN, &stream_key, nonce, &counter);
        output.extend(chunk.iter().zip(stream).map(|(byte, mask)| byte ^ mask));
    }
    output
}

#[cfg(test)]
mod tests;
