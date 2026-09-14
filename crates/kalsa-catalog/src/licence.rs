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
    /// Commercial use is allowed only while a stated condition holds — a
    /// revenue cap on whoever ships the model, for instance. Its own thing on
    /// purpose: collapsing it to `Open` would hide the condition from the
    /// result, and collapsing it to `Blocked` would refuse a row that may
    /// honestly be offered. The condition travels with the row as data.
    Conditional {
        id: &'static str,
        condition: &'static str,
    },
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
            Licence::Conditional { id, .. } => id,
            Licence::Blocked { id, .. } => id,
        }
    }

    /// The condition a conditional licence ships with. Data for the result: a
    /// conditional row must never present itself as unconditional.
    pub fn condition(&self) -> Option<&'static str> {
        match self {
            Licence::Conditional { condition, .. } => Some(condition),
            Licence::Open(_) | Licence::Blocked { .. } => None,
        }
    }

    /// Why this licence closes the door, when it does. A condition is not a
    /// refusal: the door stays open and the condition travels with the row
    /// instead.
    pub fn refusal(&self) -> Option<&'static str> {
        match self {
            Licence::Open(_) | Licence::Conditional { .. } => None,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_condition_is_not_a_refusal_and_not_silence() {
        let lfm = Licence::Conditional {
            id: "lfm1.0",
            condition: "commercial use only for entities under $10M annual revenue",
        };
        assert_eq!(lfm.refusal(), None, "the door stays open");
        assert_eq!(
            lfm.condition(),
            Some("commercial use only for entities under $10M annual revenue"),
            "the condition is data, not prose to be lost"
        );
        assert_eq!(Licence::Open("apache-2.0").condition(), None);
        assert_ne!(lfm.id(), "");
    }
}
