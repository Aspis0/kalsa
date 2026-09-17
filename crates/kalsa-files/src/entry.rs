//! What the picker shows for one file, and nothing more.
//!
//! The kind is decided by extension, not by sniffing the contents. That is
//! the honest level of confidence for a listing: it is a label on a row the
//! user is about to click, not a promise about the bytes. Whatever opens
//! the file afterwards parses it and finds out for itself — a `.pdf` that
//! is not a PDF must fail there, in the parser, with a real message.

use std::path::Path;
use std::time::UNIX_EPOCH;

use serde::Serialize;

/// The document kinds this app can turn into text. `Other` is listed and
/// greyed out rather than hidden: a file the user can see and cannot pick
/// is a smaller surprise than a file that vanished.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Text,
    Pdf,
    Docx,
    Pptx,
    Other,
}

impl Kind {
    pub fn of(path: &Path) -> Self {
        let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
            return Self::Other;
        };
        match ext.to_ascii_lowercase().as_str() {
            "txt" | "md" | "markdown" | "csv" | "log" | "json" => Self::Text,
            "pdf" => Self::Pdf,
            "docx" => Self::Docx,
            "pptx" => Self::Pptx,
            _ => Self::Other,
        }
    }

    pub fn readable(self) -> bool {
        !matches!(self, Self::Other)
    }
}

/// One row. Symlinks are not listed, so a row describes the file its path
/// named when the folder was read — the disk can still swap that file
/// between the read and the open, which is why the parser that opens the
/// path has the last word. Through [`crate::listing::list_dir`] the parent
/// of the path is the canonical one the boundary approved.
#[derive(Debug, Clone, Serialize)]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub kind: Kind,
    pub bytes: u64,
    /// Milliseconds since the epoch. Absent when the filesystem does not
    /// keep it — sorted last rather than pretended to be zero.
    pub modified_ms: Option<u64>,
}

impl Entry {
    pub fn from_dir_entry(entry: &std::fs::DirEntry) -> Option<Self> {
        let path = entry.path();
        let name = entry.file_name().to_str()?.to_owned();
        // Dotfiles are the machine's business, not the person's.
        if name.starts_with('.') {
            return None;
        }
        // A symlink is dropped, not followed or labeled: labeling the link
        // presents the target's file as a document in this folder, and
        // following it would hand out a path the boundary never approved.
        // Checking the target would need the roots, which this layer is not
        // given — so out it goes.
        if entry.file_type().ok()?.is_symlink() {
            return None;
        }
        let meta = entry.metadata().ok()?;
        let is_dir = meta.is_dir();
        Some(Self {
            name,
            path: path.to_str()?.to_owned(),
            is_dir,
            kind: if is_dir { Kind::Other } else { Kind::of(&path) },
            bytes: if is_dir { 0 } else { meta.len() },
            modified_ms: meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64),
        })
    }

    pub fn newest_first(a: &Self, b: &Self) -> std::cmp::Ordering {
        b.modified_ms
            .unwrap_or(0)
            .cmp(&a.modified_ms.unwrap_or(0))
            .then_with(|| a.name.cmp(&b.name))
    }
}

/// Folders first, then names, both case-insensitively — the order every
/// file manager has used for thirty years, because it is the one people
/// can predict.
pub fn by_folder_then_name(a: &Entry, b: &Entry) -> std::cmp::Ordering {
    b.is_dir
        .cmp(&a.is_dir)
        .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
}
