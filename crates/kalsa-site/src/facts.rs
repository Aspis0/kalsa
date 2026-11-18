//! GitHub facts (stars, last push, latest commit) from `site/data/github.json`, filled by a build step.
//! When the file is absent the pages leave those fields out. Nothing here is ever invented.

use std::collections::HashMap;
use std::path::Path;

use serde::Deserialize;

#[derive(Clone, Debug, Default, Deserialize)]
pub struct Fact {
    pub stars: Option<u64>,
    pub pushed: Option<String>,
    pub latest_commit: Option<String>,
}

/// Keyed by "owner/name".
#[derive(Clone, Debug, Default)]
pub struct Facts(HashMap<String, Fact>);

impl Facts {
    pub fn none() -> Self {
        Self::default()
    }

    pub fn parse(text: &str) -> Result<Self, String> {
        serde_json::from_str(text).map(Facts).map_err(|error| error.to_string())
    }

    /// A missing file means "no facts yet"; a broken file stops the build rather than silently hiding data.
    pub fn load(path: &Path) -> Result<Self, String> {
        match std::fs::read_to_string(path) {
            Ok(text) => Self::parse(&text).map_err(|error| format!("{}: {error}", path.display())),
            Err(_) => Ok(Self::none()),
        }
    }

    pub fn get(&self, repo: &str) -> Option<&Fact> {
        self.0.get(repo)
    }
}

/// 1234 is "1.2k".
pub fn stars_label(stars: u64) -> String {
    if stars < 1000 { stars.to_string() } else { format!("{:.1}k", stars as f64 / 1000.0) }
}
