//! What the window is not allowed to do, on a real browser.
//!
//! Each of these is a channel that route interception does not reach. A page
//! that opened one behind us would send and receive everything the guard and the
//! confirms exist to control, and none of that would ever be seen.

mod common;

/// The worker script the page registers. It answers every fetch, so if it ran,
/// the page's traffic would not pass through the route at all.
const WORKER: &str = r#"
self.addEventListener('fetch', event => {
  event.respondWith(new Response('from the worker'));
});
"#;

/// A service worker is blocked on our context, and the same page on a window
/// built without that block registers one. Two windows disagreeing is what makes
/// this a proof rather than a page that never worked either way.
#[tokio::test]
async fn a_service_worker_is_blocked_where_our_context_says_it_is() {
    let (base, _arrived) = common::serve(&[common::page(
        r#"<h1>page</h1>
           <script>
             navigator.serviceWorker.register('/worker.js').catch(() => {});
           </script>"#,
    ), common::script(WORKER)])
    .await;

    let (_ours, _context, page) = common::browser_on("context-sw", &base).await;
    page.goto(&base, None).await.expect("the page loads");
    tokio::time::sleep(std::time::Duration::from_millis(1200)).await;
    assert_eq!(common::registrations(&page).await, 0, "no worker may register here");

    let (_theirs, _context, plain) = common::browser_without_our_rules().await;
    plain.goto(&base, None).await.expect("the page loads");
    tokio::time::sleep(std::time::Duration::from_millis(1200)).await;
    assert!(common::registrations(&plain).await > 0, "without the block, one does");
}

