//! What one element contributes to the text a person reads.
//!
//! Split from the walk because the answer is per element and does not depend on
//! where the element sits: three renderers disagree about unclosed tags and
//! foster parenting, this one does not get a vote.

use crate::html_hide::{self, Rules};
use scraper::node::Element;

/// Elements whose subtree is never shown and never read: not text at all.
const DROPPED: [&str; 11] = [
    "script", "style", "head", "svg", "title", "meta", "link", "base", "iframe", "object", "form",
];

/// Elements no client renders, but whose text a naive converter would keep.
const HIDDEN_WHEN_DROPPED: [&str; 3] = ["template", "noscript", "noembed"];

/// Elements that end a line a person reads.
pub(crate) const BLOCK: [&str; 15] = [
    "address",
    "article",
    "blockquote",
    "div",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "li",
    "p",
    "pre",
    "section",
    "table",
];

/// Whether this element's own text is taken off the page by a declaration or an
/// attribute.
pub(crate) fn is_hidden(element: &Element, rules: &Rules) -> bool {
    html_hide::hides(element, rules)
}

/// Whether this element is not text a client shows: a stylesheet, a script, a
/// head, or a template nobody renders.
pub(crate) fn is_dropped(name: &str) -> bool {
    DROPPED.contains(&name) || HIDDEN_WHEN_DROPPED.contains(&name)
}

/// Whether what this element carries is counted as hidden when it is dropped.
/// A stylesheet nobody reads is not a secret and an empty template is a page
/// template, so neither accuses the sender.
pub(crate) fn counts_as_hidden(name: &str) -> bool {
    HIDDEN_WHEN_DROPPED.contains(&name)
}

/// A remote image is a part this server never opens, and its alt text is where
/// the marketing goes; a local one keeps its caption.
pub(crate) fn image_text(element: &Element) -> Option<String> {
    let url = element.attr("src").unwrap_or_default().trim_start();
    let remote = url.starts_with("//")
        || url.starts_with("http://")
        || url.starts_with("https://")
        || url.to_ascii_lowercase().starts_with("cid:");
    if remote {
        None
    } else {
        element.attr("alt").map(|alt| format!(" {alt} "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_remote_image_goes_with_its_alt_text() {
        assert_eq!(
            image_text(&element(
                r#"<img alt="Logo" src="https://track.example.net/p.gif">"#
            )),
            None
        );
        assert_eq!(
            image_text(&element(r#"<img alt="Logo" src="cid:logo@1">"#)),
            None
        );
    }

    #[test]
    fn a_local_image_keeps_its_caption() {
        assert_eq!(
            image_text(&element(r#"<img alt="Logo" src="logo.png">"#)),
            Some(" Logo ".to_string())
        );
        assert_eq!(image_text(&element("<img src='logo.png'>")), None);
    }

    fn element(html: &str) -> Element {
        let document = scraper::Html::parse_document(html);
        let mut stack = vec![document.tree.root()];
        while let Some(node) = stack.pop() {
            match node.value() {
                scraper::node::Node::Element(element) if element.name() == "img" => {
                    return element.clone()
                }
                scraper::node::Node::Element(_) => stack.extend(node.children()),
                scraper::node::Node::Document | scraper::node::Node::Fragment => {
                    stack.extend(node.children())
                }
                _ => {}
            }
        }
        panic!("the source has an image")
    }
}
