//! The browser already on this computer, started on a profile of our own (one
//! responsibility: from a profile directory to a context with our rules
//! installed).

use playwright_rs::protocol::{BrowserContext, Page, Playwright};

use crate::context;
use crate::driver_env;
use crate::find_browser;
use crate::guard;
use crate::hold::Holds;
use crate::landing::Landings;
use crate::session;
use crate::snapshot;
use crate::submit;
use std::sync::Arc;

/// Why there is no browser to answer a call. Every variant is one plain line,
/// and none of them names a path on the person's disk.
#[derive(Debug)]
pub enum Unavailable {
    Driver(driver_env::Missing),
    Browser(find_browser::Missing),
    /// The browser is there and new enough, and it would not start.
    WouldNotStart,
}

impl Unavailable {
    pub fn message(&self) -> &'static str {
        match self {
            Unavailable::Driver(missing) => missing.message(),
            Unavailable::Browser(missing) => missing.message(),
            Unavailable::WouldNotStart => "the browser could not be started, so the page is not there",
        }
    }
}

/// Start the browser, headed, on `profile_dir`, and return the one page every
/// tool of this process drives, with the record of where it has landed.
///
/// The rules are installed before any page exists, so there is no window in
/// which a request could be made without meeting them.
pub async fn start(
    profile_dir: &str,
    paused: Arc<std::sync::atomic::AtomicBool>,
) -> Result<(Playwright, BrowserContext, Page, Landings, Holds), Unavailable> {
    driver_env::apply().map_err(Unavailable::Driver)?;
    let executable = find_browser::installed().await.map_err(Unavailable::Browser)?;

    let playwright = Playwright::launch().await.map_err(|_| Unavailable::WouldNotStart)?;
    let options = context::options(&executable);
    let browser = playwright
        .chromium()
        .launch_persistent_context_with_options(profile_dir.to_string(), options)
        .await
        .map_err(|_| Unavailable::WouldNotStart)?;

    // Order matters: the guard first, so a socket refused for a private address
    // is closed by a rule that is already in place.
    let landings = Landings::new();
    let holds = Holds::bound_to(paused);
    guard::install(&browser, &landings, &holds).await.map_err(|_| Unavailable::WouldNotStart)?;
    context::close_what_a_route_cannot(&browser).await.map_err(|_| Unavailable::WouldNotStart)?;
    // **The external-protocol listener, on the context and not on the page**:
    // Chromium hands a `mailto:` to the operating system before anything becomes
    // a request, so no route here can refuse it, and the tool layer's check only
    // covers the elements a model names. See `external.rs` for what was measured.
    crate::external::install(&browser).await.map_err(|_| Unavailable::WouldNotStart)?;

    let page = browser.new_page().await.map_err(|_| Unavailable::WouldNotStart)?;
    // A submission is caught in the page rather than in the route, so this has
    // to be in place before anything can navigate. It is an init script, so it
    // survives every navigation the window makes afterwards.
    submit::install(&page).await.map_err(|_| Unavailable::WouldNotStart)?;
    // **The session is not ready until the driver has answered.** A browser
    // that has just been started is not ready the moment it exists: the first
    // call it is given can fail with a driver error, and that failure has no
    // retry of its own — the page is not there, and the model is told the page
    // did not answer. So the driver is asked something before the session is
    // declared ready, and the wait for it is short.
    probe(&page).await.map_err(|_| Unavailable::WouldNotStart)?;
    Ok((playwright, browser, page, landings, holds))
}

/// **The probe that decides whether the driver is awake.**
///
/// It asks for the tree of the page — the call a read makes — and it asks the
/// driver again after a pause when the answer does not come. A driver that is
/// waking up answers the second time; a driver that is never coming is not
/// waited for.
///
/// **Every attempt is bounded and the whole wait has a ceiling.** The driver
/// would wait half a minute of its own; the probe gives it two seconds,
/// because a probe that waits is not a probe, and a browser that cannot be
/// asked must not hold the call for ever: it is the browser that could not be
/// started, and the person is told that.
async fn probe(page: &Page) -> Result<(), playwright_rs::Error> {
    let deadline = std::time::Instant::now() + PROBE_WAIT;
    let mut pause = PROBE_PAUSE;
    let mut last = playwright_rs::Error::Timeout("the driver did not answer".to_owned());
    loop {
        // **What is left of the wait is what the attempt and the pause may
        // have.** The ceiling is the ceiling: a probe that has five seconds may
        // not spend six of them, and the pause is part of the wait, not a
        // gift on top of it.
        let now = std::time::Instant::now();
        if now >= deadline {
            return Err(last);
        }
        let left = deadline.saturating_duration_since(now);
        match tokio::time::timeout(attempt_budget(left), snapshot::probe(page)).await {
            Ok(Ok(())) => return Ok(()),
            Ok(Err(error)) => {
                // A page that has gone is not a driver that was busy: there is
                // nothing left to ask, and waiting would only be slower.
                if session::reason_of(&error).is_some() {
                    return Err(error);
                }
                last = error;
            }
            // The attempt ran out of time: the driver did not answer in the
            // time it was given, and the next one is asked.
            Err(_elapsed) => {}
        }
        let now = std::time::Instant::now();
        if now >= deadline {
            return Err(last);
        }
        let left = deadline.saturating_duration_since(now);
        tokio::time::sleep(pause_budget(left, pause)).await;
        pause = (pause * 2).min(PROBE_MAX_PAUSE);
    }
}

