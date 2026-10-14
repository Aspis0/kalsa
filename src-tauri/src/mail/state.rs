use kalsa_mcp::error::Error as HostError;
use kalsa_mcp::host::Host;
use kalsa_mcp::launch::StdioLauncher;
use kalsa_mcp::outcome::{CallOutcome, ToolResult};
use serde::Serialize;
use serde_json::{Map, Value};
use tokio::sync::{Mutex, MutexGuard};

use super::error::MailError;

/// The panel's calls share one conversation. The mail tools are first-party and
/// need no approval per conversation, so the value only has to stay the same.
pub(crate) const PANEL_CONVERSATION: &str = "mail-panel";

/// The one long-lived host, and the lock that every change to the saved account takes.
#[derive(Default)]
pub(crate) struct MailState {
    slot: Mutex<Option<Host<StdioLauncher>>>,
}

/// Held by one operation at a time. A save, a delete and the first open of the host
/// all take it, so none of them can see the account half-replaced.
pub(crate) struct Slot<'a>(MutexGuard<'a, Option<Host<StdioLauncher>>>);

impl MailState {
    pub(crate) async fn lock(&self) -> Slot<'_> {
        Slot(self.slot.lock().await)
    }
}

impl Slot<'_> {
    /// Drops the running sidecar, so the next call starts one with the saved account.
    pub(crate) fn forget(&mut self) {
        *self.0 = None;
    }

    pub(crate) async fn call(
        &mut self,
        name: &str,
        arguments: Map<String, Value>,
        open: impl FnOnce() -> Result<Host<StdioLauncher>, MailError>,
    ) -> Result<ToolResponse, MailError> {
        self.ensure_open(open)?;
        let host = self.host()?;
        match host.call(PANEL_CONVERSATION, name, arguments).await {
            Ok(CallOutcome::Ran(result)) => Ok(result.into()),
            Ok(CallOutcome::NeedsConfirmation(_)) => Err(MailError::Confirmation),
            Err(error) => Err(self.fail(error)),
        }
    }

    /// A send is never run by a plain call: the host has to ask first, and the
    /// person's click is the answer. The confirmation carries the exact arguments
    /// they saw, and a send that ran without the ask is refused.
    pub(crate) async fn confirmed_send(
        &mut self,
        arguments: Map<String, Value>,
        open: impl FnOnce() -> Result<Host<StdioLauncher>, MailError>,
    ) -> Result<ToolResponse, MailError> {
        self.ensure_open(open)?;
        let host = self.host()?;
        let pending = match host.call(PANEL_CONVERSATION, "mail.send", arguments.clone()).await {
            Ok(CallOutcome::NeedsConfirmation(pending)) => pending,
            Ok(CallOutcome::Ran(_)) => return Err(MailError::Denied),
            Err(error) => return Err(self.fail(error)),
        };
        match host.confirm(pending, arguments).await {
            Ok(result) => Ok(result.into()),
            Err(error) => Err(self.fail(error)),
        }
    }

    fn ensure_open(&mut self, open: impl FnOnce() -> Result<Host<StdioLauncher>, MailError>) -> Result<(), MailError> {
        if self.0.is_none() {
            *self.0 = Some(open()?);
        }
        Ok(())
    }

    fn host(&mut self) -> Result<&mut Host<StdioLauncher>, MailError> {
        self.0.as_mut().ok_or(MailError::Failed)
    }

    /// A sidecar that died or never started is dropped, so the next call starts a fresh one.
    fn fail(&mut self, error: HostError) -> MailError {
        if matches!(error, HostError::ServerGone(_) | HostError::Launch(_)) {
            *self.0 = None;
        }
        error.into()
    }
}

/// What a mail command returns. `for_model` is the text the model may read;
/// `for_ui` is the structured data the panel draws.
#[derive(Serialize)]
pub(crate) struct ToolResponse {
    pub(crate) for_model: Vec<String>,
    pub(crate) for_ui: Option<Value>,
    pub(crate) is_error: bool,
}

impl From<ToolResult> for ToolResponse {
    fn from(result: ToolResult) -> Self {
        Self { for_model: result.for_model, for_ui: result.for_ui, is_error: result.is_error }
    }
}
