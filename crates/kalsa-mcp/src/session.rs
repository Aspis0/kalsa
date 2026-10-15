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
        match timeout(CALL_DEADLINE, self.service.call_tool_once(params)).await {
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
                log::warn!("mcp {server}: {tool} passed its {CALL_DEADLINE:?} deadline");
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
