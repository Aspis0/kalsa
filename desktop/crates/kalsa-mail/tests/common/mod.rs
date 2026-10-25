//! Loads the lab's 48 fixtures and the ground truth they are scored against.
//! Shared by the tests that all need the same mailbox.
// Each test file uses a different part of this, so the unused half of it is expected.
#![allow(dead_code)]

use kalsa_mail::label::Sender;
use kalsa_mail::mail::{self, ParsedMail};
use serde::Deserialize;
use std::path::PathBuf;

pub const FIXTURES: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures");

#[derive(Deserialize)]
pub struct Truth {
    #[serde(rename = "trustedAuth")]
    pub trusted_auth: String,
    pub labels: Vec<TruthMail>,
}

#[derive(Deserialize)]
pub struct TruthMail {
    pub uid: String,
    #[serde(rename = "fixtureId")]
    pub fixture_id: String,
    pub important: bool,
    pub suspicious: bool,
    pub bulk: bool,
    pub reasons: Vec<String>,
}

pub struct Fixture {
    pub uid: u32,
    pub id: String,
    pub mail: ParsedMail,
}

pub fn truth() -> Truth {
    let raw = std::fs::read(PathBuf::from(FIXTURES).join("truth.json")).expect("truth.json");
    serde_json::from_slice(&raw).expect("truth.json is the shape the tests expect")
}

pub fn fixtures() -> Vec<Fixture> {
    let truth = truth();
    truth
        .labels
        .iter()
        .map(|entry| {
            let path =
                PathBuf::from(FIXTURES).join(format!("{}-{}.eml", entry.uid, entry.fixture_id));
            let raw = std::fs::read(&path)
                .unwrap_or_else(|e| panic!("{} is missing: {e}", path.display()));
            Fixture {
                uid: entry.uid.parse().expect("uid is a number"),
                id: entry.fixture_id.clone(),
                mail: mail::parse(&raw),
            }
        })
        .collect()
}

/// The whole mailbox as sender history, which is what the unseen-sender rule reads.
/// The fixture UID is the mailbox order, which is what "seen before" now means.
pub fn senders(fixtures: &[Fixture]) -> Vec<Sender> {
    fixtures
        .iter()
        .map(|f| Sender {
            address: f.mail.from_address.clone(),
            uid: f.uid,
        })
        .collect()
}
