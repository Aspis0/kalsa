//! What the browser is allowed to do, as one context (one responsibility: the
//! settings that make route interception the only way out, and the refusal of
//! the channels a route cannot see).
//!
//! Three of these are load-bearing and each closes a hole a page could otherwise
//! open behind our back:
//!
//! - Service workers are blocked. Playwright says it in terms: *"browserContext.route() will not
//!   intercept requests intercepted by Service Worker… We recommend disabling Service Workers when
//!   using request interception by setting serviceWorkers to 'block'."* A page that registered one
//!   could issue requests the guard never sees, and every refusal in guard.rs would be a rule with
//!   a hole in it.
//! - WebSockets are closed rather than opened. A socket is a channel we neither
//!   hold nor show, so there is nothing a confirm could ever be asked about.
//! - Downloads are not accepted, so no file lands and there is no download
//!   confirm to draw.
//!
//! WebRTC is off twice over, because either half alone leaves the other: the
//! launch flag stops the browser from reaching a local network address for a
//! peer connection, and the init script takes the constructors away from the
//! page so there is nothing left to call.

use playwright_rs::protocol::{
    AcceptDownloads, BrowserContext, BrowserContextOptions, WebSocketRouteCloseOptions,
};

/// Stops the browser from using a local address to reach a peer. The other half
/// is `NO_WEBRTC` below.
const NO_WEBRTC: &str = "--force-webrtc-ip-handling-policy=disable_non_proxied_udp";

/// What a page finds when it reaches for WebRTC. Taken away at document start,
/// before any page script runs.
const NO_WEBRTC_IN_PAGE: &str = r#"
for (const name of [
  'RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel',
  'RTCSessionDescription', 'RTCIceCandidate', 'RTCIceServer',
  'RTCRtpSender', 'RTCRtpReceiver', 'RTCRtpTransceiver', 'RTCCertificate',
]) {
  try { delete window[name]; } catch (error) { /* a frozen window is as good */ }
  try {
    Object.defineProperty(window, name, { get: () => undefined, configurable: true });
  } catch (error) { /* already gone */ }
}
"#;

/// The options the context is built with. The profile directory is not one of
/// them: `launch_persistent_context` takes it beside the options, because
/// Playwright refuses a `--user-data-dir` argument, and a dedicated profile is
/// not a preference but the only way this can work at all — since Chrome 136 the
/// remote debugging switches are ignored on the default data directory.
pub(crate) fn options(executable: &str) -> BrowserContextOptions {
    let mut options = BrowserContextOptions::default();
    // Playwright's own default is headless, and this browser is driven by a
    // person who watches it.
    options.headless = Some(false);
    options.executable_path = Some(executable.to_string());
    // Said out loud rather than left to Playwright's default: a browser with its
    // sandbox off is a browser with nothing between a page and this machine.
    options.chromium_sandbox = Some(true);
    options.accept_downloads = Some(AcceptDownloads::Deny);
    options.service_workers = Some("block".to_string());
    let mut args = options.args.take().unwrap_or_default();
    args.push(NO_WEBRTC.to_string());
    options.args = Some(args);
    options
}

/// Refuse the two channels route interception does not reach. The address of a
/// socket is refused by the same rules as any other address, so a socket into
/// this computer's own network is closed for the same reason a request to it
/// would be.
pub(crate) async fn close_what_a_route_cannot(context: &BrowserContext) -> Result<(), playwright_rs::Error> {
    context
        .route_web_socket("**/*", |socket| async move {
            let _ = crate::guard::verdict(socket.url());
            socket
                .close(WebSocketRouteCloseOptions::default().code(1000).reason("kalsa"))
                .await
        })
        .await?;
    context.add_init_script(NO_WEBRTC_IN_PAGE).await
}

#[cfg(test)]
mod tests {
    use super::{options, NO_WEBRTC, NO_WEBRTC_IN_PAGE};
    use playwright_rs::protocol::AcceptDownloads;

    #[test]
    fn the_context_is_headed_on_the_installed_browser_with_its_sandbox_on() {
        let options = options("/Applications/Google Chrome.app/x");
        assert_eq!(options.headless, Some(false));
        assert_eq!(options.executable_path.as_deref(), Some("/Applications/Google Chrome.app/x"));
        assert_eq!(options.chromium_sandbox, Some(true));
    }

    #[test]
    fn the_context_takes_no_download_and_registers_no_service_worker() {
        let options = options("/chrome");
        assert_eq!(options.accept_downloads, Some(AcceptDownloads::Deny));
        assert_eq!(options.service_workers.as_deref(), Some("block"));
    }

    #[test]
    fn the_launch_flag_stops_webrtc_reaching_a_local_address() {
        let options = options("/chrome");
        let args = options.args.expect("args");
        assert!(args.iter().any(|arg| arg == NO_WEBRTC), "{args:?}");
        // The sandbox flag is ours to set and must not be handed over flipped.
        assert!(!args.iter().any(|arg| arg == "--no-sandbox"), "{args:?}");
    }

    /// The flag alone still leaves the constructors on `window`; the script
    /// alone still lets the browser probe a local address. Both, so a test can
    /// prove the page cannot even name the thing it is not allowed to do.
    #[test]
    fn the_page_is_taken_every_webrtc_constructor() {
        for name in ["RTCPeerConnection", "webkitRTCPeerConnection", "RTCDataChannel"] {
            assert!(NO_WEBRTC_IN_PAGE.contains(name), "{name} is still on the page");
        }
        assert!(NO_WEBRTC_IN_PAGE.contains("delete window[name]"));
    }
}