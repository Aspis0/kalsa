//! What the browser commands can fail with. **The page reads the code and the
//! model reads the reason**; a failure of ours has no reason to give, and says
//! so in a fixed sentence that names no path, no address and no digest.

use serde::Serialize;

use super::codes::BrowserCode;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum BrowserError {
    /// The machine is not one Kalsa ships a driver for.
    UnsupportedPlatform,
    /// A download is already running; one at a time, so two presses cannot
    /// write the same directory.
    Busy,
    /// **The browser's slot is taken.** Another call holds it, or the profile
    /// is being emptied underneath it.
    ///
    /// **It answers with the same code as the download's busy, on purpose.**
    /// The page reads one line for both — the browser is busy, whoever asked —
    /// and only the model is told which one it was: a download that is
    /// running and a browser that is taken are the same fact for the person
    /// and two different ones for the model. A second code would mean a second
    /// line to read, saying the same thing.
    SlotBusy,
    /// The person pressed Cancel. Nothing was installed and nothing partial is
    /// left behind, so the next press starts clean.
    Cancelled,
    /// The network, the disk, or the connection gave out mid-download.
    Download,
    /// The archive's digest is not the one this build pins. Nothing was
    /// unpacked and nothing will be launched.
    Corrupt,
    /// A file inside the installed driver differs from the digest recorded
    /// when it was unpacked. The driver is not launched.
    Changed,
    /// The archive unpacked into something that is not a driver.
    Unpack,
    Storage,
    Failed,
    /// The sidecar answered that it will not do it. **Its own code is for the
    /// page and its own words are for the model**, so the two are told apart
    /// and neither is built from the other. An answer with no code is a
    /// refusal, which is what `BrowserCode::Refused` says.
    ///
    /// `why` is `None` for a refusal the app raised on its own account, before
    /// the sidecar was asked.
    ///
    /// `stage` is where the sidecar stopped, when it said: **it is internal**,
    /// and it travels beside the code because the ledger has to tell a failure
    /// a retry can answer from one that is dead. It is never a sentence and
    /// never a word this build does not know.
    Refused { code: BrowserCode, why: Option<String>, stage: Option<&'static str> },
    /// Nobody pressed this twice: the id was already answered, it had expired,
    /// or there was never a card. A person pressing "send" on a request that is
    /// not waiting is owed a sentence, not an error to guess at.
    NoCard,
    /// The person pressed Stop while this was running. The call came back at
    /// once, the sidecar went with it, and **nothing that call was doing is
    /// retried**: a browser half-way through somebody's page is not something to
    /// pick up again on their behalf.
    Stopped,
}

impl BrowserError {
    pub(crate) fn code(&self) -> &'static str {
        match self {
            Self::UnsupportedPlatform => "browser.unsupported_platform",
            Self::Busy => "browser.busy",
            Self::SlotBusy => "browser.busy",
            Self::Cancelled => "browser.cancelled",
            Self::Download => "browser.download_failed",
            Self::Corrupt => "browser.driver_corrupt",
            Self::Changed => "browser.driver_changed",
            Self::Unpack => "browser.unpack_failed",
            Self::Storage => "browser.storage",
            Self::Failed => "browser.failed",
            Self::Refused { code, .. } => code.as_str(),
            Self::NoCard => "browser.no_pending_request",
            Self::Stopped => "browser.stopped",
        }
    }

    /// **Whether this code is a press that never went anywhere.**
    ///
    /// **One family, one list, and both sides of the app read it.** The browser
    /// was busy, so nothing was sent; or the request was not waiting for an
    /// answer any more, so nothing was sent either. Neither of them leaves an
    /// outcome behind — the window's own rule (`leaves_an_outcome`) is this list
    /// read the other way round, and the phone's rule is this list as it is.
    ///
    /// **The phone asks it by code**, because the phone's answer route carries
    /// the code and not the failure; the window asks it with the failure in
    /// hand. It is the same list either way.
    pub(crate) fn a_press_that_never_went(code: &str) -> bool {
        code == Self::Busy.code() || code == Self::NoCard.code()
    }

    /// The sentence the model reads: the sidecar's own words when the sidecar
    /// refused, and the fixed fallback when the failure was ours.
    fn sentence(&self) -> String {
        match self {
            Self::Refused { why: Some(why), .. } => why.clone(),
            other => fallback(other).to_owned(),
        }
    }
}

/// The shape a command returns across IPC. **The code is the page's**: a closed
/// set it turns into its own words, with the English text as the fallback for
/// a language that has no row. **The text is the model's**: the reason the
/// sidecar gave, or the fixed fallback for a failure that was ours.
///
/// **The stage is nobody's but the ledger's.** It says where the call stopped,
/// and it is what tells a failure a retry can answer from one that is dead: a
/// read the driver did not answer after an open is one, and the same failure
/// after a click is not, because the action may already have happened. It is
/// absent when there is nothing to say.
#[derive(Debug, Serialize)]
pub(crate) struct CommandFailure {
    code: &'static str,
    text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    stage: Option<&'static str>,
}

impl CommandFailure {
    /// The code alone, for a caller that speaks in codes rather than sentences —
    /// the phone's answer route, which hands one to the phone.
    pub(crate) fn code(&self) -> &'static str {
        self.code
    }
}

impl From<BrowserError> for CommandFailure {
    fn from(error: BrowserError) -> Self {
        let stage = match &error {
            BrowserError::Refused { stage, .. } => *stage,
            _ => None,
        };
        Self { code: error.code(), text: error.sentence(), stage }
    }
}

