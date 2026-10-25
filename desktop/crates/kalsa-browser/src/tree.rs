//! The driver's AI aria tree as our own nodes, and those nodes as the lines a
//! model reads. One responsibility: peel the raw text apart into role, name,
//! props and address, decide which nodes earn a line, and write them out.
//!
//! There is one of these in the repository. The lab depends on this module
//! rather than carrying a copy, so a parser fix lands in the product and in the
//! lab together.
use std::collections::{HashMap, HashSet};
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
    /// The address the link points at, as the page wrote it: it may be relative.
    url: Option<String>,
    /// The frame the node is in: 0 is the page's own document, child frames count from 1.
    frame: usize,
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
    static R: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(?<depth>\s*)-\s+/url:\s*(.*)$").expect("literal"));
    &R
}

// Names are JSON-quoted by the driver; bracket-shaped words inside them
// remain page text rather than element metadata.
fn in_name(text: &str, at: usize) -> bool {
    let mut quoted = false;
    let mut escaped = false;
    for byte in text[..at].bytes() {
        if escaped { escaped = false; }
        else if quoted && byte == b'\\' { escaped = true; }
        else if byte == b'"' { quoted = !quoted; }
    }
    quoted
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
    let text_node = body.trim_start_matches('\'').starts_with("text:");
    let found = reference().captures_iter(&body)
        .find(|c| !text_node && !in_name(&body, c.get(0).expect("capture").start()))
        .map(|c| (c[1].to_string(), c.get(0).expect("capture").range()));
    let reference = found.as_ref().map(|(id, _)| id.clone());
    if let Some((_, range)) = found {
        body.replace_range(range, " ");
    }
    let mut props: Vec<String> = Vec::new();
    let mut kept = String::new();
    let mut last = 0;
    for m in prop().find_iter(&body).filter(|m| !text_node && !in_name(&body, m.start())) {
        kept.push_str(&body[last..m.start()]);
        let value = m.as_str().trim();
        if !matches!(value, "[cursor=pointer]" | "[active]") {
            props.push(value.to_string());
        }
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

    Some(Node { depth, reference, role, name, props: props.join(" "), url: None, frame: 0, children: Vec::new() })
}

/// The address the driver writes under a link: the page's own `href`, so it
/// may be relative.
fn url_of(line: &str) -> Option<(usize, String)> {
    let caps = url_line().captures(line)?;
    let value = caps[2].trim();
    // The driver quotes a value that would otherwise read as something else,
    // and escapes the quote and the backslash inside it.
    let value = match value.strip_prefix('"').and_then(|quoted| quoted.strip_suffix('"')) {
        Some(quoted) => unescape(quoted),
        None => value.to_string(),
    };
    if value.is_empty() {
        return None;
    }
    let depth = caps.name("depth").map(|indent| indent.as_str().len() / 2).unwrap_or_default();
    Some((depth, value))
}

/// Only the quote and the backslash are undone: the other escapes the driver
/// writes are control characters, which no valid address holds.
fn unescape(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut chars = value.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('\\') => out.push('\\'),
            Some('"') => out.push('"'),
            Some(other) => {
                out.push('\\');
                out.push(other);
            }
            None => out.push('\\'),
        }
    }
    out
}

