pub const MAX_ITEMS: usize = 50;

pub struct MailServer {
    tool_router: ToolRouter<MailServer>,
}

impl MailServer {
    pub fn new(account: Account) -> MailServer {
        // The closures own the account rather than borrowing it: a tool call runs
        // with a reference to the service, and the password must not be tied to it.
        let account = Arc::new(account);
        let tool_router = ToolRouter::new()
            .with_route(ToolRoute::new(tools::list(), {
                let account = account.clone();
                move |Parameters(args): Parameters<ListArgs>| {
                    let account = account.clone();
                    async move { list(account, args).await }
                }
            }))
            .with_route(ToolRoute::new(tools::read(), {
                let account = account.clone();
                move |Parameters(args): Parameters<ReadArgs>| {
                    let account = account.clone();
                    async move { read(account, args).await }
                }
            }))
            .with_route(ToolRoute::new(tools::draft(), {
                let account = account.clone();
                move |Parameters(args): Parameters<DraftArgs>| {
                    let account = account.clone();
                    async move { draft_reply(account, args).await }
                }
            }));
        MailServer { tool_router }
    }
}

async fn open(account: &Account, folder: &str) -> Result<Mailbox, MailError> {
    let session = imap::connect(account).await?;
    Mailbox::examine(session, folder).await
}

/// The mails a call needs: the ones it was asked for, plus every sender in the folder
/// so the unseen-sender rule can look past the window it is listing.
async fn gather(
    account: &Account,
    folder: &str,
    uids: &[u32],
) -> Result<(Vec<(u32, Vec<u8>)>, Vec<label::Sender>), MailError> {
    let mut mailbox = open(account, folder).await?;
    let sources = mailbox.sources(uids).await;
    let senders = mailbox.senders().await;
    mailbox.logout().await;
    Ok((sources?, senders?))
}

async fn list(account: Arc<Account>, args: ListArgs) -> CallToolResult {
    let days = args.days.unwrap_or(1).clamp(1, MAX_DAYS);
    let folder = args.folder.unwrap_or_else(default_folder);
    let mut mailbox = match open(&account, &folder).await {
        Ok(mailbox) => mailbox,
        Err(error) => return view::error(error.message()),
    };
    let uids = match mailbox
        .uids(days, args.from.as_deref(), args.query.as_deref(), MAX_ITEMS)
        .await
    {
        Ok(uids) => uids,
        Err(error) => return view::error(error.message()),
    };
    let sources = match mailbox.sources(&uids).await {
        Ok(sources) => sources,
        Err(error) => return view::error(error.message()),
    };
    let senders = match mailbox.senders().await {
        Ok(senders) => senders,
        Err(error) => return view::error(error.message()),
    };
    mailbox.logout().await;

    let items: Vec<ListItem> = sources
        .iter()
        .map(|(uid, raw)| {
            let parsed = mail::parse(raw);
            let labels = label::label(&parsed, &senders, account.trusted_authserv_id.as_deref());
            ListItem::of(*uid, &parsed, &labels)
        })
        .collect();

    let fence = Fence::new();
    let lines: Vec<String> = items.iter().flat_map(|item| item.fenced(&fence)).collect();
    view::result(
        &ListOut {
            folder,
            count: items.len(),
            items,
        },
        lines,
    )
}

fn default_folder() -> String {
    "INBOX".to_string()
}

async fn read(account: Arc<Account>, args: ReadArgs) -> CallToolResult {
    let folder = args.folder.unwrap_or_else(default_folder);
    let (sources, senders) = match gather(&account, &folder, &[args.id]).await {
        Ok(gathered) => gathered,
        Err(error) => return view::error(error.message()),
    };
    let Some((uid, raw)) = sources.into_iter().next() else {
        return view::error("there is no message with that id in this folder");
    };
    let parsed = mail::parse(&raw);
    let labels = label::label(&parsed, &senders, account.trusted_authserv_id.as_deref());
    let out = ReadOut::of(uid, &parsed, &labels);
    let fence = Fence::new();
    let lines = out.fenced(&fence);
    view::result(&out, lines)
}

async fn draft_reply(account: Arc<Account>, args: DraftArgs) -> CallToolResult {
    let folder = args.folder.unwrap_or_else(default_folder);
    let (sources, _) = match gather(&account, &folder, &[args.reply_to_id]).await {
        Ok(gathered) => gathered,
        Err(error) => return view::error(error.message()),
    };
    let Some((_, raw)) = sources.into_iter().next() else {
        return view::error("there is no message with that id in this folder");
    };
    let parsed = mail::parse(&raw);
    match draft::reply_to(&parsed, &args.body) {
        Ok(draft) => {
            let fence = Fence::new();
            let lines = vec![
                fence.field("to", &draft.to),
                fence.field("subject", &draft.subject),
                fence.field("body", &draft.body),
            ];
            view::result(&draft, lines)
        }
        Err(message) => view::error(message),
    }
}

#[derive(Deserialize)]
struct ListArgs {
    /// How many days back to look. One by default, fourteen at most.
    days: Option<u32>,
    /// The folder to read. INBOX by default.
    folder: Option<String>,
    /// Only mails from this address.
    from: Option<String>,
    /// Free text to look for in the whole message.
    query: Option<String>,
}

#[derive(Deserialize)]
struct ReadArgs {
    /// The UID, as it appears in a `list` result.
    id: u32,
    folder: Option<String>,
}

#[derive(Deserialize)]
struct DraftArgs {
    /// The UID of the message being answered.
    reply_to_id: u32,
    /// What the person wrote. This is the only free text a `draft` call carries.
    body: String,
    folder: Option<String>,
}

impl ServerHandler for MailServer {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            // The revision this server speaks. The host negotiates downwards; nothing
            // here needs a handshake beyond what the SDK already handles.
            .with_protocol_version(ProtocolVersion::LATEST)
            .with_server_info(Implementation::new(
                env!("CARGO_PKG_NAME"),
                env!("CARGO_PKG_VERSION"),
            ))
            .with_instructions(INSTRUCTIONS)
    }

    fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: rmcp::service::RequestContext<RoleServer>,
    ) -> impl Future<Output = Result<CallToolResponse, ErrorData>> + '_ {
        self.tool_router
            .call(ToolCallContext::new(self, request, context))
    }

    fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: rmcp::service::RequestContext<RoleServer>,
    ) -> impl Future<Output = Result<ListToolsResult, ErrorData>> + '_ {
        std::future::ready(Ok(ListToolsResult {
            result_type: Some(ResultType::COMPLETE),
            tools: self.tool_router.list_all(),
            next_cursor: None,
            // The tool list cannot change while the process runs, so a host may keep
            // it for the whole conversation.
            ttl_ms: Some(0),
            cache_scope: Some(CacheScope::Public),
            meta: None,
        }))
    }

    fn get_tool(&self, name: &str) -> Option<Tool> {
        self.tool_router
            .list_all()
            .into_iter()
            .find(|tool| tool.name == name)
    }
}
