//! Small models the catalog suggests for an engine that Kalsa can install.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

const MAX_SUGGESTIONS: usize = 4;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SuggestedModel {
    /// A Hugging Face repo id, optionally pinned to one quant: `owner/name` or `owner/name:Q4_K_M`.
    pub id: String,
    pub note: String,
    /// The download size, only when the catalog knows it exactly. Never a guess.
    #[serde(default, rename(serialize = "sizeBytes", deserialize = "size_bytes"))]
    pub size_bytes: Option<u64>,
}

fn valid_quant(quant: &str) -> bool {
    !quant.is_empty() && quant.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn valid_model_id(id: &str) -> bool {
    match id.split_once(':') {
        Some((repo, quant)) => crate::valid_repo(repo) && valid_quant(quant),
        None => crate::valid_repo(id),
    }
}

pub(crate) fn validate(models: &[SuggestedModel], id: &str, installable: bool) -> Result<(), String> {
    if models.is_empty() {
        return Ok(());
    }
    if !installable {
        return Err(format!("{id}: suggested models need an install recipe"));
    }
    if models.len() > MAX_SUGGESTIONS {
        return Err(format!("{id}: at most {MAX_SUGGESTIONS} suggested models"));
    }
    let mut seen = HashSet::new();
    for model in models {
        if !valid_model_id(&model.id) {
            return Err(format!("{id}: suggested model {} is not a repo id", model.id));
        }
        if !seen.insert(model.id.as_str()) {
            return Err(format!("{id}: suggested model {} appears twice", model.id));
        }
        if model.note.trim().is_empty() || model.note.len() > 80 {
            return Err(format!("{id}: a suggested model needs a short note"));
        }
        if model.size_bytes == Some(0) {
            return Err(format!("{id}: a suggested model size must be positive"));
        }
    }
    Ok(())
}
