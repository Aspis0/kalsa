//! Catalog install recipes. Only two kinds exist; no shell, no system tools.

use std::path::Component;

use serde::{Deserialize, Serialize};
use url::Url;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Install {
    ReleaseArchive {
        url: String,
        tag: String,
        sha256: String,
        size: u64,
        binary: String,
    },
    Pip {
        package: String,
        version: String,
        python: String,
        lock: String,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Tooling {
    pub uv: Install,
}

fn github_release(url: &str, tag: &str, id: &str) -> Result<(), String> {
    let parsed = Url::parse(url).map_err(|error| format!("{id}: invalid URL: {error}"))?;
    if parsed.scheme() != "https"
        || parsed.host_str() != Some("github.com")
        || parsed.port().is_some()
        || parsed.username() != ""
        || parsed.password().is_some()
        || !parsed.path().contains(&format!("/releases/download/{tag}/"))
        || tag.is_empty()
        || tag == "latest"
    {
        return Err(format!("{id}: archive URL must be a pinned GitHub release"));
    }
    Ok(())
}

pub(crate) fn validate(install: &Install, id: &str) -> Result<(), String> {
    match install {
        Install::ReleaseArchive { url, tag, sha256, size, binary } => {
            github_release(url, tag, id)?;
            if *size == 0 {
                return Err(format!("{id}: archive size must be positive"));
            }
            if sha256.len() != 64 || !sha256.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()) {
                return Err(format!("{id}: sha256 must be 64 lowercase hex characters"));
            }
            let path = std::path::Path::new(binary);
            if binary.is_empty() || path.is_absolute()
                || path.components().any(|part| part == Component::ParentDir)
            {
                return Err(format!("{id}: archive binary must be a relative path"));
            }
        }
        Install::Pip { package, version, python, lock } => {
            if package.is_empty() || !package.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.')) {
                return Err(format!("{id}: invalid PyPI package name"));
            }
            let parts: Vec<&str> = version.split('.').collect();
            if parts.len() != 3 || !parts.iter().all(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit())) {
                return Err(format!("{id}: pip version must be pinned to three numbers"));
            }
            if !python.starts_with("3.12.") || python.split('.').count() != 3
                || !python.rsplit('.').next().is_some_and(|part| part.bytes().all(|b| b.is_ascii_digit()))
            {
                return Err(format!("{id}: Python must be an exact 3.12 patch version"));
            }
            if !lock.starts_with("catalog/locks/") || std::path::Path::new(lock).components().any(|c| c == Component::ParentDir) {
                return Err(format!("{id}: lock path must be under catalog/locks"));
            }
        }
    }
    Ok(())
}
