//! The elements a read printed, and the one a call may act on (one
//! responsibility: remember what was printed for the document now open, and
//! refuse anything that was not).
//!
//! A ref goes into the page as a selector. A ref that is really a selector would
//! be one a page could talk a model into writing — `>>` chains, and anything
//! else Playwright would resolve — so a ref is only ever a lowercase run of
//! letters and figures, and only ever one a read printed.
//!
//! Only the ref **position** of a line counts. A page is free to put the text
//! `[e999]` anywhere it likes — in a link name, in a title, in the address at
//! the top — and none of that is something a read printed as an element, so
//! none of it may be acted on.

use std::collections::HashSet;

use playwright_rs::protocol::{Locator, Page};

#[derive(PartialEq, Eq, Debug)]
pub enum Refused {
    /// Nothing was named.
    Nothing,
    /// What was named is not a ref at all: it carries something a selector
    /// could be made of.
    NotARef,
    /// A ref this window may not act on: the document it was printed in is
    /// gone, or a later read has replaced it.
    NotOnPage,
}

impl Refused {
    pub fn reason(&self) -> &'static str {
        match self {
            Refused::Nothing => {
                "no element was named: read the page first, then use one of the refs it printed"
            }
            Refused::NotARef => "that is not an element ref: use one of the refs a read printed",
            Refused::NotOnPage => {
                "that element is not one this page printed: read the page again and use a ref from it"
            }
        }
    }
}

/// The refs printed for the document now open.
///
/// **The document, not the read**: the driver numbers a document once, so a ref
/// printed in one part of a page names the same element in the next.
#[derive(Default)]
pub struct Refs {
    /// The refs of the main document, kept for as long as it is the one.
    main: HashSet<String>,
    /// The refs of the child frames, from the last read only. **A frame numbers
    /// its own document, and we cannot see that document change.**
    frames: HashSet<String>,
    /// The document the main refs belong to.
    document: Option<u64>,
}

/// The ref a line prints, if it prints one.
///
/// A line is `- <role> "<name>"` at its deepest and `- [e4] <role> "<name>"`
/// where there is one to act on, so the ref sits between the dash and
/// everything else. Anything in brackets anywhere later on the line is text.
fn ref_of_line(line: &str) -> Option<String> {
    let rest = line.trim_start().strip_prefix("- ")?.trim_start();
    let tail = rest.strip_prefix('[')?;
    let close = tail.find(']')?;
    let id = &tail[..close];
    let plain = !id.is_empty() && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit());
    plain.then(|| id.to_string())
}

fn refs_in(text: &str) -> impl Iterator<Item = String> + '_ {
    text.lines().filter_map(ref_of_line)
}

/// Unclassified prefixed refs expire after each read: the prefix cannot
/// distinguish main from child frames.
fn has_frame_prefix(id: &str) -> bool {
    let Some(rest) = id.strip_prefix('f') else { return false };
    let Some((frame, element)) = rest.split_once('e') else { return false };
    let digits = |part: &str| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit());
    digits(frame) && digits(element)
}

impl Refs {
    /// Callers without frame classification retain only unprefixed refs across reads.
    pub fn remember(&mut self, text: &str, document: u64) {
        if self.document != Some(document) {
            self.main.clear();
            self.document = Some(document);
        }
        self.frames.clear();
        for id in refs_in(text) {
            if has_frame_prefix(&id) {
                self.frames.insert(id);
            } else {
                self.main.insert(id);
            }
        }
    }

    /// What a read printed, added to what this document printed before. The tree
    /// the read was made of says which document a ref is in; its shape does not.
    pub(crate) fn remember_classified(&mut self, text: &str, document: u64, main: &HashSet<String>) {
        if self.document != Some(document) {
            self.main.clear();
            self.document = Some(document);
        }
        self.frames.clear();
        for id in refs_in(text) {
            if main.contains(&id) {
                self.main.insert(id);
            } else {
                self.frames.insert(id);
            }
        }
    }

    /// The element to act on, or the line that says no.
    ///
    /// `document` is the document the call is made on, so a ref of a document
    /// that has gone is refused rather than acted on.
    pub fn check(&self, reference: &str, document: Option<u64>) -> Result<String, Refused> {
        let id = reference.trim().trim_start_matches('[').trim_end_matches(']').trim();
        if id.is_empty() {
            return Err(Refused::Nothing);
        }
        if !id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()) {
            return Err(Refused::NotARef);
        }
        if self.document != document || !(self.main.contains(id) || self.frames.contains(id)) {
            return Err(Refused::NotOnPage);
        }
        Ok(id.to_string())
    }
}

/// The element a ref names.
pub fn at(page: &Page, id: &str) -> Locator {
    page.locator(format!("aria-ref={id}"))
}

#[cfg(test)]
mod tests {
    use super::{refs_in, Refs, Refused};

    fn remembered(text: &str) -> Refs {
        let mut refs = Refs::default();
        refs.remember(text, 1);
        refs
    }

