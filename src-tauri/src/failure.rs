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

use serde::Serialize;

use kalsa_catalog::RefusalReason;
use kalsa_download::DownloadError;
use kalsa_launch::KvCache;
use kalsa_runtime::DecideError;
use kalsa_supervisor::Failure;

#[derive(Clone, Debug)]
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
    /// A fetch died on the wire — DNS, connect, TLS, a silenced host —
    /// before any backend could be tried: the probe model's, or every
    /// engine archive fetch. The network is the fixable fact; an engine
    /// that was tried and failed says the other sentence.
    EngineUnreachable,
    // — starting the server (kalsa-launch) —
    /// The chosen model needs more memory than this machine can give it:
    /// the launch path refuses when not even one token of context fits, and
    /// the chooser refuses the same way when the row misses the budget it
    /// was asked about. Never started smaller either way; the choice is
    /// kept, because it says what the owner picked, not what fits.
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
    /// Nobody has chosen a model, so nothing may download: `brain_start`
    /// refuses with it before walking, and the model's fetch refuses with
    /// it again if a walk ever gets that far without a choice.
    AwaitingChoice,
    /// The chosen model carries no digest to hold a download to, so no
    /// bytes move: a download that cannot be proven is not downloaded.
    WeightsUnverified,
    /// The disk was short before or during the model download: by how many
    /// bytes, when the download's own check could say.
    NotEnoughDisk(Option<u64>),
    /// The downloaded bytes did not match the publisher's record; they were
    /// thrown away.
    DownloadCorrupted,
    /// The connection dropped partway through. What arrived stays for the
    /// next try.
    ConnectionLost,
    /// The publisher's server answered but did not allow the download: an
    /// HTTP refusal, not a dropped connection.
    DownloadRefused,
    /// A local file refused the model bytes: the destination or the part
    /// file is held by another program, unreadable, or unwritable.
    ModelFileUnwritable,
}

/// The failure as the wire carries it: a stable code the webview renders in
/// the owner's language, the values that sentence may name, and the English
/// sentence a phone client or an unknown code still shows.
#[derive(Clone, Debug, Serialize)]
pub(crate) struct FailureMessage {
    pub code: String,
    pub params: serde_json::Value,
    pub text: String,
}

impl StartupFailure {
    /// The stable code and its user-useful values. Exhaustive over the
    /// enum; a code is never derived from English text, and a param is
    /// never a path, a credential or a probe note.
    pub(crate) fn code_and_params(&self) -> (&'static str, serde_json::Value) {
        match self {
            Self::Supervisor(failure) => match failure {
                Failure::PortTaken
                | Failure::InstanceUnreadable { .. }
                | Failure::InstanceUnwritable { .. } => ("startup.restart", serde_json::json!({})),
                Failure::ServerNotStarted { .. } => {
                    ("startup.could_not_start", serde_json::json!({}))
                }
                Failure::ServerExited { .. } => ("startup.stopped", serde_json::json!({})),
                Failure::NotReady { .. } => ("startup.took_too_long", serde_json::json!({})),
                Failure::UnsafeBinding { .. } => ("startup.cannot_run_yet", serde_json::json!({})),
                Failure::StopUnconfirmed { .. } => {
                    ("startup.stop_unconfirmed", serde_json::json!({}))
                }
            },
            Self::NoBuildForThisMachine | Self::NoBackendWorked => {
                ("startup.cannot_run_yet", serde_json::json!({}))
            }
            Self::ServerUnverified
            | Self::DownloadCorrupted
            | Self::DownloadRefused => ("startup.download_failed", serde_json::json!({})),
            Self::ServerFetchFailed | Self::ConnectionLost => {
                ("startup.connection_lost", serde_json::json!({}))
            }
            Self::MachineNotMeasured => ("startup.needs_check", serde_json::json!({})),
            Self::NothingFits | Self::NothingFastEnough | Self::NothingBetter => {
                ("startup.no_suitable_choice", serde_json::json!({}))
            }
            Self::EngineUnreachable => {
                ("startup.network_blocks_download", serde_json::json!({}))
            }
            Self::ChosenModelUnfundable => ("startup.choice_too_large", serde_json::json!({})),
            Self::ChosenModelContextUnreadable | Self::ChosenModelUnresolved => {
                ("startup.choice_unavailable", serde_json::json!({}))
            }
            Self::ContextTooLarge { .. } => {
                ("startup.conversation_too_long", serde_json::json!({}))
            }
            Self::MeasurementUnreliable(_) => ("startup.check_failed", serde_json::json!({})),
            Self::SlotSavePathUnwritable => {
                ("startup.could_not_start", serde_json::json!({}))
            }
            Self::AwaitingChoice => ("startup.awaiting_choice", serde_json::json!({})),
            Self::WeightsUnverified => ("startup.choice_unavailable", serde_json::json!({})),
            Self::NotEnoughDisk(short) => (
                "startup.disk_full",
                match short {
                    // Rounded up like the sentence's own figure: freeing the
                    // named amount must be enough.
                    Some(short) => serde_json::json!({ "gb": (*short as f64 / 1e8).ceil() / 10.0 }),
                    None => serde_json::json!({}),
                },
            ),
            Self::ModelFileUnwritable => ("startup.could_not_start", serde_json::json!({})),
        }
    }

