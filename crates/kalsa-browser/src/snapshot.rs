//! The page as the model reads it (one responsibility: ask the driver for its AI
//! aria tree, split it into parts, and find text in it).
//!
//! Parts and find live here rather than in the chat because both answer
//! questions about a page far longer than one message: slicing it on the near
//! side of the pipe would mean shipping all of it every time.

use std::collections::HashSet;

use playwright_rs::protocol::{AriaSnapshotMode, AriaSnapshotOptions, Page};

use crate::tree;

pub(crate) const SNAPSHOT_CHARS: usize = 6000;

/// A page as the model reads it, and the refs of the page's own document. The
/// tree the text was made of says which document a ref is in; its shape does not.
pub(crate) struct Read {
    /// The page as the model reads it.
    pub(crate) text: String,
    /// The refs of the page's own document, from that same tree.
    pub(crate) main: HashSet<String>,
}

/// The driver's tree as we read it: the head, the lines, the same lines
/// without their addresses, and the page's own document's refs.
struct Rendered {
    /// Where we are and what the page is called.
    head: String,
    /// Every line of the tree, as the model reads it.
    full: Vec<String>,
    /// The same lines with their addresses left out: what the page shows.
    visible: Vec<String>,
    /// The refs of the page's own document, from the same tree.
    main: HashSet<String>,
}

/// How much of a page's tree one read may hold. The budget is finite, and a
/// tree that does not fit is always said out.
const TREE_CHARS: usize = 1_000_000;

/// The head of `text` holding at most `chars` characters, cut on a character
/// boundary: `chars` is a count of characters and a byte index is not one.
fn head_of(text: &str, chars: usize) -> &str {
    match text.char_indices().nth(chars) {
        Some((index, _)) => &text[..index],
        None => text,
    }
}

/// The largest byte index at or below `at` that a string may be cut at.
fn boundary_at_or_below(text: &str, at: usize) -> usize {
    let mut index = at.min(text.len());
    while !text.is_char_boundary(index) {
        index -= 1;
    }
    index
}

/// The body within the budget, and whether it had to be cut. The fact is
/// returned, not written into the text: the parser drops a line it cannot read.
fn capped(body: &str) -> (String, bool) {
    if body.chars().count() <= TREE_CHARS {
        return (body.to_string(), false);
    }
    let head = head_of(body, TREE_CHARS);
    let at_line = boundary_at_or_below(head, head.rfind('\n').unwrap_or(head.len()));
    (head[..at_line].to_string(), true)
}

// Cap before parsing so an oversized page cannot expand into an unbounded
// collection of nodes.
async fn raw_snapshot(page: &Page) -> Result<(String, bool), playwright_rs::Error> {
    let options = AriaSnapshotOptions::default().mode(AriaSnapshotMode::Ai);
    let raw = page.aria_snapshot(Some(options)).await?;
    Ok(capped(&raw))
}

/// **The tree of the page, taken once, with nothing waited for.**
///
/// This is the call a read makes and nothing else, and it is what the probe at
/// the start of a session asks for: a driver that cannot take the tree yet is
/// a driver that is not ready, and a session is not ready until the driver has
/// answered something. The page the probe asks about is the one the browser has
/// just opened, which holds nothing, so the call costs almost nothing.
pub(crate) async fn probe(page: &Page) -> Result<(), playwright_rs::Error> {
    raw_snapshot(page).await.map(|_| ())
}

/// **Said in the header of every part when the tree did not fit.** A cut that is
/// mentioned only at the end is a cut the model has already read past.
const PARTIAL_NOTE: &str = "note: partial snapshot — some content omitted";

