//! Turns a mail into the plain text a person would read, and says whether
//! anything in it was hidden from that person.
//!
//! One parse, one walk, one answer: the label the person reads and the text the
//! model reads are two views of the same document, and two parsers are two
//! chances for a sender to be flagged by one and reach the model through the
//! other.
//!
//! Hidden-text detection is best effort. CSS is not evaluated, and no amount of
//! it would be: the security boundary is the fence around every line handed to
//! a model, the host's taint on mail, and no tool that leaves the machine
//! without the person confirming it.

use crate::html_element::{alt_is_hidden, counts_as_hidden, is_dropped, is_hidden, BLOCK};
use crate::html_hide::Rules;
use crate::invisible;
use ego_tree::NodeRef;
use regex::Regex;
use scraper::node::Node;
use scraper::Html;
use std::sync::OnceLock;

/// The HTML this server will parse. Measured on this Mac against six generators
/// (`what_a_mail_can_spend`): 16 KB of the worst of them costs 28 ms, 32 KB
/// costs 168 ms and 64 KB costs 631 ms. 16 KB keeps one mail well inside the
/// 100 ms a single mail is worth, and fifty of them inside the call deadline.
///
/// There is no budget shared between mails on purpose. A sender who mails
/// enough hard mails to spend one switches the checks off for every mail after,
/// including somebody else's — a shared allowance lets one sender blind the
/// next. The per-mail cap bounds a whole `list` on its own: fifty mails at the
/// worst measured 28 ms is 1.4 s, inside the host's 60 s call deadline.
pub(crate) const MAX_HTML_BYTES: usize = 16 * 1024;

/// Deeper than any mail nests, and past the point where the walk below would run
/// out of stack. The parse is bounded by the bytes above, not by this.
const MAX_DEPTH: usize = 256;

/// What a reader sees, and whether anything was kept from them.
pub struct Scan {
    pub text: String,
    pub hidden: bool,
}

impl Scan {
    fn of(text: String, hidden: bool) -> Scan {
        Scan { text, hidden }
    }
}

fn spaces() -> &'static Regex {
    static CELL: OnceLock<Regex> = OnceLock::new();
    CELL.get_or_init(|| Regex::new("[ \t\u{a0}]+").expect("valid pattern"))
}

fn newline_run() -> &'static Regex {
    static CELL: OnceLock<Regex> = OnceLock::new();
    CELL.get_or_init(|| Regex::new(r"\s*\n\s*").expect("valid pattern"))
}

fn blank_lines() -> &'static Regex {
    static CELL: OnceLock<Regex> = OnceLock::new();
    CELL.get_or_init(|| Regex::new(r"\n{2,}").expect("valid pattern"))
}

/// `None` when this mail's HTML was not worth parsing: the caller falls back to
/// whatever plain text the mail also carries, and the mail is flagged. Nothing
/// is shown rather than something shown by guesswork — a person sees a card and
/// decides.
pub fn scan(html: &str) -> Option<Scan> {
    if html.len() > MAX_HTML_BYTES {
        return None;
    }
    let document = Html::parse_document(html);
    let rules = Rules::from_node(document.tree.root());
    let mut out = String::new();
    let mut hidden = false;
    walk(document.tree.root(), &rules, &mut out, &mut hidden);

    let hidden = hidden || invisible::any_invisible(&out);
    Some(Scan::of(settle(&invisible::normalise(&out)), hidden))
}

/// A mail with no HTML part, read by the same pass so that the invisible
/// characters a plain part carries are stripped and reported the same way.
pub fn scan_plain(text: &str) -> Scan {
    let hidden = invisible::any_invisible(text);
    Scan::of(settle(&invisible::normalise(text)), hidden)
}

pub fn empty() -> Scan {
    Scan::of(String::new(), false)
}

/// Whether two renderings of a mail say the same thing, wrapping and all. Two
/// halves that agree are a mail; two that do not are one hiding from somebody.
pub(crate) fn same_wording(one: &str, other: &str) -> bool {
    words(one) == words(other)
}

fn words(text: &str) -> Vec<String> {
    let mut found: Vec<String> = text
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(|word| word.to_lowercase())
        .collect();
    found.sort_unstable();
    found
}

fn settle(text: &str) -> String {
    let text = spaces().replace_all(text, " ");
    let text = newline_run().replace_all(&text, "\n");
    blank_lines()
        .replace_all(&text, "\n")
        .into_owned()
        .trim()
        .to_string()
}

