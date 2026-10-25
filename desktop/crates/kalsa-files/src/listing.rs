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

/// When the kept rows are pruned mid-scan, they get this much headroom
/// first — sorting per insertion would be quadratic, truncating at exactly
/// the cap would re-sort on nearly every entry.
const PRUNE_HEADROOM: usize = MAX_ROWS + MAX_ROWS / 5;

/// One folder's contents, folders first then by name.
///
/// `truncated` is part of the answer, not a detail: a page that silently
/// shows the first 500 of 9000 files is lying about what is on the disk.
/// `skipped` is the same honesty one level down — children the OS would not
/// let us read (a denied subfolder, a name that is not Unicode) are counted,
/// not vanished.
pub struct Listing {
    pub path: PathBuf,
    pub entries: Vec<Entry>,
    pub truncated: bool,
    pub skipped: u64,
}

/// The scan key: folders first, then lowercased names — the same order the
/// page shows, so "first 500" means the alphabetically first 500, not
/// whatever order the filesystem happened to hand us. Which 500 survive a
/// cap is a product answer, and this is it: deterministic, explainable, and
/// never hiding `A.txt` because the readdir hash put it late.
fn scan_key(is_dir: bool, name: &str) -> (bool, String) {
    (!is_dir, name.to_lowercase())
}

pub fn list_dir(candidate: &Path) -> Result<Listing, ScopeError> {
    let path = resolve(candidate)?;
    let read = fs::read_dir(&path).map_err(ScopeError::Unresolvable)?;

    // Phase one reads names only — `file_type` comes free with readdir, no
    // stat per entry — and keeps a BOUNDED set: the best 600 by the order
    // the page will show. A two-hundred-thousand-entry folder allocates
    // rows for six hundred of them, never two hundred thousand.
    let mut rows: Vec<((bool, String), fs::DirEntry)> = Vec::new();
    let mut truncated = false;
    let mut skipped: u64 = 0;
    for item in read {
        let Ok(item) = item else {
            skipped += 1;
            continue;
        };
        let Ok(file_type) = item.file_type() else {
            skipped += 1;
            continue;
        };
        let name_os = item.file_name();
        let Some(name) = name_os.to_str() else {
            skipped += 1; // no Unicode, no JSON, no row — but said, not hidden
            continue;
        };
        rows.push((scan_key(file_type.is_dir(), name), item));
        if rows.len() > PRUNE_HEADROOM {
            prune(&mut rows);
            truncated = true;
        }
    }
    rows.sort_by(|a, b| a.0.cmp(&b.0));
    if rows.len() > MAX_ROWS {
        rows.truncate(MAX_ROWS);
        truncated = true;
    }

    let entries: Vec<Entry> = rows
        .iter()
        .filter_map(|(_, item)| Entry::from_dir_entry(item))
        .collect();
    // from_dir_entry returns None only for a stat failure here — the name
    // and file_type already survived above — so the difference is exactly
    // the unreadable children.
    let stat_failed = rows.len() - entries.len();
    let skipped = skipped + stat_failed as u64;

    // Re-sorted on the real labels: a link to a folder is displayed as a
    // folder, so it must sit with the folders in the page too.
    let mut entries = entries;
    entries.sort_by(by_folder_then_name);

    Ok(Listing {
        path,
        entries,
        truncated,
        skipped,
    })
}

/// Keep the best MAX_ROWS by the scan key, in one sort.
fn prune(rows: &mut Vec<((bool, String), fs::DirEntry)>) {
    rows.sort_by(|a, b| a.0.cmp(&b.0));
    rows.truncate(MAX_ROWS);
}