// The formatter owns the header/body separator even if a caller supplies
// title text with line breaks.
fn one_line(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn header(url: &str, title: &str, cut: bool) -> String {
    let mut header = format!("url: {url}\ntitle: {}", one_line(title));
    if cut {
        header.push('\n');
        header.push_str(PARTIAL_NOTE);
    }
    header
}

/// Keep full and searchable lines aligned when the rendered budget cuts the tree.
fn within_budget(mut out: tree::Lines) -> (tree::Lines, bool) {
    let mut chars = 0;
    let mut kept = 0;
    for line in &out.full {
        let size = line.chars().count() + 1;
        if chars + size > TREE_CHARS {
            break;
        }
        chars += size;
        kept += 1;
    }
    let cut = kept < out.full.len();
    out.full.truncate(kept);
    out.visible.truncate(kept);
    (out, cut)
}

/// Where we are, then one line per element.
async fn page_text(page: &Page) -> Result<Rendered, playwright_rs::Error> {
    let (raw, raw_cut) = raw_snapshot(page).await?;
    let mut nodes = tree::tree_of(&raw);
    let main = tree::main_refs(&nodes);
    let resolved = resolve_addresses(page, &tree::links(&nodes)).await;
    tree::resolve(&mut nodes, &resolved);
    let mut out = tree::Lines::default();
    tree::render(&nodes, 0, &mut out);
    let (out, body_cut) = within_budget(out);
    let url = page.url();
    let title = page.title().await.unwrap_or_default();
    Ok(Rendered {
        head: header(&url, &title, raw_cut || body_cut),
        full: out.full,
        visible: out.visible,
        main,
    })
}

/// The addresses of the links in the tree, resolved by the browser: one call
/// per frame, because only the browser knows which document an address is in.
async fn resolve_addresses(page: &Page, frames: &[tree::Links]) -> Vec<tree::Addresses> {
    let mut resolved = Vec::with_capacity(frames.len());
    for frame in frames {
        let mut addresses = tree::Addresses::new();
        let relative: Vec<String> =
            frame.urls.iter().filter(|url| !is_whole(url)).cloned().collect();
        if let Some(reference) = &frame.reference {
            if !relative.is_empty() {
                let locator = page.locator(format!("aria-ref={reference}"));
                // An address the browser cannot resolve is left as the page wrote it.
                let answered = locator
                    .evaluate::<Vec<String>, Vec<String>>(
                        "(element, urls) => urls.map((url) => { try { \
                         return new URL(url, element.ownerDocument.baseURI).href; \
                         } catch (error) { return url; } })",
                        Some(relative.clone()),
                    )
                    .await;
                if let Ok(answered) = answered {
                    for (url, address) in relative.into_iter().zip(answered) {
                        addresses.insert(url, address);
                    }
                }
            }
        }
        resolved.push(addresses);
    }
    resolved
}

/// Whether an address names its own scheme, and so is already whole.
fn is_whole(url: &str) -> bool {
    url.split_once(':').is_some_and(|(scheme, _)| {
        !scheme.is_empty() && scheme.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'))
    })
}

/// **Whether a page holds anything a model could work with.** The tree's own
/// lines, or the text the document shows: a title alone is a page that says
/// nothing, and a page that answers a stranger has that for a moment.
pub async fn has_content(page: &Page, text: &str) -> bool {
    if !body_of(text).trim().is_empty() {
        return true;
    }
    shows_text(page).await
}

/// The part of a read that is the page's own content: everything under the address.
fn body_of(text: &str) -> &str {
    text.split_once("\n\n").map(|(_, body)| body).unwrap_or(text)
}

/// Whether the document shows any text at all, asked of the document itself.
async fn shows_text(page: &Page) -> bool {
    page.evaluate::<(), bool>("!!(document.body && document.body.innerText.trim())", None).await.unwrap_or(false)
}

/// **The page as the model reads it, waiting for a page that has nothing on it
/// yet.** A site that answers a stranger with a challenge serves the page a
/// moment later, and the model should get the page rather than the challenge.
pub async fn read_when_ready(page: &Page, part: usize) -> Result<String, playwright_rs::Error> {
    Ok(read_when_ready_with_main(page, part).await?.text)
}

/// The same read, with the page's own document's refs beside it.
pub(crate) async fn read_when_ready_with_main(page: &Page, part: usize) -> Result<Read, playwright_rs::Error> {
    let deadline = std::time::Instant::now() + CONTENT_WAIT;
    loop {
        let read = snapshot_with_main(page, part).await?;
        if has_content(page, &read.text).await {
            return Ok(read);
        }
        if std::time::Instant::now() >= deadline {
            return Ok(read);
        }
        tokio::time::sleep(CONTENT_POLL).await;
    }
}

/// **How long a read waits for a page that has nothing on it yet.**
const CONTENT_WAIT: std::time::Duration = std::time::Duration::from_secs(8);

/// How often a read looks again while it waits.
const CONTENT_POLL: std::time::Duration = std::time::Duration::from_millis(200);

/// **Said when a page has nothing on it at the end of the wait.** The page is
/// named as it is: loaded and empty, or not loaded yet. No ref is invented.
pub fn nothing_to_read(text: &str, loaded: bool) -> String {
    let why = if loaded {
        "it is loaded and has nothing on it"
    } else {
        "it has not finished loading"
    };
    format!("{text}\n\nThere is nothing to read: {why}.")
}

/// Address lines stay whole so a part never invents a truncated destination.
/// Other cuts retain character boundaries, including in accented text.
fn parts(body: &str, chars: usize) -> Vec<&str> {
    let wanted = chars.max(1);
    let mut out = Vec::new();
    let mut rest = body;
    while rest.chars().count() > wanted {
        let cut = boundary_at_or_below(rest, head_of(rest, wanted).len());
        let at = rest[..cut].rfind('\n').filter(|at| *at > 0);
        match at {
            Some(at) => {
                out.push(&rest[..at]);
                rest = &rest[at + 1..];
            }
            None => {
                let end = rest.find('\n').unwrap_or(rest.len());
                if tree::carries_address(&rest[..end]) {
                    out.push(&rest[..end]);
                    rest = rest[end..].strip_prefix('\n').unwrap_or("");
                    if rest.is_empty() {
                        return out;
                    }
                } else {
                    out.push(&rest[..cut]);
                    rest = &rest[cut..];
                }
            }
        }
    }
    out.push(rest);
    out
}

/// A long page comes in parts rather than being cut: the model asks for part 2
/// and nothing on the page is lost. Each part names the next.
pub async fn snapshot(page: &Page, part: usize) -> Result<String, playwright_rs::Error> {
    Ok(snapshot_with_main(page, part).await?.text)
}

/// The same read in parts, with the page's own document's refs beside it.
pub(crate) async fn snapshot_with_main(page: &Page, part: usize) -> Result<Read, playwright_rs::Error> {
    let rendered = page_text(page).await?;
    let text = format!("{}\n\n{}", rendered.head, rendered.full.join("\n"));
    let shown = {
        let (head, body) = text.split_once("\n\n").unwrap_or(("", text.as_str()));
        let room = SNAPSHOT_CHARS.saturating_sub(head.len() + 2).max(200);
        let chunks = parts(body, room);
        if chunks.len() == 1 {
            None
        } else {
            let at = part.clamp(1, chunks.len());
            let footer = if at < chunks.len() {
                format!("Part {at} of {} — call browser_read with page {} for more.", chunks.len(), at + 1)
            } else {
                format!("Part {at} of {} — this is the last part.", chunks.len())
            };
            Some(format!("{head}\n\n{}\n\n{footer}", chunks[at - 1]))
        }
    };
    Ok(Read { text: shown.unwrap_or(text), main: rendered.main })
}

/// The lines that mention some text, with a little around them and their refs
/// intact — the find-in-page a model reaches for when a page is too long.
///
/// **The lines are the page's own lines**: a ref a find prints is a ref a call
/// may act on, as a ref a read prints is.
pub async fn find(page: &Page, needle: &str, around: usize, limit: usize) -> Result<String, playwright_rs::Error> {
    Ok(find_with_main(page, needle, around, limit).await?.text)
}
/// The same find, with the page's own document's refs beside it.
pub(crate) async fn find_with_main(
    page: &Page,
    needle: &str,
    around: usize,
    limit: usize,
) -> Result<Read, playwright_rs::Error> {
    let rendered = page_text(page).await?;
    let wanted = needle.trim().to_lowercase();
    if wanted.is_empty() {
        return Ok(Read { text: format!("{}\n\nnothing to look for — pass some text", rendered.head), main: rendered.main });
    }
    // URL parameters must not crowd visible matches out of the answer.
    let mut hits = matching(&rendered.visible, &wanted);
    if hits.is_empty() {
        // Address-only searches still need the printed destination.
        hits = matching(&rendered.full, &wanted);
    }
    if hits.is_empty() {
        return Ok(Read {
            text: format!("{}\n\nnothing on this page matches that text", rendered.head),
            main: rendered.main,
        });
    }
    let mut out: Vec<String> = Vec::new();
    let mut shown = 0;
    for at in &hits {
        // A match is printed whole or not at all: half a block is a matching
        // line the answer does not carry.
        let from = at.saturating_sub(around);
        let block = (at + around + 1).min(rendered.full.len()) - from + 1;
        if out.len() + block > limit {
            break;
        }
        for line in &rendered.full[from..(at + around + 1).min(rendered.full.len())] {
            out.push(line.clone());
        }
        out.push(String::new());
        shown += 1;
    }
    let kept = out.join("\n").trim_end().to_string();
    let more = if hits.len() > shown {
        format!("\n… more matches not shown ({limit} line cap)")
    } else {
        String::new()
    };
    Ok(Read { text: format!("{}\n\n{kept}{more}", rendered.head), main: rendered.main })
}

/// The lines that mention some text, in the order the page has them.
fn matching(lines: &[String], needle: &str) -> Vec<usize> {
    lines
        .iter()
        .enumerate()
        .filter(|(_, line)| line.to_lowercase().contains(needle))
        .map(|(at, _)| at)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{boundary_at_or_below, capped, header, parts, within_budget, PARTIAL_NOTE, TREE_CHARS};
    use crate::tree;

    /// A ref cut in half is worse than a long part: the model reads `textbo` as
    /// a control it cannot act on, or presses nothing at all.
    #[test]
    fn a_part_never_ends_in_the_middle_of_a_line() {
        let body = (1..=40).map(|n| format!("- [e{n}] link \"line {n}\"\n")).collect::<String>();
        for part in parts(&body, 120) {
            let lines: Vec<&str> = part.split('\n').collect();
            for line in lines.iter().take(lines.len().saturating_sub(1)) {
                assert!(!line.is_empty(), "a part holds whole lines only");
                assert!(!line.starts_with('-') || line.contains('"'), "{line}");
            }
        }
    }

    #[test]
    fn every_line_survives_the_split() {
        let body = (1..=200).map(|n| format!("line {n}")).collect::<Vec<String>>().join("\n");
        let chunks = parts(&body, 50);
        let rejoined = chunks.join("\n");
        assert_eq!(rejoined, body);
        assert!(chunks.len() > 1, "200 lines do not fit in 50 characters");
    }

    #[test]
    fn a_body_that_fits_is_one_part_and_a_body_with_no_newline_is_cut_hard() {
        assert_eq!(parts("short", 100), ["short"]);
        let long = "x".repeat(250);
        let cut = parts(&long, 100);
        assert_eq!(cut.len(), 3);
        assert_eq!(cut.iter().map(|c| c.len()).sum::<usize>(), 250);
    }

    #[test]
    fn a_limit_of_zero_does_not_loop_forever() {
        assert_eq!(parts("abc", 0).len(), 3);
        assert_eq!(parts("", 0), [""]);
    }

    /// Every character in these is four bytes and every boundary is four apart,
    /// so cutting at byte 120 would land in the middle of one and panic.
    #[test]
    fn a_part_of_accented_text_is_split_rather_than_fatal() {
        let body = "caffè al limone\n".repeat(200);
        let chunks = parts(&body, 120);
        assert!(chunks.len() > 1);
        // The newline is the cut, so putting it back is what makes the whole.
        assert_eq!(chunks.join("\n"), body, "nothing is lost and nothing is cut");
        for chunk in &chunks {
            assert!(chunk.chars().count() <= 120, "a part is within the budget: {chunk:?}");
        }
    }

    #[test]
    fn a_cut_is_always_on_a_character_boundary() {
        for cut in 0..40 {
            let body = "caffè".repeat(10);
            let at = boundary_at_or_below(&body, cut);
            assert!(body.is_char_boundary(at), "cut {at} is inside a character");
        }
    }

    /// A part that cuts a link line in half prints an address that is not
    /// there, so a line with an address is kept whole even over the budget.
    #[test]
    fn a_link_line_over_the_budget_is_kept_whole() {
        let href = format!("https://example.test/{}", "a".repeat(300));
        let raw = format!("- link \"Long\" [ref=e1]:\n  - /url: {href}\n- link \"Ordinary\" [ref=e2]");
        let nodes = tree::tree_of(&raw);
        let mut out = tree::Lines::default();
        tree::render(&nodes, 0, &mut out);
        let body = out.full.join("\n");
        let chunks = parts(&body, 120);
        let all = chunks.join("\n");
        assert!(all.contains(&href), "the address is whole: {all}");
        assert!(all.contains("\"Ordinary\""), "the link after it is there: {all}");
    }

    /// A tree too long to read is cut at a line end, and the fact is reported
    /// rather than left in the text for the parser to drop.
    #[test]
    fn a_tree_too_long_to_read_is_cut_at_a_line_and_the_fact_is_returned() {
        let body = (1..=40_000).map(|n| format!("- [e{n}] link \"row {n} of the page\"\n")).collect::<String>();
        assert!(body.chars().count() > TREE_CHARS);
        let (capped, cut) = capped(&body);
        assert!(cut, "the page did not fit");
        assert!(capped.chars().count() <= TREE_CHARS);
        // The cut lands on a line, so nothing is left half-printed.
        let kept = capped.lines().next_back().expect("a last line");
        assert!(!kept.contains("row 1 of the page"));
        assert!(body.starts_with(&capped));
    }

    #[test]
    fn a_page_too_long_to_render_is_cut_at_a_line_in_both_sets() {
        let lines: Vec<String> = (1..=40_000).map(|n| format!("- [e{n}] link \"row {n} of the page\"")).collect();
        let out = tree::Lines { full: lines.clone(), visible: lines };
        let (out, cut) = within_budget(out);
        assert!(cut, "the page did not fit");
        assert_eq!(out.full.len(), out.visible.len(), "the two sets are one for one");
        assert!(out.full.join("\n").chars().count() <= TREE_CHARS);
        assert!(!out.full.last().expect("a last line").contains("row 1 of the page"));
    }

    /// **The header says when the tree did not fit.** Every part carries the
    /// header, so a notice there is a notice in every part.
    #[test]
    fn the_header_says_when_the_tree_did_not_fit() {
        let whole = header("https://example.test/", "Example", false);
        assert!(!whole.contains("partial"), "a page that fits says nothing: {whole}");
        assert!(whole.starts_with("url: https://example.test/\ntitle: Example"), "{whole}");

        let cut = header("https://example.test/", "Example", true);
        assert!(cut.contains(PARTIAL_NOTE), "a page that did not fit says so: {cut}");
        assert!(cut.starts_with("url: https://example.test/\ntitle: Example"), "{cut}");
    }

    // The formatter owns the first blank line; title text stays on one line.
    #[test]
    fn a_title_with_a_blank_line_leaves_the_notice_in_the_header() {
        let header = header("https://example.test/", "First\n\nSecond", true);
        assert!(!header.contains("\n\n"), "the header is one block: {header}");
        assert!(header.contains(PARTIAL_NOTE), "and the notice is in it: {header}");
        assert!(header.contains("title: First Second"), "{header}");
    }

    #[test]
    fn a_page_within_the_budget_is_left_exactly_as_it_was() {
        let (body, cut) = capped("- [e1] link \"Home\"");
        assert_eq!(body, "- [e1] link \"Home\"");
        assert!(!cut, "nothing was left out");
        let (empty, cut) = capped("");
        assert_eq!(empty, "");
        assert!(!cut);
    }
}