/// The sentence a code falls back to. Kalsa is the only noun in any of them,
/// because the driver is ours and the person did not ask for a file path.
fn fallback(error: &BrowserError) -> &'static str {
    match error {
        BrowserError::UnsupportedPlatform => "Kalsa does not have a browser driver for this computer.",
        BrowserError::Busy => "Kalsa is already downloading its browser driver.",
        BrowserError::SlotBusy => {
            "The browser is busy: another call is using it. Nothing was sent. Say what you would have done, and wait."
        }
        BrowserError::Cancelled => "The browser driver download was cancelled.",
        BrowserError::Download => "Kalsa could not download its browser driver. Try again.",
        BrowserError::Corrupt => {
            "The browser driver Kalsa downloaded does not match what it expects, so it was not installed."
        }
        BrowserError::Changed => "Kalsa's browser driver has changed on disk, so it was not started.",
        BrowserError::Unpack => "The browser driver Kalsa downloaded could not be unpacked, so it was not installed.",
        BrowserError::Storage => "Kalsa could not write to its data folder.",
        BrowserError::Refused { .. } => "the browser would not open that.",
        BrowserError::NoCard => "that request is not waiting for an answer any more.",
        BrowserError::Stopped => "Kalsa stopped that. Nothing it was doing was carried on.",
        BrowserError::Failed => "Something went wrong with Kalsa's browser. Try again.",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_error_has_a_code_and_a_sentence_and_only_the_two_busy_failures_share_a_code() {
        let all = [
            BrowserError::UnsupportedPlatform,
            BrowserError::Busy,
            BrowserError::SlotBusy,
            BrowserError::Cancelled,
            BrowserError::Download,
            BrowserError::Corrupt,
            BrowserError::Changed,
            BrowserError::Unpack,
            BrowserError::Storage,
            BrowserError::Failed,
            BrowserError::Refused { code: BrowserCode::Refused, why: None, stage: None },
            BrowserError::NoCard,
        ];
        let mut codes: Vec<&str> = all.iter().map(|error| error.code()).collect();
        codes.sort_unstable();
        let count = codes.len();
        codes.dedup();
        // **The two busy failures answer the same code, and they are the only
        // two that do.** The page reads one line for both — the browser is busy
        // — and the model is told which one it was.
        assert_eq!(codes.len(), count - 1, "two failures answer the same code");
        for error in all {
            assert!(!error.code().is_empty());
            assert!(!fallback(&error).is_empty());
        }
    }

    /// **The busy slot has its own sentence, and it is not the download's.**
    /// The model reads it: a call refused because the browser is taken must not
    /// say that a driver is being downloaded, because nothing is.
    #[test]
    fn the_busy_slot_says_the_browser_is_taken_and_not_that_a_driver_is_downloading() {
        let busy = CommandFailure::from(BrowserError::SlotBusy);
        assert_eq!(busy.code, "browser.busy", "the page reads one code for both");
        assert!(busy.text.contains("busy"), "{}", busy.text);
        assert!(!busy.text.contains("download"), "{}", busy.text);
        // And the download keeps its own sentence, which says what it is.
        let download = CommandFailure::from(BrowserError::Busy);
        assert!(download.text.contains("download"), "{}", download.text);
    }

    /// **The sidecar's words are the sentence the model reads, and the code is
    /// the one the page reads.**
    #[test]
    fn a_refusal_reaches_the_model_with_the_sidecars_own_words() {
        let said = "the element is not on the page any more: read the page again";
        let failure = CommandFailure::from(BrowserError::Refused {
            code: BrowserCode::Refused,
            why: Some(said.to_owned()),
            stage: None,
        });
        assert_eq!(failure.code, "browser.refused", "the page reads the code and only the code");
        assert_eq!(failure.text, said, "and the model reads what the sidecar said");
    }

    /// **A refusal the app raised on its own account has no words of its own**,
    /// so it falls back to the fixed sentence.
    #[test]
    fn a_refusal_of_the_apps_own_falls_back_to_the_sentence_it_had() {
        let failure = CommandFailure::from(BrowserError::Refused { code: BrowserCode::Refused, why: None, stage: None });
        assert_eq!(failure.code, "browser.refused");
        assert_eq!(failure.text, "the browser would not open that.");
    }

    /// **The stage travels with the refusal, and nothing else does.** The code
    /// the page reads is the one it always read and the model reads the
    /// sidecar's words; the stage is the ledger's, and it says where the call
    /// stopped — so a read the driver did not answer after an open can be told
    /// from the same failure after a click.
    #[test]
    fn a_refusal_carries_its_stage_and_a_failure_of_ours_carries_none() {
        let refusal = CommandFailure::from(BrowserError::Refused {
            code: BrowserCode::Refused,
            why: Some("the page did not answer that call; try again".to_owned()),
            stage: Some("read_driver"),
        });
        assert_eq!(refusal.code, "browser.refused", "the page reads the code it always read");
        let said = serde_json::to_value(&refusal).expect("the failure is JSON");
        assert_eq!(said["stage"], "read_driver", "and the stage rides beside it");
        assert_eq!(
            said["text"],
            "the page did not answer that call; try again",
            "the model still reads the sidecar's own words"
        );

        let ours = serde_json::to_value(CommandFailure::from(BrowserError::Failed)).expect("the failure is JSON");
        assert!(ours.get("stage").is_none(), "and a failure of ours has no stage to say: {ours}");
    }

    /// The sentences a person reads must not hand out a path or a digest.
    #[test]
    fn a_sentence_names_no_file_and_no_digest() {
        for error in [
            BrowserError::Download,
            BrowserError::Corrupt,
            BrowserError::Changed,
            BrowserError::Unpack,
            BrowserError::Storage,
            BrowserError::Failed,
        ] {
            let text = fallback(&error);
            assert!(!text.contains('/') && !text.contains('\\'), "{text}");
            assert!(!text.chars().any(|c| c.is_ascii_digit()), "{text}");
        }
    }
}