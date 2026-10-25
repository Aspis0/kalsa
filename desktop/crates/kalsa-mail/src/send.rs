//! The `send` tool: a reply to one listed mail, delivered over the person's submission
//! server. The recipient is the address that mail came from. The host runs this only
//! after the person confirms it, and every failure is answered with a fixed code.

use std::sync::Arc;

use rmcp::model::CallToolResult;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::Mutex;
use zeroize::Zeroizing;

use crate::account::Account;
use crate::compose::{self, ComposeError};
use crate::imap::MailError;
use crate::invisible;
use crate::kept::KeptSession;
use crate::listed::Listed;
use crate::mcp;
use crate::senders::Senders;
use crate::smtp::{self, DeliveryError, Outbound};
use crate::view;
use crate::fence::Fence;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SendArgs {
    /// The UID, as it appears in a `list` result.
    pub reply_to_id: u32,
    pub subject: String,
    /// What the person wrote. This is the only free text of a `send` call.
    pub body: String,
    /// The folder the mail is in. INBOX by default.
    pub folder: Option<String>,
}

#[derive(Serialize)]
struct SentOut {
    sent_to: String,
}

pub async fn send(
    account: Arc<Account>,
    cache: Arc<Mutex<Senders>>,
    listed: Arc<Mutex<Listed>>,
    kept: Arc<Mutex<KeptSession>>,
    args: SendArgs,
) -> CallToolResult {
    let folder = args.folder.unwrap_or_else(mcp::default_folder);
    let (_, original, _, _) = match mcp::one(&account, &cache, &listed, &kept, &folder, args.reply_to_id).await {
        Ok(found) => found,
        Err(error) => return failure(fetch_code(error)),
    };
    let (Some(from), Some((host, port))) = (account.from(), account.smtp()) else {
        return failure("not_configured");
    };
    let reply = match compose::reply(&original, from, &args.subject, &args.body) {
        Ok(reply) => reply,
        Err(ComposeError::NoRecipient) => return failure("no_recipient"),
        Err(ComposeError::Invalid) => return failure("invalid"),
    };
    let outbound = Outbound {
        host: host.to_owned(),
        port,
        login: account.user().to_owned(),
        password: Zeroizing::new(account.password().to_owned()),
    };
    match smtp::deliver(&outbound, reply.message).await {
        Ok(()) => sent(&reply.to),
        Err(error) => failure(delivery_code(error)),
    }
}

fn sent(to: &str) -> CallToolResult {
    let to = invisible::one_line(to);
    let fence = Fence::new();
    let lines = vec![fence.field("sent_to", &to)];
    view::result(&fence, &SentOut { sent_to: to }, lines)
}

fn failure(code: &'static str) -> CallToolResult {
    CallToolResult::structured_error(json!({ "code": code }))
}

fn fetch_code(error: MailError) -> &'static str {
    match error {
        MailError::NotListed => "not_listed",
        MailError::Protocol => "not_found",
        MailError::Stale => "stale",
        _ => "failed",
    }
}

fn delivery_code(error: DeliveryError) -> &'static str {
    match error {
        DeliveryError::NotConfigured => "not_configured",
        DeliveryError::Unreachable => "unreachable",
        DeliveryError::Refused => "refused",
        DeliveryError::Failed => "failed",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_failure_is_a_fixed_code_and_never_a_server_reply() {
        assert_eq!(fetch_code(MailError::NotListed), "not_listed");
        assert_eq!(fetch_code(MailError::Login), "failed");
        assert_eq!(delivery_code(DeliveryError::Refused), "refused");
        assert_eq!(delivery_code(DeliveryError::Unreachable), "unreachable");
        let refused = failure(delivery_code(DeliveryError::Refused));
        let carried = serde_json::to_string(&refused.structured_content).expect("a record");
        assert_eq!(carried, r#"{"code":"refused"}"#);
        assert_eq!(refused.is_error, Some(true));
    }

    #[test]
    fn a_sent_reply_carries_only_the_recipient_as_one_line() {
        let done = sent("segreteria@studio.example.it\r\nBcc: x@evil.example");
        let record = done.structured_content.expect("a record");
        let to = record["sent_to"].as_str().expect("a string");
        assert!(!to.contains('\r') && !to.contains('\n'), "{to:?}");
        assert_eq!(record.as_object().map(|object| object.len()), Some(1));
    }
}
