//! Test-only stdio server for the child-process and deadline tests. It reads the
//! bootstrap line before the protocol starts, then serves `echo`,
//! `bootstrap_len` and `env`. Argument `silent` never answers; `quit-on-list`
//! exits when asked for tools.

use rmcp::model::{
    CallToolRequestParams, CallToolResponse, CallToolResult, ContentBlock, ListToolsResult,
    PaginatedRequestParams, Tool,
};
use rmcp::service::{RequestContext, RoleServer};
use rmcp::{ErrorData as McpError, ServerHandler, serve_server};
use serde_json::json;
use tokio::io::{AsyncBufReadExt, BufReader};

struct Fixture {
    bootstrap_len: usize,
    quit_on_list: bool,
}

impl ServerHandler for Fixture {
    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, McpError> {
        if self.quit_on_list {
            std::process::exit(0);
        }
        let echo = json!({
            "name": "echo",
            "description": "Returns the text argument",
            "inputSchema": {"type": "object"}
        });
        let bootstrap_len = json!({
            "name": "bootstrap_len",
            "description": "Returns the length of the bootstrap line",
            "inputSchema": {"type": "object"}
        });
        // The empty string is the answer for a variable that is not set, which
        // is how the sealed launcher proves the child was given nothing else.
        let env = json!({
            "name": "env",
            "description": "Returns the value of one environment variable",
            "inputSchema": {"type": "object"}
        });
        let tools: Vec<Tool> = vec![echo, bootstrap_len, env]
            .into_iter()
            .map(|value| serde_json::from_value(value).expect("fixture tool is valid"))
            .collect();
        Ok(ListToolsResult::with_all_items(tools))
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, McpError> {
        let text = match request.name.as_ref() {
            "echo" => request
                .arguments
                .as_ref()
                .and_then(|args| args.get("text"))
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .to_owned(),
            "bootstrap_len" => self.bootstrap_len.to_string(),
            "env" => std::env::var(
                request
                    .arguments
                    .as_ref()
                    .and_then(|args| args.get("name"))
                    .and_then(|value| value.as_str())
                    .unwrap_or_default(),
            )
            .unwrap_or_default(),
            _ => return Err(McpError::invalid_params("unknown tool", None)),
        };
        let result = CallToolResult::success(vec![ContentBlock::text(text)]);
        Ok(CallToolResponse::Complete(result))
    }
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mode = std::env::args().nth(1).unwrap_or_default();
    let mut stdin = BufReader::new(tokio::io::stdin());
    let mut bootstrap = String::new();
    stdin.read_line(&mut bootstrap).await?;
    if mode == "silent" {
        std::future::pending::<()>().await;
    }
    let fixture = Fixture {
        bootstrap_len: bootstrap.trim_end_matches(['\n', '\r']).len(),
        quit_on_list: mode == "quit-on-list",
    };
    let service = serve_server(fixture, (stdin, tokio::io::stdout())).await?;
    service.waiting().await?;
    Ok(())
}
