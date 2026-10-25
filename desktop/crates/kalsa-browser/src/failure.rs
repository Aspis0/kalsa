//! Fixed diagnostic stages identify failure branches without retaining page content.

use crate::guard;
use crate::input;
use crate::refs;

/// Where a call stopped. **A closed set**, and each one says one fixed word.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Stage {
    RefMissing,
    RefMalformed,
    RefUnprinted,
    /// The evaluation of the action returned an error — not a missing element,
    /// and not a known outcome of the action.
    ActionInputFailed,
    ActionUnfillable,
    ActionPassword,
    ActionDestination,
    ActionNotAccepted,
    ActionDateFormat,
    ReadUnseen,
    ReadAddressRefused,
    ReadMoved,
    ReadDriver,
    /// The read asked for a window the model has already been given.
    ReadAgain,
    /// The page is a human check: the site asks for a person to prove they are
    /// a person, and a model cannot do that for them.
    RobotCheck,
    OpenDriver,
    OpenAddressRefused,
    Paused,
    Unavailable,
    Busy,
    /// The call panicked, and what the window was doing is not known.
    Panicked,
}

impl Stage {
    /// The one word this stage says, on the wire and in the log.
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::RefMissing => "ref_missing",
            Self::RefMalformed => "ref_malformed",
            Self::RefUnprinted => "ref_unprinted",
            Self::ActionInputFailed => "action_input_failed",
            Self::ActionUnfillable => "action_unfillable",
            Self::ActionPassword => "action_password",
            Self::ActionDestination => "action_destination",
            Self::ActionNotAccepted => "action_not_accepted",
            Self::ActionDateFormat => "action_date_format",
            Self::ReadUnseen => "read_unseen",
            Self::ReadAddressRefused => "read_address_refused",
            Self::ReadMoved => "read_moved",
            Self::ReadDriver => "read_driver",
            Self::ReadAgain => "read_again",
            Self::RobotCheck => "robot_check",
            Self::OpenDriver => "open_driver",
            Self::OpenAddressRefused => "open_address_refused",
            Self::Paused => "paused",
            Self::Unavailable => "unavailable",
            Self::Busy => "busy",
            Self::Panicked => "panicked",
        }
    }

    /// Every stage there is, in the order they are written.
    #[cfg(test)]
    pub(crate) fn all() -> &'static [Stage] {
        &[
            Stage::RefMissing,
            Stage::RefMalformed,
            Stage::RefUnprinted,
            Stage::ActionInputFailed,
            Stage::ActionUnfillable,
            Stage::ActionPassword,
            Stage::ActionDestination,
            Stage::ActionNotAccepted,
            Stage::ActionDateFormat,
            Stage::ReadUnseen,
            Stage::ReadAddressRefused,
            Stage::ReadMoved,
            Stage::ReadDriver,
            Stage::ReadAgain,
            Stage::RobotCheck,
            Stage::OpenDriver,
            Stage::OpenAddressRefused,
            Stage::Paused,
            Stage::Unavailable,
            Stage::Busy,
            Stage::Panicked,
        ]
    }
}

/// The stage a refused ref is: the kind travels, not the sentence.
impl From<refs::Refused> for Stage {
    fn from(refused: refs::Refused) -> Self {
        match refused {
            refs::Refused::Nothing => Stage::RefMissing,
            refs::Refused::NotARef => Stage::RefMalformed,
            refs::Refused::NotOnPage => Stage::RefUnprinted,
        }
    }
}

/// The stage a refused action is.
impl From<input::Refused> for Stage {
    fn from(refused: input::Refused) -> Self {
        match refused {
            input::Refused::Gone => Stage::ActionInputFailed,
            input::Refused::NotFillable => Stage::ActionUnfillable,
            input::Refused::Password => Stage::ActionPassword,
            input::Refused::Destination => Stage::ActionDestination,
            input::Refused::NotAccepted => Stage::ActionNotAccepted,
            input::Refused::DateFormat => Stage::ActionDateFormat,
        }
    }
}

/// The stage a refused landing is: a landing we could not see is its own stage.
impl From<guard::Refusal> for Stage {
    fn from(refusal: guard::Refusal) -> Self {
        match refusal {
            guard::Refusal::Unseen => Stage::ReadUnseen,
            _ => Stage::ReadAddressRefused,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{guard, input, refs, Stage};

    /// Every word in the set is ours, and no two stages say the same one.
    #[test]
    fn every_stage_says_one_fixed_word_and_no_two_say_the_same() {
        let mut words: Vec<&str> = Stage::all().iter().map(|stage| stage.as_str()).collect();
        let count = words.len();
        words.sort_unstable();
        words.dedup();
        assert_eq!(words.len(), count, "two stages say the same word");
        assert_eq!(words.len(), Stage::all().len(), "a stage is missing from the set");
        for word in words {
            assert!(!word.is_empty());
            assert!(
                word.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_'),
                "{word} is not a fixed word"
            );
            assert!(!word.starts_with('_') && !word.ends_with('_'), "{word}");
        }
    }

    /// A ref can be refused three ways, and the three are different mistakes.
    #[test]
    fn a_ref_is_refused_in_three_ways_and_each_is_its_own_stage() {
        assert_eq!(Stage::from(refs::Refused::Nothing), Stage::RefMissing);
        assert_eq!(Stage::from(refs::Refused::NotARef), Stage::RefMalformed);
        assert_eq!(Stage::from(refs::Refused::NotOnPage), Stage::RefUnprinted);
    }

    /// **An evaluation that failed is not an element that is gone.**
    #[test]
    fn an_action_whose_evaluation_failed_is_not_an_action_on_a_gone_element() {
        assert_eq!(Stage::from(input::Refused::Gone), Stage::ActionInputFailed);
        assert_ne!(Stage::ActionInputFailed, Stage::RefUnprinted);
        assert_eq!(Stage::from(input::Refused::Password), Stage::ActionPassword);
        assert_eq!(Stage::from(input::Refused::NotFillable), Stage::ActionUnfillable);
        assert_eq!(Stage::from(input::Refused::Destination), Stage::ActionDestination);
        assert_eq!(Stage::from(input::Refused::NotAccepted), Stage::ActionNotAccepted);
        assert_eq!(Stage::from(input::Refused::DateFormat), Stage::ActionDateFormat);
    }

    /// A landing we could not see is not a landing we refused.
    #[test]
    fn a_landing_we_could_not_see_is_not_a_landing_we_refused() {
        assert_eq!(Stage::from(guard::Refusal::Unseen), Stage::ReadUnseen);
        for refused in [
            guard::Refusal::Scheme,
            guard::Refusal::Address,
            guard::Refusal::Unchecked,
            guard::Refusal::Credentials,
        ] {
            assert_eq!(Stage::from(refused), Stage::ReadAddressRefused, "{refused:?}");
        }
    }
}
