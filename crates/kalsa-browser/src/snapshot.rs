//! The page as the model reads it (one responsibility: ask the driver for its AI
//! aria tree, split it into parts, and find text in it).
//!
//! Parts and find live here rather than in the chat because both answer
//! questions about a page far longer than one message: slicing it on the near
//! side of the pipe would mean shipping all of it every time.

use playwright_rs::protocol::{AriaSnapshotMode, AriaSnapshotOptions, Page};

use crate::tree;

pub(crate) const SNAPSHOT_CHARS: usize = 6000;

/// How much of a page's tree one read will render. A page can be made to carry
/// a megabyte of text in its accessible name; there is no reason to answer a
/// model with all of it, and a cut that says so is better than a truncated
/// ref.
const TREE_CHARS: usize = 200_000;

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

/// A page too long to render whole, cut at a line end so the last ref printed is
/// a whole one, and saying that it was cut.
fn capped(body: &str) -> String {
    if body.chars().count() <= TREE_CHARS {
        return body.to_string();
    }
    let head = head_of(body, TREE_CHARS);
    let at_line = boundary_at_or_below(head, head.rfind('\n').unwrap_or(head.len()));
    format!("{}\n… the page is longer than {TREE_CHARS} characters and was cut here", &head[..at_line])
}

/// The tree as the driver read it, and no more than the budget. A page can make
/// its accessible name a megabyte long, and parsing that into nodes before
/// cutting it would cost more than the cut saves — so the string is cut first,
/// at a line end, and the tree that gets parsed is the one a read can return.
async fn raw_snapshot(page: &Page) -> Result<String, playwright_rs::Error> {
    let options = AriaSnapshotOptions::default().mode(AriaSnapshotMode::Ai);
    let raw = page.aria_snapshot(Some(options)).await?;
    Ok(capped(&raw))
}

/// Where we are, then one line per element.
async fn page_text(page: &Page) -> Result<String, playwright_rs::Error> {
    let raw = raw_snapshot(page).await?;
    let url = page.url();
    let title = page.title().await.unwrap_or_default();
    Ok(format!("url: {url}\ntitle: {title}\n\n{}", capped(&tree::text_of(&raw))))
}

/// Chunks of whole lines: splitting mid-line would print half a ref, and
/// splitting mid-character panics. The cut is counted in characters and taken at
/// a boundary, so a page of accented text is split rather than fatal.
fn parts(body: &str, chars: usize) -> Vec<&str> {
    let wanted = chars.max(1);
    let mut out = Vec::new();
    let mut rest = body;
    while rest.chars().count() > wanted {
        let cut = boundary_at_or_below(rest, head_of(rest, wanted).len());
        let at = rest[..cut].rfind('\n').filter(|at| *at > 0);
        match at {
            Some(at) => out.push(&rest[..at]),
            None => out.push(&rest[..cut]),
        }
        rest = &rest[at.map_or(cut, |at| at + 1)..];
    }
    out.push(rest);
    out
}

/// A long page comes in parts rather than being cut: the model asks for part 2
/// and nothing on the page is lost. Each part names the next.
pub async fn snapshot(page: &Page, part: usize) -> Result<String, playwright_rs::Error> {
    let text = page_text(page).await?;
    let (head, body) = text.split_once("\n\n").unwrap_or(("", text.as_str()));
    let room = SNAPSHOT_CHARS.saturating_sub(head.len() + 2).max(200);
    let chunks = parts(body, room);
    if chunks.len() == 1 {
        return Ok(text);
    }
    let at = part.clamp(1, chunks.len());
    let footer = if at < chunks.len() {
        format!("Part {at} of {} — call browser_read with page {} for more.", chunks.len(), at + 1)
    } else {
        format!("Part {at} of {} — this is the last part.", chunks.len())
    };
    Ok(format!("{head}\n\n{}\n\n{footer}", chunks[at - 1]))
}

/// The lines that mention some text, with a little around them and their refs
/// intact — the find-in-page a model reaches for when a page is too long.
pub async fn find(page: &Page, needle: &str, around: usize, limit: usize) -> Result<String, playwright_rs::Error> {
    let text = page_text(page).await?;
    let (head, body) = text.split_once("\n\n").unwrap_or(("", text.as_str()));
    let needle = needle.trim().to_lowercase();
    if needle.is_empty() {
        return Ok(format!("{head}\n\nnothing to look for — pass some text"));
    }
    let all: Vec<&str> = body.split('\n').collect();
    let mut out: Vec<String> = Vec::new();
    for (i, line) in all.iter().enumerate() {
        if out.len() >= limit || !line.to_lowercase().contains(&needle) {
            continue;
        }
        let from = i.saturating_sub(around);
        for (offset, line) in all[from..(i + around + 1).min(all.len())].iter().enumerate() {
            out.push(format!("{:>4} {}", from + offset + 1, line));
        }
        out.push(String::new());
    }
    if out.is_empty() {
        return Ok(format!("{head}\n\nnothing on this page matches \"{needle}\""));
    }
    let kept = out[..out.len().min(limit)].join("\n").trim_end().to_string();
    let more = if out.len() > limit {
        format!("\n… more matches not shown ({} char cap)", SNAPSHOT_CHARS)
    } else {
        String::new()
    };
    Ok(format!("{head}\n\n{kept}{more}"))
}

#[cfg(test)]
mod tests {
    use super::{boundary_at_or_below, capped, parts};

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

    /// A page that renders to more than the budget is cut at a line end and says
    /// so, rather than answering with half a ref and no mention of it.
    #[test]
    fn a_page_too_long_to_render_is_cut_at_a_line_and_says_so() {
        let body = (1..=40_000).map(|n| format!("- [e{n}] link \"row {n} of the page\"\n")).collect::<String>();
        assert!(body.chars().count() > 200_000);
        let capped = capped(&body);
        assert!(capped.contains("was cut here"));
        assert!(capped.chars().count() <= 200_000 + 60);
        // The cut lands on a line, so nothing is left half-printed.
        let kept = capped.lines().next_back().expect("a last line");
        assert!(!kept.contains("row 1 of the page"));
        assert!(body.starts_with(&capped[..capped.find("\n… the page").unwrap()]));
    }

    #[test]
    fn a_page_within_the_budget_is_left_exactly_as_it_was() {
        assert_eq!(capped("- [e1] link \"Home\""), "- [e1] link \"Home\"");
        assert_eq!(capped(""), "");
    }
}