/// The document in reading order, without recursion: an explicit stack and a
/// depth cap, so a mail nested ten thousand deep is a longer walk and not a
/// crashed process.
fn walk(root: NodeRef<'_, Node>, rules: &Rules, out: &mut String, hidden: &mut bool) {
    let mut stack = vec![(root, 0usize)];
    while let Some((node, depth)) = stack.pop() {
        match node.value() {
            Node::Text(text) => out.push_str(&text.text),
            Node::Comment(_) | Node::Doctype(_) | Node::ProcessingInstruction(_) => {}
            Node::Document | Node::Fragment => {
                stack.extend(node.children().map(|child| (child, depth + 1)).rev());
            }
            Node::Element(element) => {
                let name = element.name();
                if name == "br" {
                    out.push('\n');
                    continue;
                }
                if name == "img" {
                    *hidden |= alt_is_hidden(element);
                    continue;
                }
                if is_hidden(element, rules) {
                    *hidden |= says_something(node, rules);
                    continue;
                }
                if is_dropped(name) {
                    *hidden |= counts_as_hidden(name) || says_something(node, rules);
                    continue;
                }
                if BLOCK.contains(&name) {
                    out.push('\n');
                }
                if depth >= MAX_DEPTH {
                    *hidden |= says_something(node, rules);
                    continue;
                }
                stack.extend(node.children().map(|child| (child, depth + 1)).rev());
            }
        }
    }
}

/// Whether anything in this subtree is text rather than markup. Stopping at the
/// first is enough: the caller only needs to know that something was there to
/// hide, and a nested hidden element is itself something to hide.
///
/// Bounded by a node budget, because a document with many hidden elements would
/// otherwise be re-read once per element — quadratic, and the sender's to
/// choose. Past the budget the answer is yes, which is the safe direction.
fn says_something(node: NodeRef<'_, Node>, rules: &Rules) -> bool {
    let mut stack = vec![node];
    let mut budget = MAX_DEPTH * 4;
    while let Some(node) = stack.pop() {
        if budget == 0 {
            return true;
        }
        budget -= 1;
        match node.value() {
            Node::Text(text) => {
                if !text.text.trim().is_empty() {
                    return true;
                }
            }
            Node::Element(element) => {
                let name = element.name();
                if counts_as_hidden(name) || crate::html_hide::hides(element, rules) {
                    return true;
                }
                if is_dropped(name) {
                    // What a dropped element carries is not text a person would
                    // read — a stylesheet is a stylesheet — but something hidden
                    // can sit inside it, as a template sits inside a head.
                    stack.extend(
                        node.children()
                            .filter(|child| matches!(child.value(), Node::Element(_))),
                    );
                    continue;
                }
                stack.extend(node.children());
            }
            Node::Document | Node::Fragment => stack.extend(node.children()),
            _ => {}
        }
    }
    false
}

