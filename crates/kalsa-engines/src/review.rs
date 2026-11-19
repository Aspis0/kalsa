//! The optional Kalsa review record attached to a catalog entry.

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Review {
    pub commit: String,
    pub date: String,
    pub upstream: String,
    #[serde(default)]
    pub approval: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewDeclined {
    pub commit: String,
    pub date: String,
    pub reason: String,
}

pub(crate) fn validate_declined(record: &ReviewDeclined, id: &str) -> Result<(), String> {
    if record.commit.len() != 40 || !record.commit.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(format!("{id}: declined review commit must be 40 hex characters"));
    }
    let bytes = record.date.as_bytes();
    if bytes.len() != 10
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || !bytes.iter().enumerate().all(|(at, byte)| at == 4 || at == 7 || byte.is_ascii_digit())
    {
        return Err(format!("{id}: declined review date must be YYYY-MM-DD"));
    }
    if record.reason.trim().is_empty() {
        return Err(format!("{id}: declined review needs a reason"));
    }
    Ok(())
}

pub(crate) fn validate(review: &Review, id: &str) -> Result<(), String> {
    if !(7..=40).contains(&review.commit.len())
        || !review.commit.chars().all(|c| c.is_ascii_hexdigit())
    {
        return Err(format!("{id}: review commit must be 7–40 hex characters"));
    }
    let bytes = review.date.as_bytes();
    if bytes.len() != 10
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || !bytes
            .iter()
            .enumerate()
            .all(|(at, byte)| at == 4 || at == 7 || byte.is_ascii_digit())
    {
        return Err(format!("{id}: review date must be YYYY-MM-DD"));
    }
    if !crate::valid_repo(&review.upstream) {
        return Err(format!("{id}: review upstream must be owner/name"));
    }
    if let Some(approval) = &review.approval {
        if approval != "approved after human review" {
            return Err(format!("{id}: approval text is not exact"));
        }
    }
    Ok(())
}
