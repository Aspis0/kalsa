//! The failures "Turn on" can hit, and the only place they become sentences.
//!
//! One enum for the whole walk — the supervisor's own observations ride
//! inside it — and one exhaustive `words`, so a failure a crate learns to
//! report breaks this build until it is given words. Every sentence says
//! what happened and what the user can do; a `detail` payload never crosses
//! it, and nothing the crates say in their own vocabulary reaches the
//! screen. The one carrying over is deliberate: the probe's reliability
//! notes were written for the user, numbers included, and they are the only
//! words in the app that name the exact reason a measurement failed.

use kalsa_catalog::RefusalReason;
use kalsa_download::DownloadError;
use kalsa_launch::KvCache;
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
    NothingFits,
    NothingBetter,
    NothingFastEnough,
    // — starting the server (kalsa-launch) —
    /// The chosen model cannot be given even one token of context within
    /// this machine's budget: it is never started smaller, the start fails.
    ChosenModelUnfundable,
    /// The chosen model's trained context length arrived as a zero: the
    /// field was in its header and reads as nothing a conversation can be
    /// sized with. That is a fact about the model's data, never about this
    /// machine's memory, so it must not wear the unfundable refusal's words.
    ChosenModelContextUnreadable,
    /// The user requested more context than this model's budget funds.
    ContextTooLarge {
        /// The most tokens this start path can give the chosen model.
        maximum_tokens: u64,
        /// The cache the maximum was funded for. `None` on the development
        /// path, whose fixed ceiling does not depend on the cache.
        cache: Option<KvCache>,
    },
    /// The selection the catalog returned does not name exactly one row, so
    /// starting would run numbers that belong to some other row.
    ChosenModelUnresolved,
    /// The probe retried past its budget and still calls the measurement
    /// unreliable: deciding on it would decide on noise. The notes are the
    /// probe's own words for what its checks saw on the last attempt —
    /// written for the user, with the numbers in them.
    MeasurementUnreliable(Vec<String>),
    // — the disk tier —
    /// The directory the engine saves a chat's KV state into could not be
    /// created or permissioned. The engine refuses a `--slot-save-path` that
    /// is not a directory, so the walk stops here rather than fetching a
    /// model for an engine that cannot start.
    SlotSavePathUnwritable,
    // — placing the model on disk —
    /// The chosen model carries no digest to hold a download to, so no
    /// bytes move: a download that cannot be proven is not downloaded.
    WeightsUnverified,
    /// The disk was short before or during the model download.
    NotEnoughDisk,
    /// The downloaded bytes did not match the publisher's record; they were
    /// thrown away.
    DownloadCorrupted,
    /// The connection dropped partway through. What arrived stays for the
    /// next try.
    ConnectionLost,
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
        StartupFailure::ChosenModelUnfundable => {
            "The model chosen for this computer needs more memory than the computer can \
             give it, even to start. An app update may bring a smaller option."
                .into()
        }
        StartupFailure::ChosenModelContextUnreadable => {
            "The model chosen for this computer does not say how long a conversation \
             it was built for, so it was not started. An app update may fix this."
                .into()
        }
        StartupFailure::ContextTooLarge {
            maximum_tokens,
            cache,
        } => match cache {
            Some(cache) => format!(
                "This context is larger than the {maximum_tokens} tokens the chosen model \
                 can hold on this computer with the {} cache. Choose a smaller context in \
                 Advanced and try again.",
                cache.flag()
            ),
            None => format!(
                "This context is larger than the {maximum_tokens} tokens this development \
                 setup allows. Choose a smaller context in Advanced and try again."
            ),
        },
        StartupFailure::ChosenModelUnresolved => {
            "The model chosen for this computer could not be matched to its catalogue \
             entry, so it was not started. An app update may fix this."
                .into()
        }
        StartupFailure::MeasurementUnreliable(notes) => measurement_unreliable_words(notes),
        StartupFailure::SlotSavePathUnwritable => {
            "The assistant could not prepare the place on this computer where chats are \
             kept, so it did not start."
                .into()
        }
        StartupFailure::WeightsUnverified => {
            "The model chosen for this computer cannot yet be verified against its \
             publisher, so it was not downloaded. A future app update finishes this."
                .into()
        }
        StartupFailure::NotEnoughDisk => {
            "There is not enough room on the disk for the assistant's model. \
             Freeing some space and trying again usually works."
                .into()
        }
        StartupFailure::DownloadCorrupted => {
            "The model download did not match the publisher's record, so it was \
             thrown away. Trying again usually works."
                .into()
        }
        StartupFailure::ConnectionLost => {
            "The connection dropped partway through. Trying again keeps what was \
             already downloaded."
                .into()
        }
    }
}