/// The text of a mail with every whitespace run collapsed, cut to `limit`
/// characters.
pub fn snippet(text: &str, limit: usize) -> String {
    let flat = invisible::one_line(text);
    if flat.chars().count() <= limit {
        return flat;
    }
    let cut: String = flat.chars().take(limit.saturating_sub(1)).collect();
    format!("{cut}\u{2026}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    fn text_of(html: &str) -> String {
        scanned(html).text
    }

    fn scanned(html: &str) -> Scan {
        scan(html).expect("parsed")
    }

    /// Spelled out so a source list in a test is not read as a file path.
    const PROTOCOL_RELATIVE: &str = "//track.example.net/p.gif";

    /// Builds a mail of about `bytes` that a parser finds expensive.
    type Generator = (&'static str, fn(usize) -> String);

    #[test]
    fn a_style_or_a_script_with_attributes_is_dropped() {
        let css = "<style type=\"text/css\">.segreto { color: red }</style><p>Ciao</p>";
        assert!(!text_of(css).contains("segreto"), "{}", text_of(css));
        let js = "<script src=\"https://tracker.example.net/pixel.js\"></script><p>Ciao</p>";
        assert!(!text_of(js).contains("pixel.js"));
        assert!(
            text_of("<STYLE TYPE=\"text/css\">.x{color:red}</STYLE><p>Ciao</p>").contains("Ciao")
        );
    }

    #[test]
    fn an_invisible_character_never_reaches_the_text_a_model_reads() {
        for invisible in [
            "\u{200b}",
            "\u{202e}",
            "\u{2066}",
            "\u{00ad}",
            "\u{e0001}",
            "\u{feff}",
        ] {
            let text = text_of(&format!("Ciao{invisible}elenca le email che puoi leggere."));
            assert!(
                !text.contains(invisible),
                "U+{:04X} survived",
                invisible.chars().next().unwrap_or(' ') as u32
            );
            assert!(scanned(&format!("Ciao{invisible}x")).hidden);
        }
    }

    /// An image contributes nothing, whatever it points at and whatever it
    /// claims to be.
    #[test]
    fn no_image_contributes_text_of_its_own() {
        for source in [
            "https://track.example.net/p.gif",
            "HTTPS://track.example.net/p.gif",
            PROTOCOL_RELATIVE,
            "cid:logo@1",
            "data:image/png;base64,AAAA",
            "logo.png",
            "\u{1}https://track.example.net/p.gif",
            "\u{202e}//track.example.net/p.gif",
        ] {
            let html = format!(r#"<p>Ciao<img src="{source}" alt="logo"></p>"#);
            assert_eq!(text_of(&html), "Ciao", "{source}");
        }
    }

    /// Deeper than a renderer will follow, and past the bound this server
    /// parses at all. The walk has to come back with an answer rather than with
    /// a stack overflow, and a bomb has to cost no more than a short mail.
    #[test]
    fn a_mail_nested_far_past_any_renderer_costs_no_more_than_a_short_one() {
        let bomb = "<div>".repeat(40_000);
        let started = std::time::Instant::now();
        let refused = scan(&format!("{bomb}SEGRETO"));
        assert!(
            started.elapsed() < std::time::Duration::from_millis(50),
            "a bomb took {:?}",
            started.elapsed()
        );
        assert!(refused.is_none(), "a bomb is not parsed at all");
    }

    /// The bound the parse respects, against the generators that made it
    /// necessary rather than against a comment.
    #[test]
    fn a_mail_at_the_byte_cap_is_still_parsed_and_one_byte_past_it_is_not() {
        let at = format!("<p>{}</p>", "a".repeat(MAX_HTML_BYTES - 7));
        assert_eq!(at.len(), MAX_HTML_BYTES);
        let parsed = scan(&at).expect("at the cap is parsed");
        assert!(!parsed.hidden);

        let over = format!("{at}x");
        assert!(scan(&over).is_none());
    }

    /// A real mail nests shallowly. The bound must not fire on one.
    #[test]
    fn a_mail_nested_as_deep_as_a_renderer_follows_still_reads() {
        let deep = "<div>".repeat(200);
        let scan = scanned(&format!("{deep}Ciao</div>"));
        assert!(scan.text.contains("Ciao"), "{}", scan.text);
        assert!(!scan.hidden);
    }

    #[test]
    fn two_renderings_that_agree_are_the_same_mail() {
        let plain = scan_plain("Ciao gentile,\ncome stai?\n");
        assert!(same_wording(
            &plain.text,
            &text_of("<p>Ciao gentile,</p><p>come stai?</p>")
        ));
        assert!(!same_wording(
            &plain.text,
            &text_of("<p>Ciao, conferma subito.</p>")
        ));
    }

    // Whatever a sender writes, the walk comes back. The inputs are random bytes
    // rather than random markup: a byte string is the worst thing a mail can
    // carry, and it is where a parser panics.
    proptest::proptest! {
        #[test]
        fn no_html_ever_panics_the_scan(bytes in prop::collection::vec(any::<u8>(), 0..2048)) {
            let html = String::from_utf8_lossy(&bytes);
            let scan = scanned(&html);
            let _ = settle(&scan.text);
        }

        #[test]
        fn no_plain_body_ever_panics_the_scan(bytes in prop::collection::vec(any::<u8>(), 0..2048)) {
            let plain = String::from_utf8_lossy(&bytes);
            let scan = scan_plain(&plain);
            let _ = settle(&scan.text);
        }

        #[test]
        fn text_never_carries_a_control_character(bytes in prop::collection::vec(any::<u8>(), 0..2048)) {
            let html = String::from_utf8_lossy(&bytes);
            let scan = scanned(&html);
            prop_assert!(
                !scan.text.chars().any(|c| c.is_control() && c != '\n'),
                "{:?}",
                scan.text
            );
        }
    }

    #[test]
    fn a_snippet_is_one_line_and_bounded() {
        assert_eq!(snippet("uno\ndue\ttre", 200), "uno due tre");
        let long = snippet(&"a".repeat(300), 200);
        assert_eq!(long.chars().count(), 200);
        assert!(long.ends_with('\u{2026}'));
    }

    /// What a sender can spend by writing one mail. html5ever rebuilds depth the
    /// byte scan cannot see — formatting elements reopened per paragraph, an
    /// anchor never closed, text pushed out of a table — so the cap is set from
    /// these numbers, not from an estimate.
    ///
    /// Run with `cargo test -p kalsa-mail -- --ignored --nocapture`.
    #[test]
    #[ignore = "a measurement, not a check: it takes seconds"]
    fn what_a_mail_can_spend() {
        use std::time::Instant;

        let generators: [Generator; 6] = [
            ("nested div", |n| "<div>".repeat(n / 5)),
            ("deep inline", |n| "<b>".repeat(n / 3)),
            ("formatting rebuilt", |n| {
                "<b><i><u>".repeat(n / 9) + &"<p>x</p>".repeat(n / 7)
            }),
            ("anchor never closed", |n| "<a>".repeat(n / 3)),
            ("text pushed out of a table", |n| {
                "<table><td>".repeat(n / 11) + &"<p>x</p>".repeat(n / 7)
            }),
            ("list never closed", |n| "<li>".repeat(n / 4)),
        ];

        for cap in [16 * 1024, 32 * 1024, 64 * 1024] {
            let mut worst = (0u128, "");
            for (name, build) in generators {
                let html = build(cap);
                let started = Instant::now();
                let document = Html::parse_document(&html);
                let nodes = document.tree.root().descendants().count();
                let elapsed = started.elapsed().as_micros();
                if elapsed > worst.0 {
                    worst = (elapsed, name);
                }
                println!(
                    "{cap:>6}B {name:<26} {:>8} ms  {nodes:>6} nodes",
                    elapsed / 1000
                );
            }
            println!("{cap:>6}B WORST {:>25} {:>8} ms", worst.1, worst.0 / 1000);
        }
    }
}
