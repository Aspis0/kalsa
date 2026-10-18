//! The driver's AI aria tree as our own nodes, and those nodes as the lines a
//! model reads. One responsibility: peel the raw text apart into role, name and
//! props, decide which nodes earn a line, and write them out.
//!
//! There is one of these in the repository. The lab depends on this module
//! rather than carrying a copy, so a parser fix lands in the product and in the
//! lab together.
use std::sync::LazyLock;

use regex::Regex;

/// Roles a model can act on, or read a name from. Everything else is a box.
const MEANINGFUL: &[&str] = &[
    "alert", "button", "checkbox", "cell", "combobox", "columnheader", "definition",
    "dialog", "gridcell", "heading", "img", "link", "listbox", "menuitem", "option",
    "paragraph", "radio", "row", "searchbox", "slider", "status", "strong", "tab",
    "term", "textbox", "textarea",
];

/// A heading or paragraph with no text of its own says nothing; the link it
/// wraps already carries the name.
const NAMELESS: &[&str] = &["paragraph", "heading"];

const MAX_DEPTH: usize = 8;

pub(crate) struct Node {
    depth: usize,
    reference: Option<String>,
    role: String,
    name: String,
    props: String,
    children: Vec<Node>,
}

fn lead() -> &'static Regex {
    static R: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(\s*)- (.*)$").expect("literal"));
    &R
}
fn reference() -> &'static Regex {
    static R: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\[ref=([a-z0-9]+)\]").expect("literal"));
    &R
}
fn prop() -> &'static Regex {
    static R: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s*\[([a-z]+(?:=[^\]]*)?)\]").expect("literal"));
    &R
}
fn shape() -> &'static Regex {
    static R: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r#"^([a-z]+)(?:\s+"([\s\S]*)")?(?:\s*:\s*([\s\S]*?))?\s*$"#).expect("literal"));
    &R
}
fn url_line() -> &'static Regex {
    static R: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\s*-\s+/url:").expect("literal"));
    &R
}

/// One `- role "name" [ref=e3]` line into depth, ref, role, name and props.
/// The raw tree spells a name three ways and wraps a node in single quotes when
/// its text carries double quotes, so all of it is peeled apart here. Property
/// groups come in both spellings — `[level=1]` carries a value, `[expanded]` and
/// `[selected]` do not — and the driver began emitting the bare ones, so a
/// parser that only understood `key=value` turned each of those elements into
/// one long piece of text instead of a control.
fn parse_node(line: &str) -> Option<Node> {
    let caps = lead().captures(line)?;
    let depth = caps[1].len() / 2;
    let mut body = caps[2].to_string();
    for noise in [" [cursor=pointer]", " [active]"] {
        body = body.replace(noise, "");
    }

    let reference = reference().captures(&body).map(|c| c[1].to_string());
    if let Some(r) = &reference {
        body = body.replace(&format!("[ref={r}]"), " ");
    }
    let mut props: Vec<String> = Vec::new();
    let mut kept = String::new();
    let mut last = 0;
    for m in prop().find_iter(&body) {
        kept.push_str(&body[last..m.start()]);
        props.push(m.as_str().trim().to_string());
        last = m.end();
    }
    kept.push_str(&body[last..]);
    let mut rest = kept.trim().to_string();

    if rest.len() >= 2 && rest.starts_with('\'') && rest.ends_with('\'') {
        rest = rest[1..rest.len() - 1].to_string();
    }

    let (role, name) = match shape().captures(&rest) {
        Some(c) => {
            let role = c[1].to_string();
            let name = c.get(2).or_else(|| c.get(3)).map(|m| m.as_str().trim().to_string());
            (role, name.unwrap_or_default())
        }
        None => (
            "text".to_string(),
            rest.strip_prefix("text:").unwrap_or(&rest).trim().to_string(),
        ),
    };

    Some(Node { depth, reference, role, name, props: props.join(" "), children: Vec::new() })
}

/// The aria tree as nested nodes, so a wrapper can be judged by what it holds
/// rather than by how it is spelled. `/url:` lines repeat the header and go.
pub(crate) fn tree_of(raw: &str) -> Vec<Node> {
    let mut roots: Vec<Node> = Vec::new();
    let mut stack: Vec<Node> = Vec::new();

    for line in raw.split('\n') {
        if url_line().is_match(line) {
            continue;
        }
        let mut node = match parse_node(line) {
            Some(n) if n.role != "none" => n,
            _ => continue,
        };
        while stack.last().is_some_and(|n| n.depth >= node.depth) {
            let done = stack.pop().expect("checked by is_some");
            match stack.last_mut() {
                Some(parent) => parent.children.push(done),
                None => roots.push(done),
            }
        }
        node.children = Vec::new();
        stack.push(node);
    }
    while let Some(done) = stack.pop() {
        match stack.last_mut() {
            Some(parent) => parent.children.push(done),
            None => roots.push(done),
        }
    }
    roots
}

/// Two letters or figures of real content. Glyphs like × and / are noise.
fn says(node: &Node) -> bool {
    node.name.chars().filter(|c| c.is_alphanumeric()).take(2).count() == 2
}

