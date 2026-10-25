//! Starts the mail server. The account arrives as the first line of stdin and is
//! consumed before the MCP stream takes the same descriptor over.

use kalsa_mail::{account, bootstrap, mcp};
use rmcp::ServiceExt;

fn main() -> std::process::ExitCode {
    let line = match bootstrap::first_line() {
        Ok(line) => line,
        Err(message) => return fail(message),
    };
    let account = match account::read(&line) {
        Ok(account) => account,
        Err(message) => return fail(message),
    };
    // Wipes the line, and with it the password, before the server starts.
    drop(line);

    let runtime = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(_) => return fail("the async runtime could not be started"),
    };
    match runtime.block_on(serve(account)) {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(_) => fail("the mail server stopped"),
    }
}

async fn serve(account: account::Account) -> Result<(), ()> {
    let service = mcp::MailServer::new(account)
        .serve(rmcp::transport::stdio())
        .await;
    match service {
        Ok(service) => service.waiting().await.map(|_| ()).map_err(|_| ()),
        Err(_) => Err(()),
    }
}

/// Every line this process writes is one of these. No reply from a mail server and
/// nothing from an account line reaches it.
fn fail(message: &str) -> std::process::ExitCode {
    eprintln!("kalsa-mail: {message}");
    std::process::ExitCode::FAILURE
}
