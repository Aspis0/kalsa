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
        // Lowercased, and the drive letters and backslashes of a Windows
        // path change nothing: only the extension after the last dot reads.
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

/// One row of a listing. The whole disk is the scope now, so every entry is
/// listed: dotfiles used to be dropped when the crate bounded itself to
/// three document folders, but a browser that hides what search can find
/// teaches the user the list is broken — if a page wants a quieter list it
/// can filter in the page, where a toggle can live.
#[derive(Debug, Clone, Serialize)]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub kind: Kind,
    pub bytes: u64,
    /// Milliseconds since the epoch. Absent when the filesystem does not
    /// keep it.
    pub modified_ms: Option<u64>,
}

impl Entry {
    /// `None` only for entries with no name in Unicode — the row could not
    /// cross the page as JSON without corrupting it.
    pub fn from_dir_entry(entry: &std::fs::DirEntry) -> Option<Self> {
        let path = entry.path();
        let name = entry.file_name().to_str()?.to_owned();
        // A link is listed as what it points at, because clicking it goes
        // there; a broken link stays a plain file-shaped row rather than
        // vanishing. Loops are a walk concern — search does not follow
        // links — and one flat folder cannot loop.
        let file_type = entry.file_type().ok()?;
        let meta = if file_type.is_symlink() {
            std::fs::metadata(&path)
                .or_else(|_| entry.metadata())
                .ok()?
        } else {
            entry.metadata().ok()?
        };
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
}

/// Folders first, then names, both case-insensitively — the order every
/// file manager has used for thirty years, because it is the one people
/// can predict.
pub fn by_folder_then_name(a: &Entry, b: &Entry) -> std::cmp::Ordering {
    b.is_dir
        .cmp(&a.is_dir)
        .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
}