    #[test]
    fn a_read_prints_the_refs_it_found() {
        let found: Vec<String> = refs_in("- [e4] combobox\n  - [e12] link \"Home\"\n- text \"hi\"").collect();
        assert_eq!(found, ["e4", "e12"]);
    }

    /// A page can write anything it likes into a name, a title or an address.
    /// None of it is an element, so none of it may be acted on.
    #[test]
    fn brackets_in_a_name_a_title_or_an_address_are_not_a_ref() {
        let read = "url: https://example.com/?to=[e999]\ntitle: [e888] the shop\n\n                    - link [ref=e4] \"buy the [e777] lamp\"\n- text \"code [e666] today\"\n                    - [e12] link \"Home\"";
        let refs = remembered(read);
        assert_eq!(refs.check("e12", Some(1)).expect("printed"), "e12");
        for smuggled in ["e999", "e888", "e777", "e666"] {
            assert_eq!(refs.check(smuggled, Some(1)).err(), Some(Refused::NotOnPage), "{smuggled}");
        }
    }

    #[test]
    fn a_ref_that_was_printed_is_accepted_in_every_spelling() {
        let refs = remembered("- [e12] link \"Home\"");
        for reference in ["e12", "[e12]", " e12 "] {
            assert_eq!(refs.check(reference, Some(1)).expect("a ref"), "e12", "{reference:?}");
        }
    }

    /// The page is asked for an element by selector, so anything that could be
    /// read as one is refused before it reaches the page.
    #[test]
    fn something_that_is_not_a_ref_is_refused_before_the_page_sees_it() {
        let refs = remembered("- [e12] link \"Home\"");
        for reference in [
            "e12 >> nth=0",
            "a[href^='mailto:']",
            "#id",
            "text=Home",
            "e12; e13",
            "E12",
            "e-12",
            "e12 body",
        ] {
            assert_eq!(refs.check(reference, Some(1)).err(), Some(Refused::NotARef), "{reference:?}");
        }
        assert_eq!(refs.check("", Some(1)).err(), Some(Refused::Nothing));
        assert_eq!(refs.check("  [ ] ", Some(1)).err(), Some(Refused::Nothing));
    }

    /// **A page read in parts is one document, and the driver numbers it once.**
    /// A ref printed in one part is the same element in the next, so reading
    /// another part does not make the first part's refs unusable.
    #[test]
    fn a_ref_printed_in_another_part_of_the_same_document_is_still_printed() {
        let mut refs = remembered("- [e4] textbox \"What needs to be done?\"");
        assert_eq!(refs.check("e4", Some(1)).expect("printed"), "e4");
        refs.remember("- [f1] link \"Home\"", 1);
        assert_eq!(refs.check("e4", Some(1)).expect("still printed"), "e4");
        assert_eq!(refs.check("f1", Some(1)).expect("printed"), "f1");
    }

    /// **A new document numbers itself again**, so a ref of the old one names
    /// something else now, or nothing at all.
    #[test]
    fn a_new_document_forgets_the_refs_of_the_old_one() {
        let mut refs = remembered("- [e4] textbox \"What needs to be done?\"");
        refs.remember("- [e4] textbox \"What needs to be done?\"", 2);
        assert_eq!(refs.check("e4", Some(2)).expect("printed"), "e4");
        assert_eq!(refs.check("e4", Some(1)).err(), Some(Refused::NotOnPage), "the document it was printed in is gone");
    }

    /// **A frame numbers its own document, and we cannot see that document
    /// change**, so a frame's ref is from the last read only.
    #[test]
    fn a_frames_ref_is_from_the_last_read_only() {
        let mut refs = remembered("- [e4] textbox \"What needs to be done?\"\n  - [f1e2] textbox \"Inside the frame\"");
        assert_eq!(refs.check("f1e2", Some(1)).expect("printed"), "f1e2");
        refs.remember("- [e9] textbox \"What needs to be done?\"", 1);
        assert_eq!(
            refs.check("f1e2", Some(1)).err(),
            Some(Refused::NotOnPage),
            "a frame's ref does not survive a read that omits it"
        );
        assert_eq!(refs.check("e4", Some(1)).expect("still printed"), "e4", "the main document's refs do");
    }

    /// A ref of another document is refused, whatever it was printed in.
    #[test]
    fn a_ref_of_another_document_is_refused() {
        let refs = remembered("- [e4] textbox \"What needs to be done?\"");
        assert_eq!(refs.check("e4", Some(2)).err(), Some(Refused::NotOnPage));
        assert_eq!(refs.check("e4", None).err(), Some(Refused::NotOnPage));
    }

    #[test]
    fn a_read_with_nothing_in_it_prints_nothing_to_act_on() {
        let refs = remembered("url: https://example.com/\ntitle: nothing here\n\n- text \"hi\"");
        assert_eq!(refs.check("e1", Some(1)).err(), Some(Refused::NotOnPage));
    }
}