/// The aria tree as nested nodes, so a wrapper can be judged by what it holds
/// rather than by how it is spelled.
pub(crate) fn tree_of(raw: &str) -> Vec<Node> {
    let mut roots: Vec<Node> = Vec::new();
    let mut stack: Vec<Node> = Vec::new();

    for line in raw.split('\n') {
        if let Some((depth, url)) = url_of(line) {
            // The driver writes the address under the link it belongs to.
            if let Some(parent) = stack.last_mut() {
                if depth == parent.depth + 1 {
                    parent.url = Some(url);
                }
            }
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
    let mut frames = 0;
    number_frames(&mut roots, &mut frames, 0);
    roots
}

/// Numbers the frames a tree holds: the page's own document is 0, and each
/// child frame is numbered from 1.
fn number_frames(nodes: &mut [Node], frames: &mut usize, frame: usize) {
    for node in nodes {
        node.frame = frame;
        if node.role == "iframe" {
            *frames += 1;
            let inner = *frames;
            number_frames(&mut node.children, frames, inner);
            continue;
        }
        number_frames(&mut node.children, frames, frame);
    }
}

/// The refs of the page's own document, as the tree numbered them. The frame
/// number says which document a ref is in; the ref's own shape does not.
pub(crate) fn main_refs(nodes: &[Node]) -> HashSet<String> {
    let mut out = HashSet::new();
    collect_main_refs(nodes, &mut out);
    out
}

fn collect_main_refs(nodes: &[Node], out: &mut HashSet<String>) {
    for node in nodes {
        if node.frame == 0 {
            if let Some(reference) = &node.reference {
                out.insert(reference.clone());
            }
        }
        collect_main_refs(&node.children, out);
    }
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

/// The lines of a tree, and the same lines with their addresses left out: one
/// for one, so a find knows which line it matched to print it as it is read.
#[derive(Default)]
pub(crate) struct Lines {
    /// Every line, as the model reads it.
    pub full: Vec<String>,
    /// The same lines without their addresses: what the page shows.
    pub visible: Vec<String>,
}

pub(crate) fn render(nodes: &[Node], depth: usize, out: &mut Lines) {
    for node in nodes {
        let keep = carries(node);
        if keep {
            let pad = "  ".repeat(depth.min(MAX_DEPTH));
            let control = MEANINGFUL.contains(&node.role.as_str()) && !NAMELESS.contains(&node.role.as_str());
            // The address is what the page shows nothing of, so it is printed
            // on one line and left out of the other.
            let (addressed, plain) = if control {
                let mut parts = vec![node.role.clone()];
                if !node.props.is_empty() {
                    parts.push(node.props.clone());
                }
                let plain = parts.join(" ");
                let addressed = match &node.url {
                    Some(url) => format!("{plain} [url={url}]"),
                    None => plain.clone(),
                };
                (addressed, plain)
            } else {
                ("text".to_string(), "text".to_string())
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
            out.full.push(format!("{pad}- {tag}{addressed}{text}"));
            out.visible.push(format!("{pad}- {tag}{plain}{text}"));
        }
        render(&node.children, if keep { depth + 1 } else { depth }, out);
    }
}

/// Whether a printed line carries an address. An address cut in half is an
/// address that is not there, so such a line is never cut.
pub(crate) fn carries_address(line: &str) -> bool {
    line.contains("[url=")
}

/// The addresses of one frame, resolved.
pub(crate) type Addresses = HashMap<String, String>;

/// The links of one frame: the addresses as the page wrote them, and the ref of
/// an element in that frame.
pub(crate) struct Links {
    /// The ref of an element in the frame: the driver finds the frame back by
    /// it, so the frame's addresses are resolved inside it.
    pub reference: Option<String>,
    /// The addresses as the page wrote them, in the order they are printed.
    pub urls: Vec<String>,
}

/// The links of a tree, one entry per frame: the page's own document first, and
/// each child frame after it.
pub(crate) fn links(nodes: &[Node]) -> Vec<Links> {
    let mut frames = vec![Links { reference: None, urls: Vec::new() }];
    collect_links(nodes, &mut frames);
    frames
}

fn collect_links(nodes: &[Node], frames: &mut Vec<Links>) {
    for node in nodes {
        if let Some(url) = &node.url {
            while frames.len() <= node.frame {
                frames.push(Links { reference: None, urls: Vec::new() });
            }
            let frame = &mut frames[node.frame];
            frame.urls.push(url.clone());
            if frame.reference.is_none() {
                frame.reference = node.reference.clone();
            }
        }
        collect_links(&node.children, frames);
    }
}

/// Puts the resolved address on every link. The tree is parsed before anything
/// is resolved, so the addresses are resolved once per frame and not per link.
pub(crate) fn resolve(nodes: &mut [Node], resolved: &[Addresses]) {
    for node in nodes {
        if let Some(url) = node.url.clone() {
            if let Some(address) = resolved.get(node.frame).and_then(|addresses| addresses.get(&url)) {
                node.url = Some(address.clone());
            }
        }
        resolve(&mut node.children, resolved);
    }
}

#[cfg(test)]
mod tests {
    use super::{links, render, resolve, tree_of, Addresses, Lines};

    /// The tree as a model reads it.
    fn text_of(raw: &str) -> String {
        let mut out = Lines::default();
        render(&tree_of(raw), 0, &mut out);
        out.full.join("\n")
    }

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

    /// **The address of a link is printed with the link.** The driver writes it
    /// The address of a link is printed with the link it belongs to.
    #[test]
    fn a_link_keeps_the_address_the_page_gave_it() {
        let raw = r#"- link "Absolute" [ref=e3]:
  - /url: https://example.com/absolute"#;
        assert_eq!(text_of(raw), "- [e3] link [url=https://example.com/absolute] \"Absolute\"");
    }

    /// Each link keeps its own address: one link's address quoted for another
    /// link is a link that is not there.
    #[test]
    fn each_link_keeps_its_own_address() {
        let raw = r#"- link "One" [ref=e3]:
  - /url: https://example.com/one
- link "Two" [ref=e4]:
  - /url: https://example.com/two"#;
        assert_eq!(
            text_of(raw),
            "- [e3] link [url=https://example.com/one] \"One\"\n- [e4] link [url=https://example.com/two] \"Two\""
        );
    }

    /// A link inside a frame is a link of that frame: its address is relative
    /// to the frame's own document, not to the page that holds the frame.
    #[test]
    fn a_link_inside_a_frame_is_a_link_of_its_own_frame() {
        let raw = r#"- link "Here" [ref=e3]:
  - /url: /here
- iframe [ref=e4]:
  - link "There" [ref=f1e2]:
    - /url: there"#;
        let nodes = tree_of(raw);
        let frames = links(&nodes);
        assert_eq!(frames.len(), 2, "the page's document and the frame");
        assert_eq!(frames[0].urls, ["/here"]);
        assert_eq!(frames[0].reference.as_deref(), Some("e3"));
        assert_eq!(frames[1].urls, ["there"]);
        assert_eq!(frames[1].reference.as_deref(), Some("f1e2"));
    }

    /// The resolved address is the one printed, on the link it belongs to.
    #[test]
    fn the_resolved_address_is_the_one_that_is_printed() {
        let raw = r#"- link "Here" [ref=e3]:
  - /url: /here
- iframe [ref=e4]:
  - link "There" [ref=f1e2]:
    - /url: there"#;
        let mut nodes = tree_of(raw);
        let mut resolved = vec![Addresses::new(), Addresses::new()];
        resolved[0].insert("/here".to_owned(), "https://example.com/here".to_owned());
        resolved[1].insert("there".to_owned(), "https://example.com/frame/there".to_owned());
        resolve(&mut nodes, &resolved);
        let mut out = Lines::default();
        render(&nodes, 0, &mut out);
        assert_eq!(
            out.full.join("\n"),
            "- [e3] link [url=https://example.com/here] \"Here\"\n- [f1e2] link [url=https://example.com/frame/there] \"There\""
        );
    }

    /// The driver quotes an address that needs quoting and escapes the quote
    /// and the backslash inside it, so the escapes have to be undone.
    #[test]
    fn a_quoted_address_is_read_as_the_address_the_page_wrote() {
        let raw = r#"- link "Quoted" [ref=e3]:
  - /url: "https://example.test/?a=\"b\"""#;
        assert_eq!(text_of(raw), "- [e3] link [url=https://example.test/?a=\"b\"] \"Quoted\"");
        // A value the driver did not quote keeps the backslashes it has.
        let plain = "- link [ref=e4]:\n  - /url: https://example.test/a\\nb";
        assert_eq!(text_of(plain), "- [e4] link [url=https://example.test/a\\nb]");
    }

    /// A `none` node is nothing to act on and nothing to read, and an address
    /// line is not a line of its own: the address belongs to the link above it.
    #[test]
    fn none_nodes_are_dropped_and_an_address_is_not_a_line_of_its_own() {
        let raw = r#"- navigation [ref=e1]
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

    #[test]
    fn bracket_words_in_names_are_not_driver_metadata() {
        for raw in [
            r#"- button "Read [ref=f2e5]" [ref=e4]"#,
            r#"- button "Read \"quoted\" [ref=f2e5]" [ref=e4]"#,
            r#"- button "Read [ref=f2e5]" [disabled] [ref=e4] [cursor=pointer]"#,
            r#"- 'button "Read: [ref=f2e5]" [ref=e4]'"#,
        ] {
            let line = text_of(raw);
            assert!(line.starts_with("- [e4] button"), "{raw} became {line}");
            assert!(line.contains("[ref=f2e5]"), "the label stays intact: {line}");
        }
        for raw in [r#"- heading "Read [ref=f2e5]""#, "- text: Read [ref=f2e5]", "- 'text: Read [ref=f2e5]'"] {
            let line = text_of(raw);
            assert!(!line.starts_with("- ["), "page text became an element: {line}");
            assert!(line.contains("[ref=f2e5]"), "the text stays intact: {line}");
        }
    }

    #[test]
    fn the_lines_with_their_addresses_and_the_lines_without_them_are_one_for_one() {
        let raw = "- link \"Here\" [ref=e3]:\n  - /url: /here\n- text: plain";
        let mut out = Lines::default();
        render(&tree_of(raw), 0, &mut out);
        assert_eq!(out.full.len(), out.visible.len());
        assert_eq!(out.full[0], "- [e3] link [url=/here] \"Here\"");
        assert_eq!(out.visible[0], "- [e3] link \"Here\"");
        assert_eq!(out.visible[1], out.full[1]);
    }
}
