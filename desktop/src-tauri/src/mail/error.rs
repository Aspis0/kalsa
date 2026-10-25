use kalsa_mcp::error::Error as HostError;
use kalsa_mcp::permission::DenyReason;
use serde::Serialize;
use serde_json::Value;

/// What the mail commands can fail with. The UI translates the code; nothing
/// here carries a server reply, an address or a password.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum MailError {
    NotConfigured,
    InvalidAccount,
    UnsupportedProvider,
    SendNotConfigured,
    SendNotListed,
    SendNoRecipient,
    SendUnreachable,
    SendRefused,
    SendFailed,
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
            Self::SendNotConfigured => "mail.send_not_configured",
            Self::SendNotListed => "mail.send_not_listed",
            Self::SendNoRecipient => "mail.send_no_recipient",
            Self::SendUnreachable => "mail.send_unreachable",
            Self::SendRefused => "mail.send_refused",
            Self::SendFailed => "mail.send_failed",
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

/// The code the sidecar answers a refused login with. The sidecar's own constant is
/// `kalsa_mail::imap::LOGIN_REFUSED`; the host does not link the sidecar, so a test pins the two.
pub(crate) const LOGIN_REFUSED: &str = "login_refused";

/// The failure a sidecar error result stands for when it names a refused login, the
/// one the person can fix with a new password. `None` leaves the reporting to the caller.
pub(crate) fn refusal_of(data: Option<&Value>) -> Option<MailError> {
    match data.and_then(|data| data.get("code")).and_then(Value::as_str) {
        Some(LOGIN_REFUSED) => Some(MailError::InvalidAccount),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn the_host_and_the_sidecar_name_a_refused_login_the_same_way() {
        assert_eq!(LOGIN_REFUSED, kalsa_mail::imap::LOGIN_REFUSED);
    }

    #[test]
    fn a_refused_login_is_invalid_account_and_no_other_code_is() {
        assert_eq!(refusal_of(Some(&json!({"code": LOGIN_REFUSED}))), Some(MailError::InvalidAccount));
        assert_eq!(refusal_of(Some(&json!({"code": "refused"}))), None);
        assert_eq!(refusal_of(None), None);
    }
}
