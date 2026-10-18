//! The browser already on this computer, started on a profile of our own (one
//! responsibility: from a profile directory to a context with our rules
//! installed).

use playwright_rs::protocol::{BrowserContext, Page, Playwright};

use crate::context;
use crate::driver_env;
use crate::find_browser;
use crate::guard;

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
/// tool of this process drives.
///
/// The rules are installed before any page exists, so there is no window in
/// which a request could be made without meeting them.
pub async fn start(profile_dir: &str) -> Result<(Playwright, BrowserContext, Page), Unavailable> {
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
    guard::install(&browser).await.map_err(|_| Unavailable::WouldNotStart)?;
    context::close_what_a_route_cannot(&browser).await.map_err(|_| Unavailable::WouldNotStart)?;

    let page = browser.new_page().await.map_err(|_| Unavailable::WouldNotStart)?;
    Ok((playwright, browser, page))
}

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
}