//! The optional Kalsa review record attached to a catalog entry.

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Review {
    pub commit: String,
    pub date: String,
    pub upstream: String,
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
    Ok(())
}
