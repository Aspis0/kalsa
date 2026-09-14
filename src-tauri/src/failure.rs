//! The failures "Turn on" can hit, and the only place they become sentences.
//!
//! One enum for the whole walk — the supervisor's own observations ride
//! inside it — and one exhaustive `words`, so a failure a crate learns to
//! report breaks this build until it is given words. Every sentence says
//! what happened and what the user can do; a `detail` payload never crosses
//! it, and nothing the crates say in their own vocabulary reaches the
//! screen.

use kalsa_catalog::RefusalReason;
use kalsa_runtime::DecideError;
use kalsa_supervisor::Failure;

#[derive(Debug)]
pub(crate) enum StartupFailure {
    /// The supervisor's own observations, worded like the rest.
    Supervisor(Failure),
    // — deciding the backend (kalsa-runtime) —
    /// Nothing is published for this kind of computer at all.
    NoBuildForThisMachine,
    /// The release digests were not filled in, so nothing would be verified.
    ServerUnverified,
    /// Every candidate build was fetched or tried and every one failed.
    NoBackendWorked,
    /// The server build could not be put on disk.
    ServerFetchFailed,
    // — choosing the model (kalsa-catalog) —
    MachineNotMeasured,
    PairPhoneFirst,
    NothingFits,
    NothingBetter,
    NothingFastEnough,
    // — placing the model on disk —
    /// The chosen model carries no digest to hold a download to, so no
    /// bytes move: a download that cannot be proven is not downloaded.
    WeightsUnverified,
}

/// The words for a failure. Fail closed: exhaustive over
/// [`StartupFailure`], which is exhaustive over everything the walk can
/// report.
pub(crate) fn words(failure: &StartupFailure) -> String {
    match failure {
        StartupFailure::Supervisor(failure) => supervisor_words(failure),
        StartupFailure::NoBuildForThisMachine => {
            "No version of the assistant has been built for this kind of computer yet. \
             An app update may add one."
                .into()
        }
        StartupFailure::ServerUnverified => {
            "The assistant's server could not be checked against its publisher's record, \
             so nothing was installed. Trying again later usually works."
                .into()
        }
        StartupFailure::NoBackendWorked => {
            "None of the ways of running the assistant work on this computer. \
             An app update may fix this."
                .into()
        }
        StartupFailure::ServerFetchFailed => {
            "The assistant's server could not be brought onto this computer. \
             Checking the connection and trying again usually works."
                .into()
        }
        StartupFailure::MachineNotMeasured => {
            "This computer has not been measured yet. Measuring it first, \
             then turning on, usually works."
                .into()
        }
        StartupFailure::PairPhoneFirst => {
            "Pair the phone first: turning on is only worth it if this computer runs \
             your phone's models better than the phone does."
                .into()
        }
        StartupFailure::NothingFits => {
            "No model that fits this computer is available yet. An app update may add one.".into()
        }
        StartupFailure::NothingBetter => {
            "Nothing available would run your phone's models better than the phone \
             already does. Trying again after an app update may change this."
                .into()
        }
        StartupFailure::NothingFastEnough => {
            "Everything that fits this computer would run too slowly to use. \
             An app update may add faster options."
                .into()
        }
        StartupFailure::WeightsUnverified => {
            "The model chosen for this computer cannot yet be verified against its \
             publisher, so it was not downloaded. A future app update finishes this."
                .into()
        }
    }
}

/// The supervisor's sentences, verbatim from when the supervisor was the
/// only thing that could fail.
fn supervisor_words(failure: &Failure) -> String {
    match failure {
        Failure::PortTaken => "Another program is in the way. Restarting the computer usually clears it.".into(),
        Failure::InstanceUnreadable { .. } => {
            "A copy of the assistant left over from earlier is stuck. Restarting the computer usually clears it.".into()
        }
        Failure::InstanceUnwritable { .. } => {
            "The assistant could not save its place on this computer, so it could not start. Restarting the computer usually clears it.".into()
        }
        Failure::ServerNotStarted { .. } => {
            "The assistant did not start. Turning it on again usually works; if it keeps failing, the app may need to be installed again.".into()
        }
        Failure::ServerExited { .. } => {
            "The assistant stopped on its own. Turning it on again usually works.".into()
        }
        Failure::NotReady { .. } => {
            "The assistant took too long to get ready. Turning it on again usually works.".into()
        }
    }
}

impl From<DecideError> for StartupFailure {
    fn from(error: DecideError) -> Self {
        match error {
            DecideError::NoBuildForThisMachine => Self::NoBuildForThisMachine,
            DecideError::UnverifiedAssets => Self::ServerUnverified,
            DecideError::CannotAcquire(_) => Self::ServerFetchFailed,
            DecideError::NothingWorked { .. } => Self::NoBackendWorked,
        }
    }
}

impl From<kalsa_catalog::Refusal> for StartupFailure {
    fn from(refusal: kalsa_catalog::Refusal) -> Self {
        match refusal.reason {
            RefusalReason::PhoneUnknown => Self::PairPhoneFirst,
            RefusalReason::MachineNotMeasured => Self::MachineNotMeasured,
            RefusalReason::NothingFits => Self::NothingFits,
            RefusalReason::NothingBetter => Self::NothingBetter,
            RefusalReason::NothingFastEnough => Self::NothingFastEnough,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Detail strings that must never reach the screen through `words`.
    const DETAIL: &str = "SECRET-CRATE-DETAIL-SERIAL-7";

    fn every_failure() -> Vec<StartupFailure> {
        vec![
            StartupFailure::Supervisor(Failure::PortTaken),
            StartupFailure::Supervisor(Failure::InstanceUnreadable {
                detail: DETAIL.into(),
            }),
            StartupFailure::Supervisor(Failure::InstanceUnwritable {
                detail: DETAIL.into(),
            }),
            StartupFailure::Supervisor(Failure::ServerNotStarted {
                detail: DETAIL.into(),
            }),
            StartupFailure::Supervisor(Failure::ServerExited {
                detail: DETAIL.into(),
            }),
            StartupFailure::Supervisor(Failure::NotReady { seconds: 600 }),
            StartupFailure::NoBuildForThisMachine,
            StartupFailure::ServerUnverified,
            StartupFailure::NoBackendWorked,
            StartupFailure::ServerFetchFailed,
            StartupFailure::MachineNotMeasured,
            StartupFailure::PairPhoneFirst,
            StartupFailure::NothingFits,
            StartupFailure::NothingBetter,
            StartupFailure::NothingFastEnough,
            StartupFailure::WeightsUnverified,
        ]
    }

    #[test]
    fn every_failure_speaks_without_leaking_a_detail() {
        for failure in every_failure() {
            let spoken = words(&failure);
            assert!(!spoken.trim().is_empty(), "{failure:?} says nothing");
            assert!(
                !spoken.contains(DETAIL),
                "{failure:?} leaks the crate's own words: {spoken}"
            );
        }
    }

    #[test]
    fn every_failure_says_what_the_user_can_do() {
        // Each sentence points somewhere: again, an update, a restart, the
        // Model page or the phone. A dead end is not a sentence.
        for failure in every_failure() {
            let spoken = words(&failure);
            let actionable = ["again", "update", "restart", "measure", "pair", "space"]
                .iter()
                .any(|word| spoken.to_ascii_lowercase().contains(word));
            assert!(actionable, "{failure:?} is a dead end: {spoken}");
        }
    }
}
