//! Two questions a picker asks: what is in this folder, and what did I touch
//! recently. Both answers are bounded — a folder with forty thousand files
//! must not become forty thousand rows crossing into the page.

use std::fs;
use std::path::{Path, PathBuf};

use crate::entry::{by_folder_then_name, Entry};
use crate::scope::{resolve_within, ScopeError};

/// Rows returned for one folder. Past this the listing is truncated and says
/// so, which is the honest answer to a Downloads folder nobody has ever
/// emptied.
pub const MAX_ROWS: usize = 500;

/// How far back "recent" reaches, in rows, across all roots together.
pub const MAX_RECENT: usize = 40;

/// One folder's contents, sorted folders-first then by name.
///
/// `truncated` is part of the answer, not a detail: a page that silently
/// shows the first 500 of 9000 files is lying about what is on the disk.
pub struct Listing {
    pub path: PathBuf,
    pub entries: Vec<Entry>,
    pub truncated: bool,
}

pub fn list_dir(candidate: &Path, roots: &[PathBuf]) -> Result<Listing, ScopeError> {
    let path = resolve_within(candidate, roots)?;
    let read = fs::read_dir(&path).map_err(ScopeError::Unresolvable)?;

    let mut entries: Vec<Entry> = read
        .flatten()
        .filter_map(|item| Entry::from_dir_entry(&item))
        .collect();
    entries.sort_by(by_folder_then_name);
    let truncated = entries.len() > MAX_ROWS;
    entries.truncate(MAX_ROWS);

    Ok(Listing {
        path,
        entries,
        truncated,
    })
}

/// The newest readable documents across the roots, newest first.
///
/// One level deep on purpose. A recursive walk of a home directory is slow,
/// spins the disk, and is the kind of thing that reads a folder the user
/// never meant to share — the shallow answer is fast, predictable, and
/// covers where documents actually land.
pub fn recent(roots: &[PathBuf]) -> Vec<Entry> {
    let mut found: Vec<Entry> = roots
        .iter()
        .filter_map(|root| fs::read_dir(root).ok())
        .flat_map(|read| read.flatten().collect::<Vec<_>>())
        .filter_map(|item| Entry::from_dir_entry(&item))
        .filter(|entry| !entry.is_dir && entry.kind.readable())
        .collect();

    found.sort_by(Entry::newest_first);
    found.truncate(MAX_RECENT);
    found
}
