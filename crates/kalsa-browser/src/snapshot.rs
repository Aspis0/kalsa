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
    /// **Where the answer stands on the page.** A read is a window of the page,
    /// and the window says which lines it carries and how many the page has: a
    /// model that knows where it is does not read the same lines again. A find
    /// is not a window of the page — it is the lines that match — and has none.
    pub(crate) window: Option<Window>,
}

/// **The window of the page a read returned.** The lines it carries, counted
/// from zero, and how many the page has.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct Window {
    /// The first line of the window, counted from zero.
    pub(crate) first: usize,
    /// The line after the last one of the window, counted from zero: the line
    /// the next window starts at.
    pub(crate) after: usize,
    /// How many lines the page has.
    pub(crate) total: usize,
    /// **Whether the window carries a line with something in it.** A tree of
    /// empty lines is a page that says nothing, and a read that took it for
    /// content would hand the model an empty page instead of waiting for the
    /// one that has something on it.
    pub(crate) said: bool,
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
///
/// **The window's own lines, and not the text of the answer**: the header and
/// the line that says where the window stands are ours, and a page with
/// nothing on it must not be taken for one with something.
pub(crate) async fn has_content(page: &Page, read: &Read) -> bool {
    if let Some(window) = read.window {
        if window.said {
            return true;
        }
    }
    shows_text(page).await
}

/// Whether the document shows any text at all, asked of the document itself.
async fn shows_text(page: &Page) -> bool {
    page.evaluate::<(), bool>("!!(document.body && document.body.innerText.trim())", None).await.unwrap_or(false)
}

/// **The page as the model reads it, waiting for a page that has nothing on it
/// yet.** A site that answers a stranger with a challenge serves the page a
/// moment later, and the model should get the page rather than the challenge.
///
/// The part is the old way of naming a place on the page; `from` is the new
/// one, and a line is a place a model can say out loud.
pub async fn read_when_ready(page: &Page, part: usize) -> Result<String, playwright_rs::Error> {
    Ok(read_when_ready_with_main(page, 0, Some(part)).await?.text)
}

