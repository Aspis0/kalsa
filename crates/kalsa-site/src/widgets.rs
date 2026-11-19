//! The line at the bottom of an engine or developer page.

use crate::html::{encode_component, safe_href, HELP};

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
