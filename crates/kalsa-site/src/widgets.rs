//! Small pieces shared by several pages: the share bar and the line at the bottom of a page.

use crate::html::{encode_component, escape, safe_href, HELP};
use crate::paths;

/// The shareable address and a copy button.
pub fn url_bar(path: &str) -> String {
    let url = paths::canonical(path);
    format!(
        "<div class=\"urlbar\"><span class=\"u\">{shown}</span><button class=\"cp\" data-copy=\"{url}\">Copy link</button></div>",
        shown = escape(url.trim_start_matches("https://")),
        url = escape(&url),
    )
}

/// One quiet line at the bottom of a page: how to report a mistake or ask for the page to go.
/// A removal can be asked for by email or through a prefilled GitHub issue.
pub fn claim_line(who: &str) -> String {
    let issue = format!("https://github.com/Aspis0/kalsa/issues/new?title={}", encode_component(&format!("Removal request: {who}")));
    format!(
        "<p class=\"quiet\">Something wrong or out of date? Write to <a class=\"qlink\" href=\"{mail}\">{HELP}</a>, or <a class=\"qlink\" href=\"{issue}\">ask us to remove this page</a>.</p>",
        mail = safe_href(&format!("mailto:{HELP}")),
        issue = safe_href(&issue),
    )
}