    /// The wire form: code, params, and the English fallback.
    pub(crate) fn message(&self) -> FailureMessage {
        let (code, params) = self.code_and_params();
        FailureMessage {
            code: code.into(),
            params,
            text: words(self),
        }
    }
}

/// The words for a failure. Fail closed: exhaustive over
/// [`StartupFailure`], which is exhaustive over everything the walk can
/// report.
pub(crate) fn words(failure: &StartupFailure) -> String {
    match failure {
        StartupFailure::Supervisor(failure) => supervisor_words(failure),
        StartupFailure::NoBuildForThisMachine => {
            "Kalsa can't run on this computer yet. Check for an app update.".into()
        }
        StartupFailure::ServerUnverified => {
            "Kalsa couldn't finish downloading. Try again later.".into()
        }
        StartupFailure::NoBackendWorked => {
            "Kalsa can't run on this computer yet. Check for an app update.".into()
        }
        StartupFailure::ServerFetchFailed => {
            "Kalsa couldn't download what she needs. Check your connection and try again."
                .into()
        }
        StartupFailure::MachineNotMeasured => {
            "Kalsa needs to check this computer before she can start. Try again.".into()
        }
        StartupFailure::NothingFits => {
            "Kalsa doesn't have an AI that runs well on this computer yet. \
             Check for an app update."
                .into()
        }
        // The owner's ruling: the phone never gates the brain. This arm is
        // unreachable from the automatic walk — the fallback takes the
        // comparison's refusal — and keeps a truthful sentence for as long
        // as the enum arm exists.
        StartupFailure::NothingBetter => {
            "Kalsa doesn't have an AI that runs well on this computer yet. \
             Check for an app update."
                .into()
        }
        StartupFailure::NothingFastEnough => {
            "Kalsa doesn't have an AI that runs well on this computer yet. \
             Check for an app update."
                .into()
        }
        StartupFailure::EngineUnreachable => {
            "Kalsa couldn't download what she needs on this network. Try another network."
                .into()
        }
        StartupFailure::ChosenModelUnfundable => {
            "This AI is too big for this computer. Pick a smaller one on the AI page."
                .into()
        }
        StartupFailure::ChosenModelContextUnreadable => {
            "Kalsa couldn't start with this AI. Pick another one on the AI page.".into()
        }
        StartupFailure::ContextTooLarge {
            maximum_tokens,
            cache,
        } => {
            let _ = (maximum_tokens, cache);
            "This conversation length is too long for this AI. Choose a smaller one in \
             Advanced."
                .into()
        }
        StartupFailure::ChosenModelUnresolved => {
            "Kalsa couldn't start with this AI. Pick another one on the AI page.".into()
        }
        StartupFailure::MeasurementUnreliable(_) => {
            "Kalsa couldn't check this computer. Wait a moment and try again.".into()
        }
        StartupFailure::SlotSavePathUnwritable => {
            "Kalsa couldn't start. Try again.".into()
        }
        StartupFailure::AwaitingChoice => {
            "Kalsa isn't set up yet. Go to Home and press Start.".into()
        }
        StartupFailure::WeightsUnverified => {
            "Kalsa couldn't start with this AI. Pick another one on the AI page.".into()
        }
        StartupFailure::NotEnoughDisk(Some(short)) => format!(
            "Kalsa needs more space. Free up {:.1} GB and try again.",
            // Rounded up: freeing the figure shown must be enough.
            (*short as f64 / 1e8).ceil() / 10.0
        ),
        StartupFailure::NotEnoughDisk(None) => {
            "Kalsa needs more space. Free up some room and try again.".into()
        }
        StartupFailure::DownloadCorrupted => {
            "Kalsa couldn't finish downloading. Try again later.".into()
        }
        StartupFailure::ConnectionLost => {
            "Kalsa couldn't download what she needs. Check your connection and try again."
                .into()
        }
        StartupFailure::DownloadRefused => {
            "Kalsa couldn't finish downloading. Try again later.".into()
        }
        StartupFailure::ModelFileUnwritable => {
            "Kalsa couldn't start. Try again.".into()
        }
    }
}