/// A socket is a channel we neither hold nor show, so there is nothing a confirm
/// could be asked about. The page sees a clean close and no server ever hears it.
#[tokio::test]
async fn a_websocket_is_closed_and_never_connected() {
    let (base, arrived) = common::serve(&[common::page("")]).await;
    let (_playwright, _context, page) = common::browser_on("context-ws", &base).await;
    page.set_content(
        &format!(
            r#"<script>
                 window.outcome = 'pending';
                 const socket = new WebSocket('ws://{}/socket');
                 socket.onopen = () => {{ window.outcome = 'opened'; }};
                 socket.onclose = event => {{ window.outcome = 'closed:' + event.code; }};
               </script>"#,
            base.trim_start_matches("http://")
        ),
        None,
    )
    .await
    .expect("the content is set");

    let outcome: String = page
        .evaluate::<(), String>(
            "async () => { for (let i = 0; i < 40; i += 1) { if (window.outcome !== 'pending') return window.outcome; await new Promise(r => setTimeout(r, 100)); } return window.outcome; }",
            None,
        )
        .await
        .expect("the page answers");
    assert!(outcome.starts_with("closed:"), "the socket must close, it read {outcome}");

    // The control: the same page fetches over HTTP, so the recorder works and
    // the site was reached. What it never saw is a handshake.
    page.evaluate::<String, ()>(r#"async base => { await fetch(base + '/ping'); }"#, Some(&base))
        .await
        .ok();
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    assert!(arrived.asked_for("/ping"), "the page never reached the site: {:?}", arrived.requests());
    assert_eq!(arrived.handshakes(), 0, "a socket reached the site: {:?}", arrived.requests());
}

/// A download leaves a file on the person's disk that nothing confirmed and
/// nothing will ever read. The context takes none, and the profile proves it.
#[tokio::test]
async fn a_download_leaves_no_file_anywhere() {
    let (base, _arrived) = common::serve(&[common::page(
        r#"<a id="get" href="/file.txt" download>save it</a>"#,
    ), common::download("the file the page wanted to save")])
    .await;
    let name = "context-download";
    let profile = common::profile(name);
    let (_playwright, _context, page) = common::browser_on(name, &base).await;
    page.goto(&base, None).await.expect("the page loads");

    // The whole of both folders, before and after. A browser writes its own
    // profile files while it runs, so the comparison is taken once the page has
    // settled and the click is the only thing between the two.
    tokio::time::sleep(std::time::Duration::from_millis(800)).await;
    let downloads = format!("{}/Downloads", std::env::var("HOME").unwrap_or_default());
    let before = (common::file_list(&profile), common::file_list(&downloads));

    page.locator("#get").click(None).await.expect("the link is clicked");
    tokio::time::sleep(std::time::Duration::from_millis(2000)).await;

    let after = (common::file_list(&profile), common::file_list(&downloads));
    let new_in_profile: Vec<&String> = after.0.iter().filter(|f| !before.0.contains(f)).collect();
    let new_in_downloads: Vec<&String> = after.1.iter().filter(|f| !before.1.contains(f)).collect();

    // Nothing else on this computer is writing to Downloads, so anything new
    // there is the download.
    assert!(new_in_downloads.is_empty(), "the download landed in Downloads: {new_in_downloads:?}");

    // A running browser writes its own bookkeeping into its profile — a
    // session file, a blob store, a cache — so the whole diff is reported and
    // what is asserted is that the refused file is not in it.
    let refused = format!("/{}/", "file.txt");
    let landed: Vec<&&String> = new_in_profile
        .iter()
        .filter(|path| path.ends_with(&refused) || path.contains("file (1)"))
        .collect();
    assert!(landed.is_empty(), "the download landed in the profile: {landed:?}\nwhole diff: {new_in_profile:?}");
    assert!(
        !page.url().ends_with("/file.txt"),
        "the page did not navigate to the file, it is on {}",
        page.url()
    );
}

/// The page has no WebRTC to reach a local network with: the constructors are
/// gone, not merely unused. The flag alone would not do this, and the script
/// alone would not have stopped the browser probing a local address.
#[tokio::test]
async fn the_page_has_no_webrtc_to_reach_a_local_network_with() {
    let (base, _arrived) = common::serve(&[common::page("")]).await;
    let (_playwright, _context, page) = common::browser_on("context-webrtc", &base).await;
    page.goto(&base, None).await.expect("the page loads");

    // The top document, a frame inside it, and a window it opened. An init
    // script that only reached the first would leave a page inside a page with
    // the constructors back.
    let top = names_in(&page).await;
    assert_all_gone(&top, "the page");

    let frame: Vec<String> = page
        .evaluate::<(), Vec<String>>(
            r#"async () => {
                 const frame = document.createElement('iframe');
                 frame.srcdoc = '<p>inside</p>';
                 document.body.append(frame);
                 await new Promise(r => (frame.onload = r));
                 const w = frame.contentWindow;
                 return ['RTCPeerConnection','webkitRTCPeerConnection','RTCDataChannel']
                   .map(name => name + '=' + typeof w[name]);
               }"#,
            None,
        )
        .await
        .expect("the frame answers");
    assert_all_gone(&frame, "a frame");

    let popup: Vec<String> = page
        .evaluate::<(), Vec<String>>(
            r#"async () => {
                 const opened = window.open('about:blank', '_blank');
                 if (opened === null) return ['popup=refused'];
                 for (let i = 0; i < 40 && opened.document.readyState !== 'complete'; i += 1) {
                   await new Promise(r => setTimeout(r, 50));
                 }
                 const kinds = ['RTCPeerConnection','webkitRTCPeerConnection','RTCDataChannel']
                   .map(name => name + '=' + typeof opened[name]);
                 opened.close();
                 return kinds;
               }"#,
            None,
        )
        .await
        .expect("the page answers");
    assert_all_gone(&popup, "a popup");
}

async fn names_in(page: &playwright_rs::protocol::Page) -> Vec<String> {
    page.evaluate::<(), Vec<String>>(
        r#"() => ['RTCPeerConnection','webkitRTCPeerConnection','RTCDataChannel']
             .map(name => name + '=' + typeof window[name])"#,
        None,
    )
    .await
    .expect("the page answers")
}

fn assert_all_gone(kinds: &[String], where_: &str) {
    assert!(!kinds.is_empty(), "nothing was checked in {where_}");
    for kind in kinds {
        assert!(kind.ends_with("=undefined"), "{kind} is still there in {where_}");
    }
}