/// A node earns a line when it is something to act on, or when it carries
/// content: a checkbox with no name is only knowable from the text beside it,
/// so dropping the wrapper must not drop the label with it.
fn carries(node: &Node) -> bool {
    let control = MEANINGFUL.contains(&node.role.as_str()) && !NAMELESS.contains(&node.role.as_str());
    if control {
        return !NAMELESS.contains(&node.role.as_str()) || !node.name.is_empty();
    }
    says(node)
}

pub(crate) fn render(nodes: &[Node], depth: usize, out: &mut Vec<String>) {
    for node in nodes {
        let keep = carries(node);
        if keep {
            let pad = "  ".repeat(depth.min(MAX_DEPTH));
            let control = MEANINGFUL.contains(&node.role.as_str()) && !NAMELESS.contains(&node.role.as_str());
            let label = if control && !node.props.is_empty() {
                format!("{} {}", node.role, node.props)
            } else if control {
                node.role.clone()
            } else {
                "text".to_string()
            };
            // A node with no ref cannot be acted on, so it is not given a fake one.
            let tag = match &node.reference {
                Some(r) => format!("[{r}] "),
                None => String::new(),
            };
            // A name already arriving quoted is not quoted twice.
            let quoted = if node.name.is_empty() {
                String::new()
            } else if node.name.len() >= 2 && node.name.starts_with('"') && node.name.ends_with('"') {
                node.name.clone()
            } else {
                format!("\"{}\"", node.name)
            };
            let text = if quoted.is_empty() { String::new() } else { format!(" {quoted}") };
            out.push(format!("{pad}- {tag}{label}{text}"));
        }
        render(&node.children, if keep { depth + 1 } else { depth }, out);
    }
}

/// The tree as the string a model reads.
pub(crate) fn text_of(raw: &str) -> String {
    let mut out = Vec::new();
    render(&tree_of(raw), 0, &mut out);
    out.join("\n")
}

#[cfg(test)]
mod tests {
    use super::text_of;

    /// The driver emits `[expanded]` and `[selected]` with no value. A parser
    /// that only understood `key=value` left those glued to the role, so the
    /// model saw one long piece of text where there is a control, and a name it
    /// could not match to anything.
    #[test]
    fn a_property_with_no_value_is_read_as_a_property_and_not_as_the_name() {
        let raw = r#"- combobox [expanded] [ref=e4]
  - text: Italy
  - option [selected] [ref=e5]: Rome"#;
        assert_eq!(
            text_of(raw),
            "- [e4] combobox [expanded]\n  - text \"Italy\"\n  - [e5] option [selected] \"Rome\""
        );
    }

    #[test]
    fn a_property_with_a_value_keeps_the_value() {
        let raw = r#"- heading [level=2] [ref=e2]: Chapter one"#;
        assert_eq!(text_of(raw), "- [e2] text \"Chapter one\"");
    }

    /// The raw tree wraps a node in single quotes when its text carries double
    /// quotes. The quotes are part of the text the page shows, so they are kept
    /// rather than unwrapped and read as ours.
    #[test]
    fn a_single_quoted_node_keeps_the_quotes_the_driver_wrapped_it_in() {
        let raw = "- button [ref=e7]: 'Say \"hello\" now'";
        assert_eq!(text_of(raw), "- [e7] button \"'Say \"hello\" now'\"");
    }

    #[test]
    fn a_name_already_quoted_is_not_quoted_again() {
        let raw = r#"- link [ref=e3]: "Home""#;
        assert_eq!(text_of(raw), "- [e3] link \"Home\"");
    }

    /// A wrapper that is only a box must not cost a level, or a real page's
    /// controls all end up past the depth cap at the same indentation.
    #[test]
    fn a_wrapper_that_carries_nothing_loses_its_indent_but_its_children_keep_theirs() {
        let raw = r#"- generic [ref=e1]
  - link [ref=e2]: Home
  - text: trailing"#;
        assert_eq!(text_of(raw), "- [e2] link \"Home\"\n- text \"trailing\"");
    }

    #[test]
    fn url_lines_and_none_nodes_are_dropped() {
        let raw = r#"- /url: https://example.com/one
- navigation [ref=e1]
  - none [ref=e2]
    - link [ref=e3]: Home"#;
        assert_eq!(text_of(raw), "- [e3] link \"Home\"");
    }

    /// Glyphs are not words: a box whose whole content is "/" tells a model
    /// nothing and costs a line. A control is kept whatever it is named, because
    /// a checkbox with no name is still something to act on.
    #[test]
    fn a_name_with_no_letters_or_figures_is_not_a_line_unless_it_is_a_control() {
        let raw = r#"- generic [ref=e1]: /
- generic [ref=e2]: ×
- generic [ref=e3]: ok"#;
        assert_eq!(text_of(raw), "- [e3] text \"ok\"");
        assert_eq!(text_of("- link [ref=e9]: /"), "- [e9] link \"/\"");
    }

    #[test]
    fn an_empty_tree_is_an_empty_string() {
        assert_eq!(text_of(""), "");
    }
}