/// The supervisor's sentences, verbatim from when the supervisor was the
/// only thing that could fail.
fn supervisor_words(failure: &Failure) -> String {
    match failure {
        Failure::PortTaken
        | Failure::InstanceUnreadable { .. }
        | Failure::InstanceUnwritable { .. } => {
            "Kalsa couldn't start. Restart this computer and try again.".into()
        }
        Failure::ServerNotStarted { .. } => "Kalsa couldn't start. Try again.".into(),
        Failure::ServerExited { .. } => "Kalsa stopped by herself. Turn her on again.".into(),
        Failure::NotReady { .. } => "Kalsa took too long to get ready. Try again.".into(),
        Failure::UnsafeBinding { .. } => {
            "Kalsa can't run on this computer yet. Check for an app update.".into()
        }
        // The measures are deliberately NOT printed: they are this crate's
        // own vocabulary (pids, ports, walk details) and the file's rule is
        // that a `detail` payload never crosses into a sentence.
        Failure::StopUnconfirmed { .. } => {
            "Kalsa may still be running. Restart this computer to turn her off.".into()
        }
    }
}

impl From<DecideError> for StartupFailure {
    fn from(error: DecideError) -> Self {
        match error {
            DecideError::NoBuildForThisMachine => Self::NoBuildForThisMachine,
            DecideError::UnverifiedAssets => Self::ServerUnverified,
            DecideError::CannotAcquire(_) => Self::ServerFetchFailed,
            // A full disk gets the disk's sentence, not the connection's.
            DecideError::StorageFull => Self::NotEnoughDisk(None),
            DecideError::NothingWorked { .. } => Self::NoBackendWorked,
            // The wire refused before any answer existed — the probe
            // model's fetch or every candidate's: the sentence that names
            // the network, not one that blames the builds.
            DecideError::EngineUnreachable { .. } => Self::EngineUnreachable,
        }
    }
}

