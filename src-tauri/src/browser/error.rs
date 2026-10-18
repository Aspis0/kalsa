//! What the browser commands can fail with. The UI translates the code, and
//! nothing here carries a path, an address or a digest: a driver failure is
//! shown as a sentence about Kalsa, not about a file.

use serde::Serialize;

use super::codes::BrowserCode;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum BrowserError {
    /// The machine is not one Kalsa ships a driver for.
    UnsupportedPlatform,
    /// A download is already running; one at a time, so two presses cannot
    /// write the same directory.
    Busy,
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
    /// The sidecar answered that it will not do it. **Its own words are for the
    /// model and its own code is for the page**, so the two can be told apart and
    /// neither is built from the other. An answer with no code is a refusal,
    /// which is what `BrowserCode::Refused` says.
    Refused(BrowserCode),
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
    pub(crate) fn code(self) -> &'static str {
        match self {
            Self::UnsupportedPlatform => "browser.unsupported_platform",
            Self::Busy => "browser.busy",
            Self::Cancelled => "browser.cancelled",
            Self::Download => "browser.download_failed",
            Self::Corrupt => "browser.driver_corrupt",
            Self::Changed => "browser.driver_changed",
            Self::Unpack => "browser.unpack_failed",
            Self::Storage => "browser.storage",
            Self::Failed => "browser.failed",
            Self::Refused(said) => said.as_str(),
            Self::NoCard => "browser.no_pending_request",
            Self::Stopped => "browser.stopped",
        }
    }
}

/// The shape a command returns across IPC. The English sentence is the
/// fallback the page shows when a language has no row for the code.
#[derive(Debug, Serialize)]
pub(crate) struct CommandFailure {
    code: &'static str,
    text: &'static str,
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
        Self { code: error.code(), text: fallback(error) }
    }
}

/// The sentence a code falls back to. Kalsa is the only noun in any of them,
/// because the driver is ours and the person did not ask for a file path.
fn fallback(error: BrowserError) -> &'static str {
    match error {
        BrowserError::UnsupportedPlatform => "Kalsa does not have a browser driver for this computer.",
        BrowserError::Busy => "Kalsa is already downloading its browser driver.",
        BrowserError::Cancelled => "The browser driver download was cancelled.",
        BrowserError::Download => "Kalsa could not download its browser driver. Try again.",
        BrowserError::Corrupt => {
            "The browser driver Kalsa downloaded does not match what it expects, so it was not installed."
        }
        BrowserError::Changed => "Kalsa's browser driver has changed on disk, so it was not started.",
        BrowserError::Unpack => "The browser driver Kalsa downloaded could not be unpacked, so it was not installed.",
        BrowserError::Storage => "Kalsa could not write to its data folder.",
        BrowserError::Refused(_) => "the browser would not open that.",
        BrowserError::NoCard => "that request is not waiting for an answer any more.",
        BrowserError::Stopped => "Kalsa stopped that. Nothing it was doing was carried on.",
        BrowserError::Failed => "Something went wrong with Kalsa's browser. Try again.",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_error_has_a_code_and_a_sentence_and_no_two_share_a_code() {
        let all = [
            BrowserError::UnsupportedPlatform,
            BrowserError::Busy,
            BrowserError::Cancelled,
            BrowserError::Download,
            BrowserError::Corrupt,
            BrowserError::Changed,
            BrowserError::Unpack,
            BrowserError::Storage,
            BrowserError::Failed,
            BrowserError::Refused(BrowserCode::Refused),
            BrowserError::NoCard,
        ];
        let mut codes: Vec<&str> = all.iter().map(|error| error.code()).collect();
        codes.sort_unstable();
        let count = codes.len();
        codes.dedup();
        assert_eq!(codes.len(), count, "two failures answer the same code");
        for error in all {
            assert!(!error.code().is_empty());
            assert!(!fallback(error).is_empty());
        }
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
            let text = fallback(error);
            assert!(!text.contains('/') && !text.contains('\\'), "{text}");
            assert!(!text.chars().any(|c| c.is_ascii_digit()), "{text}");
        }
    }
}