/// **What one attempt may take: what is left of the wait, and no more than an
/// attempt is worth.**
fn attempt_budget(left: std::time::Duration) -> std::time::Duration {
    left.min(PROBE_ATTEMPT)
}

/// **How long the pause may be: what is left of the wait, and no more than the
/// pause is worth.** The pause is part of the wait, not a gift on top of it.
fn pause_budget(left: std::time::Duration, pause: std::time::Duration) -> std::time::Duration {
    pause.min(left)
}

/// **How long the probe waits for the driver to answer.**
const PROBE_WAIT: std::time::Duration = std::time::Duration::from_secs(5);

/// **How long one attempt at the probe may take.** The driver's own patience is
/// half a minute, and the probe is not a read: it must be quick or it is not
/// a probe.
const PROBE_ATTEMPT: std::time::Duration = std::time::Duration::from_secs(2);

/// **How long the probe pauses before it asks again.**
const PROBE_PAUSE: std::time::Duration = std::time::Duration::from_millis(150);

/// The longest the pause between two attempts grows to.
const PROBE_MAX_PAUSE: std::time::Duration = std::time::Duration::from_millis(600);

#[cfg(test)]
mod tests {
    use super::Unavailable;

    #[test]
    fn every_reason_is_one_line_a_person_can_act_on() {
        for unavailable in [
            Unavailable::WouldNotStart,
            Unavailable::Browser(crate::find_browser::Missing::NoneInstalled),
            Unavailable::Browser(crate::find_browser::Missing::TooOld { name: "Google Chrome" }),
            Unavailable::Browser(crate::find_browser::Missing::NoVersion),
            Unavailable::Driver(crate::driver_env::Missing::NotSet),
            Unavailable::Driver(crate::driver_env::Missing::NotADriver),
        ] {
            let message = unavailable.message();
            assert!(!message.is_empty());
            assert!(message.chars().count() < 160, "{message}");
            assert!(!message.contains('/') && !message.contains('\\'), "{message}");
        }
    }

    #[test]
    fn a_browser_that_would_not_start_says_that_and_nothing_else() {
        assert_eq!(
            Unavailable::WouldNotStart.message(),
            "the browser could not be started, so the page is not there"
        );
    }

    /// **A driver that answers the probe is awake.** The probe asks for the
    /// tree of the page — the call a read makes — and the page the browser has
    /// just opened holds nothing, so the answer costs almost nothing.
    #[tokio::test]
    async fn a_driver_that_answers_the_probe_is_awake() {
        let (_playwright, context, page) = crate::tests::headless().await;
        super::probe(&page).await.expect("the driver answers");
        context.close().await.expect("the fixture closes");
    }

    /// **A window that has gone is not waited for.** There is nothing there to
    /// answer, so the probe gives up at once rather than spending its whole
    /// ceiling on a driver that is never coming.
    #[tokio::test]
    async fn a_probe_on_a_window_that_has_gone_gives_up_at_once() {
        let (_playwright, _context, page) = crate::tests::headless().await;
        page.close().await.expect("the page closes");
        let started = std::time::Instant::now();
        let error = super::probe(&page).await.expect_err("a window that has gone is not ready");
        assert!(
            started.elapsed() < super::PROBE_WAIT,
            "the probe did not wait its whole ceiling: {started:?}"
        );
        assert!(
            crate::session::reason_of(&error).is_some(),
            "and the failure says the window has ended: {error}"
        );
    }

    /// **The ceiling is the ceiling.** An attempt may not outlast the wait that
    /// is left of it, and the pause is part of that wait: five seconds of probe
    /// may not become six.
    #[test]
    fn the_probe_never_spends_more_than_its_wait() {
        let millis = std::time::Duration::from_millis;
        let secs = std::time::Duration::from_secs;
        assert_eq!(super::attempt_budget(millis(100)), millis(100), "what is left is what is left");
        assert_eq!(super::attempt_budget(secs(30)), super::PROBE_ATTEMPT, "and an attempt is never more than an attempt");
        assert_eq!(super::pause_budget(millis(10), millis(150)), millis(10), "the pause may not outlast the wait");
        assert_eq!(super::pause_budget(secs(30), millis(150)), millis(150), "and it is the pause it asked for");
    }
}