use std::time::Duration;

use rmcp::model::{
    CallToolRequestParams, CallToolResponse, ClientRequest, ContentBlock, ListToolsRequest,
    PaginatedRequestParams, ServerResult, Tool,
};
use rmcp::service::ServiceError;
use serde_json::{Map, Value};
use tokio::time::timeout;

use crate::error::Error;
use crate::launch::Connection;
use crate::outcome::ToolResult;
use crate::server_id::ServerId;

/// A server that keeps returning cursors is cut off here, not followed forever.
const MAX_PAGES: usize = 16;

pub(crate) const DISCOVER_DEADLINE: Duration = Duration::from_secs(15);
pub(crate) const CALL_DEADLINE: Duration = Duration::from_secs(60);

/// **A browser call waits for the browser, and gets more room than every other
/// call.** A read may spend the driver's own patience twice over — the settle
/// waits 30 s for the page to finish loading and the tree takes 30 s of its
/// own, and the read is started over once when the page moves under it
/// (`READ_ATTEMPTS` is two) — plus the 8 s the content poll waits, plus the
/// 10 s the retry is given when the driver did not answer: 30 + 30 + 8 + 30 +
/// 30 + 10 = 138 s in the worst case, and 107 s was measured on a real page
/// before the retry existed. **150 s leaves room for the whole of it.**
///
/// **The deadline is not a slow call.** A call that passes it does not come
/// back as the page's own refusal: the host turns it into a failure of the
/// browser's own and drops the sidecar, and the turn loses its page.
pub(crate) const BROWSER_CALL_DEADLINE: Duration = Duration::from_secs(150);

/// The browser's own server: the one whose calls drive a real browser.
const BROWSER_SERVER: &str = "browser";

/// **The deadline one call gets.** Everything but the browser keeps the 60 s it
/// has always had.
fn deadline_for(server: &ServerId) -> Duration {
    if server.to_string() == BROWSER_SERVER {
        BROWSER_CALL_DEADLINE
    } else {
        CALL_DEADLINE
    }
}

impl Connection {
    /// Goes to the peer directly, not through rmcp's list cache: a server's
    /// `ttlMs` must not let a changed definition go unseen.
    pub(crate) async fn list_tools(&self, server: &ServerId) -> Result<Vec<Tool>, Error> {
        let peer = self.service.peer();
        let mut tools = Vec::new();
        let mut cursor: Option<String> = None;
        for _ in 0..MAX_PAGES {
            let request = ListToolsRequest {
                method: Default::default(),
                params: Some(PaginatedRequestParams::default().with_cursor(cursor.clone())),
                extensions: Default::default(),
            };
            let sent = peer.send_request(ClientRequest::ListToolsRequest(request));
            let page = match timeout(DISCOVER_DEADLINE, sent).await {
                Ok(Ok(ServerResult::ListToolsResult(page))) => page,
                Ok(Ok(_)) => return Err(Error::Protocol(server.clone())),
                Ok(Err(error)) => return Err(service_error(error, server)),
                Err(_) => return Err(Error::ServerGone(server.clone())),
            };
            tools.extend(page.tools);
            match page.next_cursor {
                Some(next) => cursor = Some(next),
                None => return Ok(tools),
            }
        }
        Err(Error::TooManyPages(server.clone()))
    }

    /// The host does not drive input rounds or tasks, so those answers are refused.
    pub(crate) async fn call_tool(
        &self,
        server: &ServerId,
        tool: &str,
        arguments: Map<String, Value>,
    ) -> Result<ToolResult, Error> {
        let params = CallToolRequestParams::new(tool.to_owned()).with_arguments(arguments);
        let deadline = deadline_for(server);
        match timeout(deadline, self.service.call_tool_once(params)).await {
            Ok(Ok(CallToolResponse::Complete(result))) => Ok(ToolResult {
                server: server.clone(),
                is_error: result.is_error.unwrap_or(false),
                for_model: text_parts(&result.content),
                for_ui: result.structured_content,
            }),
            Ok(Ok(_)) => {
                log::warn!("mcp {server}: {tool} answered with a reply it does not expect");
                Err(Error::Unsupported(server.clone()))
            }
            Ok(Err(error)) => {
                log::warn!("mcp {server}: {tool} failed: rmcp {}", service_error_kind(&error));
                Err(service_error(error, server))
            }
            Err(_) => {
                log::warn!("mcp {server}: {tool} passed its {deadline:?} deadline");
                Err(Error::ServerGone(server.clone()))
            }
        }
    }
}

/// The kind of an rmcp failure, named without its message: a message can carry what the
/// server sent back.
fn service_error_kind(error: &ServiceError) -> &'static str {
    match error {
        ServiceError::McpError(_) => "server error reply",
        ServiceError::TransportSend(_) => "transport send",
        ServiceError::TransportClosed => "transport closed",
        ServiceError::UnexpectedResponse => "unexpected response",
        ServiceError::Cancelled { .. } => "cancelled",
        ServiceError::Timeout { .. } => "request timeout",
        _ => "other",
    }
}

fn text_parts(content: &[ContentBlock]) -> Vec<String> {
    content.iter().filter_map(|block| block.as_text()).map(|part| part.text.clone()).collect()
}

fn service_error(error: ServiceError, server: &ServerId) -> Error {
    match error {
        ServiceError::TransportSend(_) | ServiceError::TransportClosed | ServiceError::Timeout { .. } => {
            Error::ServerGone(server.clone())
        }
        _ => Error::Protocol(server.clone()),
    }
}

#[cfg(test)]
mod tests {
    use super::{deadline_for, BROWSER_CALL_DEADLINE, CALL_DEADLINE};
    use crate::server_id::ServerId;
    use std::time::Duration;

    /// **The browser's own calls get the room a read needs, and nothing else
    /// does.** Every other server keeps the 60 s it has always had.
    #[test]
    fn a_browser_call_gets_more_room_than_any_other() {
        let browser = ServerId::new("browser").expect("the browser's own name");
        let mail = ServerId::new("mail").expect("the mail's own name");
        assert_eq!(deadline_for(&browser), BROWSER_CALL_DEADLINE);
        assert_eq!(deadline_for(&mail), CALL_DEADLINE);
        assert!(BROWSER_CALL_DEADLINE > CALL_DEADLINE);
    }

    /// **The room is enough for the whole of the worst case.** The settle waits
    /// 30 s for the page and the tree takes 30 s of its own, and the read is
    /// started over once when the page moves under it: twice over, plus the 8 s
    /// the content poll waits and the 10 s the retry is given.
    #[test]
    fn the_browser_deadline_covers_the_worst_case_a_read_can_reach() {
        let worst = Duration::from_secs(30 * 4 + 8 + 10);
        assert!(
            BROWSER_CALL_DEADLINE >= worst,
            "{BROWSER_CALL_DEADLINE:?} must cover the {worst:?} a read can reach"
        );
    }
}