/// The measurement failure, told in three parts: the approved opening, the
/// probe's own reason, the approved advice. The notes were written where the
/// numbers were; this only stands them up as sentences between the words that
/// were already approved — every note that fired, since a machine can fail two
/// checks at once. When no note arrived, the standing sentence says all that
/// was known.
fn measurement_unreliable_words(notes: &[String]) -> String {
    const OPENING: &str = "This computer could not be measured just now — it may be busy.";
    const ADVICE: &str = "Waiting a moment and turning on again usually works.";
    let mut spoken = String::from(OPENING);
    for note in notes {
        let mut sentence = note.trim().to_string();
        if let Some(first) = sentence.get_mut(..1) {
            first.make_ascii_uppercase();
        }
        sentence.push('.');
        spoken.push(' ');
        spoken.push_str(&sentence);
    }
    spoken.push(' ');
    spoken.push_str(ADVICE);
    spoken
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
        Failure::UnsafeBinding { .. } => {
            "The assistant was about to start in an unsafe way and stopped itself. An app \
             update may fix this."
                .into()
        }
        // The measures are deliberately NOT printed: they are this crate's
        // own vocabulary (pids, ports, walk details) and the file's rule is
        // that a `detail` payload never crosses into a sentence.
        Failure::StopUnconfirmed { .. } => {
            "The assistant's server could not be confirmed gone when it was turned off, so the \
             app has not reported it as off. Restarting the computer usually clears it."
                .into()
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

impl From<DownloadError> for StartupFailure {
    fn from(error: DownloadError) -> Self {
        match error {
            DownloadError::Io(_) => Self::ConnectionLost,
            DownloadError::DiskFull | DownloadError::NotEnoughSpace { .. } => Self::NotEnoughDisk,
            DownloadError::SizeMismatch { .. } | DownloadError::DigestMismatch { .. } => {
                Self::DownloadCorrupted
            }
        }
    }
}

impl From<kalsa_catalog::Refusal> for StartupFailure {
    fn from(refusal: kalsa_catalog::Refusal) -> Self {
        match refusal.reason {
            // Structurally unreachable from the walk: `choose` runs only
            // when a phone is in the input it is given, and the phone-free
            // question never produces this reason. The arm exists because
            // the conversion is total over the catalog's enum, and what it
            // maps to matters for the day the structure changes: it used to
            // answer `NothingBetter`, which tells the owner that nothing
            // beats their phone — a confident claim about a machine nobody
            // compared, and the one sentence this case must not say. An
            // impossible answer from the catalogue is a fault in us, so it
            // reads as one.
            RefusalReason::PhoneUnknown => Self::ChosenModelUnresolved,
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
            StartupFailure::Supervisor(Failure::StopUnconfirmed {
                measures: DETAIL.into(),
            }),
            StartupFailure::NoBuildForThisMachine,
            StartupFailure::ServerUnverified,
            StartupFailure::NoBackendWorked,
            StartupFailure::ServerFetchFailed,
            StartupFailure::MachineNotMeasured,
            StartupFailure::MeasurementUnreliable(vec![
                "the repetitions disagreed by 35%: something else was using this machine \
                 while it was measured"
                    .into(),
            ]),
            StartupFailure::NothingFits,
            StartupFailure::NothingBetter,
            StartupFailure::NothingFastEnough,
            StartupFailure::ChosenModelContextUnreadable,
            StartupFailure::ChosenModelUnresolved,
            StartupFailure::SlotSavePathUnwritable,
            StartupFailure::WeightsUnverified,
            StartupFailure::NotEnoughDisk,
            StartupFailure::DownloadCorrupted,
            StartupFailure::ConnectionLost,
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

    /// The causes the user cannot act on, named one by one. A failure joins this
    /// list only by an edit here, and that edit is the claim that no true
    /// instruction exists to give. `SlotSavePathUnwritable` is the app
    /// failing to prepare its own directory under the data directory it was
    /// given: a fact about the filesystem, not about what the user typed.
    fn unrecoverable(failure: &StartupFailure) -> bool {
        matches!(failure, StartupFailure::SlotSavePathUnwritable)
    }

    #[test]
    fn every_failure_says_what_the_user_can_do() {
        // Each sentence points somewhere: again, an update, a restart, the
        // Model page, the phone. A dead end is not a sentence — unless it is
        // declared, and a declared one must not also hand out advice.
        for failure in every_failure() {
            let spoken = words(&failure);
            let actionable = ["again", "update", "restart", "measure", "pair", "space"]
                .iter()
                .any(|word| spoken.to_ascii_lowercase().contains(word));
            assert!(actionable || unrecoverable(&failure), "{failure:?} is a dead end: {spoken}");
            assert!(
                !(actionable && unrecoverable(&failure)),
                "{failure:?} is declared a dead end but still advises: {spoken}"
            );
        }
    }

    #[test]
    fn the_measurement_failure_says_what_the_probe_saw() {
        // The probe's notes, in the order they fired, standing as sentences
        // between the approved opening and the approved advice.
        let spoken = words(&StartupFailure::MeasurementUnreliable(vec![
            "the repetitions disagreed by 35%: something else was using this machine \
             while it was measured"
                .to_string(),
            "this process received 0.5 cores while the probe ran 10 threads: the machine \
             is busy"
                .to_string(),
        ]));
        assert_eq!(
            spoken,
            "This computer could not be measured just now — it may be busy. \
             The repetitions disagreed by 35%: something else was using this machine \
             while it was measured. \
             This process received 0.5 cores while the probe ran 10 threads: the machine \
             is busy. \
             Waiting a moment and turning on again usually works."
        );
    }

    #[test]
    fn a_measurement_failure_without_notes_says_the_standing_sentence() {
        // No note arrived, so there is no reason to tell; the sentence must
        // be exactly what it has always been.
        assert_eq!(
            words(&StartupFailure::MeasurementUnreliable(Vec::new())),
            "This computer could not be measured just now — it may be busy. \
             Waiting a moment and turning on again usually works."
        );
    }
}
