// Each test file uses a different subset of these helpers.
#![allow(dead_code)]

pub mod fixture;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use kalsa_mcp::error::Error;
use kalsa_mcp::launch::{Connection, Launch};
use kalsa_mcp::pins::Pins;
use kalsa_mcp::record::{ServerRecord, Trust};
use kalsa_mcp::server_id::ServerId;
use rmcp::model::{
    CallToolRequestParams, CallToolResponse, CallToolResult, ContentBlock, ListToolsResult,
    PaginatedRequestParams, ProtocolVersion, Tool,
};
use rmcp::service::{ClientLifecycleMode, ClientServiceExt, RequestContext, RoleServer, serve_server};
use rmcp::{ErrorData as McpError, ServerHandler};
use serde_json::{Map, Value, json};

/// Shared with the test body, so a test can change what the server lists and see what it ran.
#[derive(Default)]
pub struct FakeState {
    pub tools: Vec<Tool>,
    pub replies: HashMap<String, String>,
    pub structured: HashMap<String, Value>,
    pub calls: Vec<String>,
    pub arguments: Vec<Value>,
    pub launches: usize,
    pub hang_list: bool,
    pub hang_calls: bool,
}

pub type SharedState = Arc<Mutex<FakeState>>;

pub fn state(tools: Vec<Tool>, replies: &[(&str, &str)]) -> SharedState {
    let replies = replies.iter().map(|(name, text)| (name.to_string(), text.to_string())).collect();
    Arc::new(Mutex::new(FakeState { tools, replies, ..Default::default() }))
}

pub fn calls(state: &SharedState) -> Vec<String> {
    state.lock().unwrap().calls.clone()
}

pub fn arguments(state: &SharedState) -> Vec<Value> {
    state.lock().unwrap().arguments.clone()
}

pub fn launches(state: &SharedState) -> usize {
    state.lock().unwrap().launches
}

pub fn set_tools(state: &SharedState, tools: Vec<Tool>) {
    state.lock().unwrap().tools = tools;
}

pub struct FakeServer {
    state: SharedState,
}

impl ServerHandler for FakeServer {
    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, McpError> {
        let hang = self.state.lock().unwrap().hang_list;
        if hang {
            std::future::pending::<()>().await;
        }
        let tools = self.state.lock().unwrap().tools.clone();
        Ok(ListToolsResult::with_all_items(tools))
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, McpError> {
        let hang = self.state.lock().unwrap().hang_calls;
        if hang {
            std::future::pending::<()>().await;
        }
        let name = request.name.to_string();
        let (text, structured) = {
            let mut state = self.state.lock().unwrap();
            state.calls.push(name.clone());
            state.arguments.push(Value::Object(request.arguments.unwrap_or_default()));
            let text = state.replies.get(&name).cloned().unwrap_or_else(|| format!("ran {name}"));
            (text, state.structured.get(&name).cloned())
        };
        let mut result = CallToolResult::success(vec![ContentBlock::text(text)]);
        result.structured_content = structured;
        Ok(CallToolResponse::Complete(result))
    }
}

/// Connects each server id to its own fake state, in this process, over an in-memory pipe.
pub struct FakeLauncher {
    servers: HashMap<String, SharedState>,
}

impl FakeLauncher {
    pub fn new(servers: Vec<(&str, SharedState)>) -> Self {
        let servers = servers.into_iter().map(|(id, state)| (id.to_string(), state)).collect();
        Self { servers }
    }
}

impl Launch for FakeLauncher {
    async fn launch(&self, record: &mut ServerRecord, _binary_sha256: &str) -> Result<Connection, Error> {
        let id = record.id().clone();
        let state = self.servers.get(&id.to_string()).cloned().ok_or_else(|| Error::Launch(id.clone()))?;
        state.lock().unwrap().launches += 1;
        let (client_io, server_io) = tokio::io::duplex(1 << 16);
        tokio::spawn(async move {
            if let Ok(running) = serve_server(FakeServer { state }, server_io).await {
                let _ = running.waiting().await;
            }
        });
        let lifecycle = ClientLifecycleMode::Discover {
            preferred_versions: vec![ProtocolVersion::V_2026_07_28],
        };
        let service = ()
            .serve_with_lifecycle(client_io, lifecycle)
            .await
            .map_err(|_| Error::Launch(id))?;
        Ok(Connection::new(service, None))
    }
}

pub fn server_id(id: &str) -> ServerId {
    ServerId::new(id).expect("test server id is valid")
}

pub fn record(id: &str, command: PathBuf, trust: Trust) -> ServerRecord {
    ServerRecord::new(server_id(id), command, trust).expect("test command is absolute")
}

/// Approves the program at `binary` and each tool, as the app does at build time.
pub fn seed(pins: &mut Pins, server: &str, binary: &Path, tools: &[Tool]) {
    let id = server_id(server);
    pins.seed_binary(&id, binary).expect("test program is readable");
    for tool in tools {
        pins.seed_tool(&id, tool).expect("test tool is valid");
    }
}

pub fn tool(name: &str, description: &str) -> Tool {
    tool_value(json!({
        "name": name,
        "description": description,
        "inputSchema": {"type": "object"}
    }))
}

pub fn tool_value(value: Value) -> Tool {
    serde_json::from_value(value).expect("test tool is valid")
}

pub fn args(value: Value) -> Map<String, Value> {
    match value {
        Value::Object(map) => map,
        _ => panic!("test arguments must be an object"),
    }
}

/// A file under the temp dir, removed when dropped. The label must be unique per test.
pub struct TempBinary(PathBuf);

impl TempBinary {
    pub fn new(label: &str, bytes: &[u8]) -> Self {
        let path = std::env::temp_dir().join(format!("kalsa-mcp-{label}-{}", std::process::id()));
        std::fs::write(&path, bytes).expect("temp file is writable");
        Self(path)
    }

    pub fn path(&self) -> PathBuf {
        self.0.clone()
    }

    pub fn overwrite(&self, bytes: &[u8]) {
        std::fs::write(&self.0, bytes).expect("temp file is writable");
    }
}

impl Drop for TempBinary {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}
