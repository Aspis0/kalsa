use kalsa_mcp::error::Error as HostError;
use kalsa_mcp::permission::DenyReason;
use serde::Serialize;

/// What the mail commands can fail with. The UI translates the code; nothing
/// here carries a server reply, an address or a password.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum MailError {
    NotConfigured,
    InvalidAccount,
    UnsupportedProvider,
    Keychain,
    NotApproved,
    ProgramChanged,
    ServerGone,
    Denied,
    Confirmation,
    Storage,
    Failed,
}

impl MailError {
    pub(crate) fn code(self) -> &'static str {
        match self {
            Self::NotConfigured => "mail.not_configured",
            Self::InvalidAccount => "mail.invalid_account",
            Self::UnsupportedProvider => "mail.unsupported_provider",
            Self::Keychain => "mail.keychain",
            Self::NotApproved => "mail.not_approved",
            Self::ProgramChanged => "mail.program_changed",
            Self::ServerGone => "mail.server_gone",
            Self::Denied => "mail.denied",
            Self::Confirmation => "mail.confirmation_needed",
            Self::Storage => "mail.storage",
            Self::Failed => "mail.failed",
        }
    }
}

impl From<HostError> for MailError {
    fn from(error: HostError) -> Self {
        match error {
            HostError::ServerGone(_) => Self::ServerGone,
            HostError::BinaryChanged(_) => Self::ProgramChanged,
            HostError::BinaryUnreadable(_) | HostError::NotPinned(_) => Self::NotApproved,
            HostError::Denied(_, DenyReason::BinaryChanged) => Self::ProgramChanged,
            HostError::Denied(_, DenyReason::NotPinned) => Self::NotApproved,
            HostError::Denied(_, DenyReason::DefinitionChanged) => Self::Denied,
            HostError::BootstrapNeedsFirstParty(_) | HostError::InvalidSecret => Self::InvalidAccount,
            _ => Self::Failed,
        }
    }
}

/// The shape a command returns across IPC.
#[derive(Debug, Serialize)]
pub(crate) struct CommandFailure {
    code: &'static str,
}

impl From<MailError> for CommandFailure {
    fn from(error: MailError) -> Self {
        Self { code: error.code() }
    }
}