/// The same read, with the page's own document's refs beside it.
pub(crate) async fn read_when_ready_with_main(
    page: &Page,
    from: usize,
    part: Option<usize>,
) -> Result<Read, playwright_rs::Error> {
    let deadline = std::time::Instant::now() + CONTENT_WAIT;
    loop {
        let read = snapshot_with_main(page, from, part).await?;
        if has_content(page, &read).await {
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

/// A long page comes in windows rather than being cut: the model asks for the
/// lines that follow and nothing on the page is lost. Each window names the
/// next.
pub async fn snapshot(page: &Page, part: usize) -> Result<String, playwright_rs::Error> {
    Ok(snapshot_with_main(page, 0, Some(part)).await?.text)
}

/// **The page as the model reads it, from a line.** The line to start at: zero
/// is the first line of the page. The answer says which lines it carries and
/// how many lines the page has, so the next one is a line the model can name.
pub async fn snapshot_from(page: &Page, from: usize) -> Result<String, playwright_rs::Error> {
    Ok(snapshot_with_main(page, from, None).await?.text)
}

/// **The window of the page a read returns.** The lines from `start` that fit
/// the room, and the line after them: the next window starts there.
///
/// **Whole lines, as a part has always been whole lines.** A line that carries
/// an address is never cut, so a window cannot invent a truncated destination;
/// a line longer than the whole room and carrying no address is cut at a
/// character boundary, and the window ends there.
fn window_of(lines: &[String], start: usize, room: usize) -> (String, usize, usize, bool) {
    let start = start.min(lines.len());
    let mut kept: Vec<&str> = Vec::new();
    let mut used = 0usize;
    let mut end = start;
    while end < lines.len() {
        let line = lines[end].as_str();
        let cost = line.chars().count() + 1;
        if !kept.is_empty() && used + cost > room {
            break;
        }
        if kept.is_empty() && cost > room && !tree::carries_address(line) {
            kept.push(head_of(line, room));
            end += 1;
            break;
        }
        kept.push(line);
        used += cost;
        end += 1;
    }
    let said = kept.iter().any(|line| !line.trim().is_empty());
    (kept.join("\n"), start, end, said)
}

/// **The window the Nth part of the page is**, counting from one. The parts are
/// the windows the page is made of: the first is the head of the page, and each
/// one starts where the last one ended. A part past the last window is the last
/// window, as it has always been.
fn part_window(lines: &[String], part: usize, room: usize) -> (String, usize, usize, bool) {
    let mut start = 0usize;
    let mut at = 1usize;
    loop {
        let (text, first, end, said) = window_of(lines, start, room);
        if at >= part.max(1) || end >= lines.len() {
            return (text, first, end, said);
        }
        start = end;
        at += 1;
    }
}

/// **Where the answer stands on the page.** The lines it carries and how many
/// the page has, and the line the next one starts at: a model that knows this
/// does not read the same lines again, and a page longer than one answer is
/// only reachable if the answer says where the next one begins.
fn window_footer(first: usize, end: usize, total: usize) -> String {
    if total == 0 || end == 0 {
        return "The page has no lines to read.".to_string();
    }
    if end < total {
        format!(
            "lines {}–{} of {} — call browser_read with from={} for the lines that follow.",
            first + 1,
            end,
            total,
            end
        )
    } else {
        format!("lines {}–{} of {} — this is the last line of the page.", first + 1, end, total)
    }
}

/// The same read in windows, with the page's own document's refs beside it.
///
/// **`from` is the line to start at** — zero is the first line of the page —
/// and `part` is the old way of naming the same place, kept so that a client
/// that asks for parts still gets them.
pub(crate) async fn snapshot_with_main(
    page: &Page,
    from: usize,
    part: Option<usize>,
) -> Result<Read, playwright_rs::Error> {
    let rendered = page_text(page).await?;
    let lines = &rendered.full;
    let total = lines.len();
    let room = SNAPSHOT_CHARS.saturating_sub(rendered.head.len() + 2).max(200);
    let (body, first, end, said) = match part {
        Some(part) => part_window(lines, part, room),
        None => window_of(lines, from, room),
    };
    let text = format!("{}\n\n{}\n\n{}", rendered.head, body, window_footer(first, end, total));
    Ok(Read {
        text,
        main: rendered.main,
        window: Some(Window { first, after: end, total, said }),
    })
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
        return Ok(Read { text: format!("{}\n\nnothing to look for — pass some text", rendered.head), main: rendered.main, window: None });
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
            window: None,
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
    Ok(Read { text: format!("{}\n\n{kept}{more}", rendered.head), main: rendered.main, window: None })
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
    use super::{boundary_at_or_below, capped, header, window_of, within_budget, PARTIAL_NOTE, TREE_CHARS};
    use crate::tree;

    /// A ref cut in half is worse than a long window: the model reads `textbo` as
    /// a control it cannot act on, or presses nothing at all.
    #[test]
    fn a_window_never_ends_in_the_middle_of_a_line() {
        let lines: Vec<String> = (1..=40).map(|n| format!("- [e{n}] link \"line {n}\"")).collect();
        let (text, _, after, _) = window_of(&lines, 0, 120);
        for line in text.lines() {
            assert!(!line.is_empty(), "a window holds whole lines only");
            assert!(!line.starts_with('-') || line.contains('"'), "{line}");
        }
        assert!(after > 0 && after < lines.len(), "the window is a part of the page: {after}");
    }

    /// **Every line is in exactly one window, and the windows follow one
    /// another.** A page longer than an answer is only reachable if nothing is
    /// lost and nothing is read twice.
    #[test]
    fn every_line_survives_the_windows() {
        let lines: Vec<String> = (1..=200).map(|n| format!("line {n}")).collect();
        let mut start = 0usize;
        let mut read: Vec<String> = Vec::new();
        loop {
            let (text, first, after, _) = window_of(&lines, start, 50);
            assert_eq!(first, start, "a window starts where the last one ended");
            read.extend(text.lines().map(|line| line.to_owned()));
            if after >= lines.len() {
                break;
            }
            assert!(after > start, "a window always moves: {start} -> {after}");
            start = after;
        }
        assert_eq!(read, lines, "nothing is lost and nothing is read twice");
    }

    #[test]
    fn a_page_that_fits_is_one_window_and_a_line_with_no_end_is_cut_hard() {
        let short = vec!["short".to_string()];
        let (text, first, after, _) = window_of(&short, 0, 100);
        assert_eq!(text, "short");
        assert_eq!((first, after), (0, 1));

        let long = vec!["x".repeat(250)];
        let (text, _, after, _) = window_of(&long, 0, 100);
        assert_eq!(text.chars().count(), 100, "the line is cut at the room");
        assert_eq!(after, 1, "and the window ends there");
    }

    #[test]
    fn a_room_of_zero_does_not_loop_forever() {
        let lines = vec!["abc".to_string()];
        let (_, _, after, _) = window_of(&lines, 0, 0);
        assert_eq!(after, 1, "the window still moves");
    }

    /// Every character in these is four bytes and every boundary is four apart,
    /// so cutting at byte 120 would land in the middle of one and panic.
    #[test]
    fn a_window_of_accented_text_is_cut_rather_than_fatal() {
        let lines: Vec<String> = vec!["caffè".repeat(40), "the line after it".to_string()];
        let (text, _, after, _) = window_of(&lines, 0, 120);
        assert!(text.chars().count() <= 120, "a window is within the budget: {text:?}");
        assert_eq!(after, 1, "the long line is cut and the window ends there");
    }

    #[test]
    fn a_cut_is_always_on_a_character_boundary() {
        for cut in 0..40 {
            let body = "caffè".repeat(10);
            let at = boundary_at_or_below(&body, cut);
            assert!(body.is_char_boundary(at), "cut {at} is inside a character");
        }
    }

    /// A window that cuts a link line in half prints an address that is not
    /// there, so a line with an address is kept whole even over the budget.
    #[test]
    fn a_link_line_over_the_budget_is_kept_whole() {
        let href = format!("https://example.test/{}", "a".repeat(300));
        let raw = format!("- link \"Long\" [ref=e1]:\n  - /url: {href}\n- link \"Ordinary\" [ref=e2]");
        let nodes = tree::tree_of(&raw);
        let mut out = tree::Lines::default();
        tree::render(&nodes, 0, &mut out);
        let (text, _, after, _) = window_of(&out.full, 0, 120);
        assert!(text.contains(&href), "the address is whole: {text}");
        assert!(after < out.full.len(), "and the window ends there: {after}");
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
