//! The elements a read printed, and the one a call may act on (one
//! responsibility: remember what the last read showed, and refuse anything that
//! was not in it).
//!
//! A ref goes into the page as a selector. A ref that is really a selector would
//! be one a page could talk a model into writing — `>>` chains, and anything
//! else Playwright would resolve — so a ref is only ever a lowercase run of
//! letters and figures, and only ever one the last read printed.
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
    /// A ref, but not one this page's last read printed.
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

/// The refs of the most recent read, and nothing else: a second read replaces
/// them, because the driver numbers the page afresh every time.
#[derive(Default)]
pub struct Refs {
    printed: HashSet<String>,
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

impl Refs {
    /// What this page printed, replacing whatever it printed last time.
    pub fn remember(&mut self, text: &str) {
        self.printed = refs_in(text).collect();
    }

    /// The element to act on, or the line that says no.
    pub fn check(&self, reference: &str) -> Result<String, Refused> {
        let id = reference.trim().trim_start_matches('[').trim_end_matches(']').trim();
        if id.is_empty() {
            return Err(Refused::Nothing);
        }
        if !id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()) {
            return Err(Refused::NotARef);
        }
        if !self.printed.contains(id) {
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
        refs.remember(text);
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
        assert_eq!(refs.check("e12").expect("printed"), "e12");
        for smuggled in ["e999", "e888", "e777", "e666"] {
            assert_eq!(refs.check(smuggled).err(), Some(Refused::NotOnPage), "{smuggled}");
        }
    }

    #[test]
    fn a_ref_the_last_read_printed_is_accepted_in_every_spelling() {
        let refs = remembered("- [e12] link \"Home\"");
        for reference in ["e12", "[e12]", " e12 "] {
            assert_eq!(refs.check(reference).expect("a ref"), "e12", "{reference:?}");
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
            assert_eq!(refs.check(reference).err(), Some(Refused::NotARef), "{reference:?}");
        }
        assert_eq!(refs.check("").err(), Some(Refused::Nothing));
        assert_eq!(refs.check("  [ ] ").err(), Some(Refused::Nothing));
    }

    /// Refs are numbered afresh by every read, so one from two reads ago is a
    /// different element now, or nothing at all.
    #[test]
    fn a_ref_from_an_earlier_read_is_refused_after_a_later_one() {
        let mut refs = remembered("- [e4] textbox \"What needs to be done?\"");
        assert_eq!(refs.check("e4").expect("printed"), "e4");
        refs.remember("- [f1] link \"Home\"");
        assert_eq!(refs.check("e4").err(), Some(Refused::NotOnPage));
        assert_eq!(refs.check("f1").expect("printed"), "f1");
    }

    #[test]
    fn a_read_with_nothing_in_it_prints_nothing_to_act_on() {
        let refs = remembered("url: https://example.com/\ntitle: nothing here\n\n- text \"hi\"");
        assert_eq!(refs.check("e1").err(), Some(Refused::NotOnPage));
    }
}