//! The pairing, proved against a browser that really navigated.
//!
//! `ResponseObject` names no request — in this version it has no `request()` at
//! all — so nothing can match a response to the navigation that asked for it by
//! its address. The pairing is the driver's: `Request::response()` is an RPC
//! whose reply is that one request's response (`request.rs:137`). These two
//! tests are the two halves of what `landing` files from, and neither can be
//! faked: one watches a real browser make a real navigation, the other asks the
//! driver about a real request.

mod common;

use kalsa_browser::landing;
use playwright_rs::protocol::{BrowserContext, Request};
use std::sync::Arc;
use tokio::sync::Mutex;

/// **Every main-frame navigation is numbered**, however it was begun — a `goto`
/// like any other. The count is what a read watches to see a page navigate to
/// the address it is already on, so a navigation that went unnumbered would be
/// a read that returns text from a document nothing checked.
#[tokio::test]
async fn every_main_frame_navigation_the_browser_makes_is_numbered() {
    let (base, _arrived) = common::serve(&[common::page("<h1>one</h1>")]).await;
    let (_sessions, page, landings) = common::sessions_watching("landings-marked", &base).await;
    let before = landings.navigations().await;

    page.goto(&base, None).await.expect("the page loads");
    // The same address again: a reload is the case the address cannot see, and
    // the count is the only thing that can.
    page.goto(&base, None).await.expect("the page reloads");

    assert!(
        landings.navigations().await >= before + 2,
        "two navigations were made and the count moved by {}",
        landings.navigations().await - before
    );
}

/// **The driver answers a request with that request's own response**, and the
/// peer it reports is the address the store files. This is the whole of what
/// makes a record trustworthy: the browser says where *it* connected, and it
/// says it about a request we can name rather than about a URL we matched.
///
/// A stub would agree with whatever number was asserted. This asks a real
/// browser for a real request's real response, and reads out of it the same
/// value `landing` files.
#[tokio::test]
async fn the_driver_answers_a_request_with_that_requests_own_response() {
    let (base, _arrived) = common::serve(&[common::page("<h1>landed</h1>")]).await;
    let (playwright, context, page) = common::browser_on("landings-pairing", &base).await;
    let asked = Arc::new(Mutex::new(None));
    capture_main_frame(&context, &asked).await;

    // The browser writes back the address it resolved, which for a bare origin
    // is the one with the root path on it.
    let here = format!("{base}/");
    page.goto(&here, None).await.expect("the page loads");
    let request = asked
        .lock()
        .await
        .take()
        .expect("the browser made a main-frame request for the document");

    let response = request.response().await.expect("the driver answers").expect("the request was answered");
    // Compared the way the store keys a record, not string for string: the
    // browser writes the address back with the path it resolved, and a
    // comparison that failed on a trailing `/` would be testing nothing.
    assert_eq!(
        landing::key_of(response.url()),
        landing::key_of(&here),
        "the answer came back for another request"
    );
    let peer = response.server_addr().await.expect("the peer is named").expect("a peer was reached");
    assert_eq!(peer.ip_address, "127.0.0.1", "the store would file the wrong address");

    // Held so the browser outlives the calls above.
    drop(playwright);
}

/// **A request that is not the main document's is not asked about**, which is
/// the filter the store is built on: a page loads a hundred subresources, and a
/// record filed for one of them would answer about a document nobody read.
#[tokio::test]
async fn a_subresource_is_never_the_request_we_wait_on() {
    let (base, _arrived) =
        common::serve(&[common::page("<h1>one</h1><script src=\"/worker.js\"></script>"), common::script("self.close()")]).await;
    let (playwright, context, page) = common::browser_on("landings-subresource", &base).await;
    let asked = Arc::new(Mutex::new(None));
    capture_main_frame(&context, &asked).await;

    page.goto(&base, None).await.expect("the page loads");
    let request = asked.lock().await.take().expect("the document was asked for");
    assert!(
        request.is_navigation_request(),
        "the request kept for the store was not the document's"
    );
    drop(playwright);
}

/// Keep the one request a store would file: a document, in the frame with no
/// parent. The test is what `landing::mark` filters on, in the same words.
async fn capture_main_frame(context: &BrowserContext, into: &Arc<Mutex<Option<Request>>>) {
    let into = into.clone();
    context
        .on_request(move |request| {
            let into = into.clone();
            async move {
                let main_frame =
                    request.is_navigation_request() && request.frame().is_some_and(|frame| frame.parent_frame().is_none());
                let mut slot = into.lock().await;
                if main_frame && slot.is_none() {
                    *slot = Some(request);
                }
                Ok(())
            }
        })
        .await
        .expect("the request listener is installed");
}
