//! The one question a picker asks: what is in this folder. The answer is
//! bounded — a folder with forty thousand files must not become forty
//! thousand rows crossing into the page, and a folder with two hundred
//! thousand must still answer, not hang.

use std::fs;
use std::path::{Path, PathBuf};

use crate::entry::{by_folder_then_name, Entry};
use crate::scope::{resolve, ScopeError};

/// Rows returned for one folder. Past this the listing is truncated and says
/// so, which is the honest answer to a Downloads folder nobody has ever
/// emptied.
pub const MAX_ROWS: usize = 500;

/// One folder's contents, sorted folders-first then by name.
///
/// `truncated` is part of the answer, not a detail: a page that silently
/// shows the first 500 of 9000 files is lying about what is on the disk.
pub struct Listing {
    pub path: PathBuf,
    pub entries: Vec<Entry>,
    pub truncated: bool,
}

pub fn list_dir(candidate: &Path) -> Result<Listing, ScopeError> {
    let path = resolve(candidate)?;
    let read = fs::read_dir(&path).map_err(ScopeError::Unresolvable)?;

    // Phase one reads names only — `file_type` comes free with readdir, no
    // stat per entry — which is what keeps a two-hundred-thousand-entry
    // folder a second of work instead of a minute of them. The kept rows
    // are the only ones that earn their stats.
    let mut rows: Vec<(bool, String, fs::DirEntry)> = read
        .flatten()
        .filter_map(|item| {
            let is_dir = item.file_type().ok()?.is_dir();
            let key = item.file_name().to_str()?.to_lowercase();
            Some((is_dir, key, item))
        })
        .collect();
    let truncated = rows.len() > MAX_ROWS;
    rows.truncate(MAX_ROWS);

    let mut entries: Vec<Entry> = rows
        .iter()
        .filter_map(|(_, _, item)| Entry::from_dir_entry(item))
        .collect();
    // Re-sorted on the real labels: a link to a folder is displayed as a
    // folder, so it must sit with the folders in the page too.
    entries.sort_by(by_folder_then_name);

    Ok(Listing {
        path,
        entries,
        truncated,
    })
}
