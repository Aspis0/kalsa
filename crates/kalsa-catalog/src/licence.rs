//! Licence and what it means for a row.
//!
//! The licence is not a column to look at, it is a door: a row that cannot be
//! used commercially must be **unable** to reach the chooser. So the only thing
//! the chooser accepts is a `UsableEntry`, and the manifest only hands those out
//! for rows whose standing is `Usable`. Rows refused for licence or age stay in
//! the manifest — with the reason — so nobody redoes the research.

/// Verbatim `cardData.license` from the Hugging Face API, plus what it means for
/// us. Kept for refused rows too: the reason is part of the record.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Licence {
    /// Commercial use is allowed.
    Open(&'static str),
    /// Commercial use is not allowed.
    Blocked {
        id: &'static str,
        reason: &'static str,
    },
}

impl Licence {
    pub fn id(&self) -> &'static str {
        match self {
            Licence::Open(id) => id,
            Licence::Blocked { id, .. } => id,
        }
    }

    /// Why this licence closes the door, when it does.
    pub fn refusal(&self) -> Option<&'static str> {
        match self {
            Licence::Open(_) => None,
            Licence::Blocked { reason, .. } => Some(reason),
        }
    }
}

/// Whether a row may be chosen, and if not, why not.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Standing {
    Usable,
    Excluded { reason: &'static str },
}

impl Standing {
    pub fn is_usable(&self) -> bool {
        matches!(self, Standing::Usable)
    }
}