impl From<DownloadError> for StartupFailure {
    fn from(error: DownloadError) -> Self {
        match error {
            // The halves, as the production sites split them: the wire
            // splits again at an HTTP status — a refusal is not a dropped
            // connection — and a file this machine refused gets its own
            // words, because "connection" would be false.
            DownloadError::Network(_) | DownloadError::Unreachable(_) => Self::ConnectionLost,
            DownloadError::Refused { .. } => Self::DownloadRefused,
            DownloadError::Io(_) => Self::ModelFileUnwritable,
            DownloadError::DiskFull => Self::NotEnoughDisk(None),
            DownloadError::NotEnoughSpace { free, needed } => {
                Self::NotEnoughDisk(Some(needed.saturating_sub(free)))
            }
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
            StartupFailure::NotEnoughDisk(Some(2_100_000_000)),
            StartupFailure::NotEnoughDisk(None),
            StartupFailure::DownloadCorrupted,
            StartupFailure::ConnectionLost,
            StartupFailure::DownloadRefused,
            StartupFailure::ModelFileUnwritable,
            StartupFailure::EngineUnreachable,
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
    fn a_full_disk_says_space_and_never_the_connection() {
        // A disk that filled up while the engine was being fetched is a fact
        // about this computer: the sentence must be the disk's own, and must
        // not send the owner to check a connection that was never the problem.
        let spoken = words(&StartupFailure::from(DecideError::StorageFull));
        assert!(spoken.contains("space"), "{spoken}");
        assert!(!spoken.contains("connection"), "{spoken}");
    }

    #[test]
    fn a_wire_that_blocked_every_engine_fetch_names_the_network() {
        // The network is the fixable fact, and the sentence names it — the
        // builds' NoBackendWorked words would send an owner on a filtered
        // network to wait for an update that cannot help.
        let spoken = words(&StartupFailure::from(DecideError::EngineUnreachable {
            probe_model_reason: None,
            attempts: vec![],
        }));
        assert_eq!(
            spoken,
            "Kalsa couldn't download what she needs on this network. Try another network."
        );
        assert_eq!(
            StartupFailure::from(DecideError::EngineUnreachable {
                probe_model_reason: None,
                attempts: vec![],
            })
            .code_and_params()
            .0,
            "startup.network_blocks_download"
        );
        // A probe that ran and failed is a different fact and keeps its own
        // sentence.
        assert!(
            words(&StartupFailure::from(DecideError::NothingWorked {
                attempts: vec![]
            }))
            .contains("app update")
        );
    }

    #[test]
    fn every_failure_says_what_the_user_can_do() {
        // Each sentence points somewhere: again, an update, a restart, the
        // AI page. A dead end is not a sentence.
        for failure in every_failure() {
            let spoken = words(&failure);
            let actionable = ["again", "update", "restart", "measure", "pair", "space", "try", "wait", "home", "pick"]
                .iter()
                .any(|word| spoken.to_ascii_lowercase().contains(word));
            assert!(actionable, "{failure:?} is a dead end: {spoken}");
        }
    }

    #[test]
    fn the_measurement_failure_hides_the_probe_notes() {
        // The probe's notes are its own words with numbers in them; the
        // sentence says what the owner can do and nothing else, whatever
        // fired below.
        let spoken = words(&StartupFailure::MeasurementUnreliable(vec![
            "the repetitions disagreed by 35%: something else was using this machine \
             while it was measured"
                .to_string(),
        ]));
        assert_eq!(
            spoken,
            "Kalsa couldn't check this computer. Wait a moment and try again."
        );
        assert_eq!(
            words(&StartupFailure::MeasurementUnreliable(Vec::new())),
            "Kalsa couldn't check this computer. Wait a moment and try again."
        );
        assert_eq!(
            StartupFailure::MeasurementUnreliable(vec![])
                .code_and_params()
                .0,
            "startup.check_failed"
        );
    }

    /// The thirds, as the production sites split them: a file this machine
    /// refused is a start failure; a wire failure names the connection; an
    /// HTTP refusal and a corrupt download land on the later sentence.
    #[test]
    fn a_local_download_error_names_the_file_and_a_network_one_names_the_connection() {
        let local = StartupFailure::from(DownloadError::Io(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "os error 5",
        )));
        assert!(matches!(local, StartupFailure::ModelFileUnwritable));
        assert_eq!(words(&local), "Kalsa couldn't start. Try again.");

        let network = StartupFailure::from(DownloadError::Network(std::io::Error::new(
            std::io::ErrorKind::ConnectionReset,
            "connection reset by peer",
        )));
        assert!(matches!(network, StartupFailure::ConnectionLost));
        assert_eq!(
            words(&network),
            "Kalsa couldn't download what she needs. Check your connection and try again."
        );

        let short = StartupFailure::from(DownloadError::NotEnoughSpace {
            free: 1_000_000_000,
            needed: 3_050_000_000,
        });
        assert_eq!(
            words(&short),
            "Kalsa needs more space. Free up 2.1 GB and try again."
        );
        let (code, params) = short.code_and_params();
        assert_eq!(code, "startup.disk_full");
        assert_eq!(params["gb"], 2.1);

        let refused = StartupFailure::from(DownloadError::Refused { status: 403 });
        assert!(matches!(refused, StartupFailure::DownloadRefused));
        assert_eq!(words(&refused), "Kalsa couldn't finish downloading. Try again later.");

        // The overrun arrives as a size mismatch — the stream ran past the
        // publisher's promise — and the part was thrown away for it.
        let overrun = StartupFailure::from(DownloadError::SizeMismatch {
            expected: 1024 * 1024,
            actual: 1024 * 1024 + 64 * 1024,
        });
        assert!(matches!(overrun, StartupFailure::DownloadCorrupted));
        assert_eq!(words(&overrun), "Kalsa couldn't finish downloading. Try again later.");
    }

    /// Every code is stable and non-empty, and the disk's GB rides as a
    /// param the webview formats itself.
    #[test]
    fn every_failure_carries_a_code() {
        for failure in every_failure() {
            let (code, params) = failure.code_and_params();
            assert!(code.starts_with("startup."), "{failure:?} code {code}");
            assert!(params.is_object(), "{failure:?} params {params}");
            assert_eq!(
                failure.message().text,
                words(&failure),
                "{failure:?} fallback text drifts from words()"
            );
        }
        let short = StartupFailure::NotEnoughDisk(None);
        assert_eq!(short.code_and_params().1, serde_json::json!({}));
    }
}
