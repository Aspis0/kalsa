//! Headless fixtures exercise the production code with local HTTP and data documents.

mod find;
mod main_frame;
mod screenshot;

use crate::hold::Holds;
use crate::landing::Landings;
use crate::session::Sessions;
use playwright_rs::protocol::{BrowserContext, Page, Playwright};
use playwright_rs::LaunchOptions;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

/// Retain Playwright alongside the page so the driver outlives the fixture.
pub(crate) async fn headless() -> (Playwright, BrowserContext, Page) {
    let executable = crate::find_browser::installed().await.expect("the installed browser");
    let playwright = Playwright::launch().await.expect("the verified driver starts");
    let browser = playwright
        .chromium()
        .launch_with_options(
            LaunchOptions::new()
                .executable_path(executable)
                .headless(true)
                .chromium_sandbox(true),
        )
        .await
        .expect("the browser starts");
    let context = browser.new_context().await.expect("the context is there");
    let page = context.new_page().await.expect("the page is there");
    (playwright, context, page)
}

/// The headless session uses the production navigation counter.
pub(crate) async fn window(base: &str) -> (Playwright, BrowserContext, Page, Sessions) {
    let (playwright, context, page) = headless().await;
    let landings = Landings::new();
    let holds = Holds::new();
    crate::guard::install(&context, &landings, &holds).await.expect("the guard is watching");
    // Allow this local fixture while retaining the production guard for other destinations.
    let allowed = base.to_string();
    page.route("**/*", move |route| {
        let allowed = allowed.clone();
        async move {
            if route.request().url().starts_with(&allowed) {
                route.continue_(None).await
            } else {
                route.fallback(None).await
            }
        }
    })
    .await
    .expect("the test route is installed");
    let sessions = Sessions::with_window(playwright.clone(), context.clone(), page.clone(), landings, holds);
    (playwright, context, page, sessions)
}

/// HTTP fixtures exercise request-based navigation counting; data URLs do not.
pub(crate) async fn serve(pages: impl FnOnce(&str) -> Vec<(String, String)>) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("the port is ours");
    let base = format!("http://{}", listener.local_addr().expect("the address"));
    let pages = pages(&base);
    tokio::spawn(async move {
        while let Ok((mut stream, _)) = listener.accept().await {
            let pages = pages.clone();
            tokio::spawn(async move {
                let mut ask = [0u8; 8192];
                let read = stream.read(&mut ask).await.unwrap_or(0);
                let path = String::from_utf8_lossy(&ask[..read])
                    .split_whitespace()
                    .nth(1)
                    .unwrap_or("/")
                    .to_string();
                let body = pages
                    .iter()
                    .find(|(at, _)| *at == path)
                    .map(|(_, body)| body.clone())
                    .unwrap_or_else(|| "<h1>not here</h1>".to_string());
                let head = format!(
                    "HTTP/1.1 200 OK\r\ncontent-type: text/html; charset=utf-8\r\ncontent-length: {}\r\n\r\n",
                    body.len()
                );
                let _ = stream.write_all(head.as_bytes()).await;
                let _ = stream.write_all(body.as_bytes()).await;
                let _ = stream.flush().await;
            });
        }
    });
    base
}

/// The unescaped comma separates the data URL metadata from the page.
pub(crate) fn page(html: &str) -> String {
    let mut out = String::from("data:text/html,");
    for byte in html.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' | b':' | b'=' => {
                out.push(byte as char)
            }
            b' ' => out.push_str("%20"),
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}
