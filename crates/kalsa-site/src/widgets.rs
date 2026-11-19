//! The line at the bottom of an engine or developer page: corrections, and the owner's own way out.

use crate::html::{safe_href, HELP};
use crate::paths;

/// One quiet line. A mistake goes to the mailbox; a removal the owner does alone, from the page itself.
pub fn claim_line(page: &str, kind: &str, id: &str) -> String {
    let root = paths::root_for(page);
    let remove = format!("{root}remove/index.html?kind={kind}&id={id}");
    format!(
        "<p class=\"quiet\">Something wrong or out of date? Write to <a class=\"qlink\" href=\"{mail}\">{HELP}</a> · \
         <a class=\"qlink\" href=\"{remove}\">Remove this page</a></p>",
        mail = safe_href(&format!("mailto:{HELP}")),
        remove = safe_href(&remove),
    )
}
