//! What counts as a secret field, and the values that went into one (one
//! responsibility: the single definition, and the list the route reads).
//!
//! **There is one list, and it is written once.** Three places have to agree
//! about what a secret field is: `input.rs` refuses the model a field that is
//! one, the catcher in `submit.rs` records what the *person* typed into one, and
//! the card then empties those values. They were three copies of one predicate,
//! and they had already drifted — one matched `autocomplete` as a substring and
//! the other as a whole token, so `autocomplete="section-login current-password"`
//! was refused to the model and then tracked by nobody, which is exactly the
//! field where a typed value reaches a card in the clear.
//!
//! **The JavaScript is generated from the Rust lists**, so a field that is a
//! secret to one is a secret to all of them by construction. [`classifier`] is
//! the only source of that JavaScript, and the tests check the generated source
//! against these two constants rather than trusting that somebody updated all
//! three copies.

use std::sync::{Arc, Mutex};

/// The `type` of a field that holds a secret.
pub(crate) const SECRET_TYPES: &[&str] = &["password"];

/// The `autocomplete` tokens that make a field a secret. A one-time code is a
/// password for one use, and it is the one a page is most likely to talk a model
/// into handing over.
pub(crate) const SECRET_AUTOCOMPLETE: &[&str] = &["current-password", "new-password", "one-time-code"];

/// **The predicate, as JavaScript, built from the two lists above.**
///
/// One function, called by both `input.rs` (does the model get to type here?)
/// and the catcher (is what the person just typing theirs?). A token matches on
/// **substring**, because `autocomplete` is a space-separated list of tokens and
/// `section-login current-password` is one field, not two.
pub(crate) fn classifier() -> String {
    format!(
        "(el) => {{\n    if (!(el instanceof HTMLElement)) return false;\n    const kind = \
         String(el.type || el.getAttribute('type') || '').toLowerCase();\n    if \
         ({types}.includes(kind)) return true;\n    const tokens = String(el.getAttribute('autocomplete') \
         || '').toLowerCase().split(/\\s+/);\n    return {autocomplete}.some((token) => tokens.includes(token));\n  }}",
        types = json_list(SECRET_TYPES),
        autocomplete = json_list(SECRET_AUTOCOMPLETE),
    )
}

/// The predicate as a **declaration**, for a script that asks it.
///
/// **It used to be installed as `window.__kalsaPasswords` and read back out of
/// the page**, which is a global any page can replace before the person has
/// typed anything — and what this predicate decides is whether the value they
/// type is tracked at all, so replacing it was a way to stop a password being
/// recorded. It is now written into each script that needs it, from the two Rust
/// lists above, so there is nothing on the page to replace and nothing that two
/// callers could disagree about.
pub(crate) fn classifier_declaration() -> String {
    format!("const isSecretField = {};", classifier())
}

fn json_list(values: &[&str]) -> String {
    format!(
        "[{}]",
        values.iter().map(|value| format!("\"{value}\"")).collect::<Vec<String>>().join(",")
    )
}

/// **What the person typed into a secret field, on this side of the wire.**
///
/// The catcher records each value the moment it is typed, over a binding, and
/// this is where it lands. It is here rather than asked of the page because the
/// route asks it on **every request**: a page with two hundred subresources
/// would cost two hundred round trips to the driver, and a GET is the one
/// request that has to be checked for a value it is carrying.
///
/// A value stays until [`Typed::forget`] — which is what opening another address
/// does. It is deliberately **not** forgotten per navigation: a stale value can
/// only cause a request to be *asked about* that would otherwise have gone, which
/// is the safe direction to be wrong in, and forgetting on a navigation nobody
/// else can see would be the other one.
#[derive(Clone, Default)]
pub struct Typed(Arc<Mutex<Vec<(u64, String)>>>);

impl Typed {
    /// What is in the secret fields right now, and nothing else.
    ///
    /// **One value per field, never one per keystroke.** The page sends the
    /// field's own handle with every change, so a value half-typed three
    /// keystrokes ago is not still on this list pretending to be a secret
    /// somebody set somewhere.
    pub fn values(&self) -> Vec<String> {
        self.0.lock().expect("the typed values are not poisoned").iter().map(|(_, value)| value.clone()).collect()
    }

    /// Records what is in one field now.
    ///
    /// **The latest value of a field replaces the one before it, and only for
    /// that field.** This used to keep every keystroke, and that is a trap: a
    /// password of `hunter2` typed one character at a time leaves `h`, `hu`,
    /// `hun`, ... behind, and every one of those is a needle short enough to sit
    /// inside ordinary addresses -- `h` is in `shop`, `hu` is in `?hub=1`. A held
    /// read is a page that does not load, so a person typing a password would take
    /// the site down with them. What the field holds now is the only thing worth
    /// looking for.
    ///
    /// **What a page can still do, said plainly.** It may replace the value of
    /// one handle it was given: a page can lie about what is in its own field,
    /// and the replacement is still a value that arrived through a secret field
    /// on this side of the wire. It cannot reach another field, cannot remove
    /// what is held, and cannot get anything *sent* -- the whole list only ever
    /// holds a request for a person to answer, so a page moving a needle here
    /// denies itself a page and hands itself nothing.
    ///
    /// An empty value is a field that was cleared, which is not a secret with
    /// nothing in it: it adds nothing, and it takes nothing away -- so the last
    /// real value stays held rather than being erased by a page that empties the
    /// field to cover its tracks.
    pub fn record(&self, field: u64, value: String) {
        if value.is_empty() {
            return;
        }
        let mut typed = self.0.lock().expect("the typed values are not poisoned");
        // The slot keeps its place, so the order fields were typed in is still the
        // order they are reported in.
        match typed.iter_mut().find(|(held, _)| *held == field) {
            Some(slot) => slot.1 = value,
            None => typed.push((field, value)),
        }
    }

    /// Forgets everything, for a window that has opened somewhere else.
    pub fn forget(&self) {
        self.0.lock().expect("the typed values are not poisoned").clear();
    }
}

/// **Whether an address carries one of these values**, in its query or in its
/// path, compared on what a server would decode rather than on the text.
///
/// A GET is not a write and is not held as one — but a GET whose query is
/// `?password=hunter2` is the same message to that server as the POST it came
/// from, with the secret in a place nobody is looking. Cutting the address at
/// the first `/` is what made that missable, so it is percent-decoded first and
/// both the path segments and the query values are read properly.
/// Whether one value is one the person typed into a secret field. **This is the
/// check that a type-flip cannot get past**: a page that renames its password
/// field does not change what the person put in it.
pub fn holds(value: &str, typed: &[String]) -> bool {
    !value.is_empty() && typed.iter().any(|secret| secret == value)
}

pub fn carries(url: &str, typed: &[String]) -> bool {
    let Ok(parsed) = url::Url::parse(url) else {
        return false;
    };
    // **Everywhere a server would look, and nowhere it would not.** The host, the
    // path and the query are all sent; the fragment is not — it lives in the
    // browser — so a secret that only appears after a `#` never left this
    // computer and is not this function's business.
    let mut parts: Vec<String> = Vec::new();
    if let Some(host) = parsed.host_str() {
        // **A host is compared folded, and it is the only part that is.** The URL
        // parser lower-cases a host on the way in, so a page writing the secret
        // `Tr0ub4dor` into `TR0UB4DOR.example.com` arrives here as
        // `tr0ub4dor.example.com` and a case-sensitive search never finds it. DNS
        // does not see case and neither does a server that reads a host, so both
        // sides are folded — which leaves the boundary rule exactly as it was, a
        // letter is still a letter. A **query, a path and a body are not folded**:
        // those are compared byte for byte by whatever receives them, and folding
        // them would invent a secret that was never typed.
        let folded: Vec<String> = typed.iter().map(|secret| secret.to_lowercase()).collect();
        if part_carries(&host.to_lowercase(), &folded) {
            return true;
        }
    }
    // **Decoded once, and by the rules of the piece it is in.** A `+` is a space
    // in a query and a literal plus everywhere else: decoding a path segment the
    // query way turned `/a+b` into `a b` and missed it. And `query_pairs` has
    // already percent-decoded what it hands back, so decoding that a second time
    // turned a `%252B` into `+` and read a `+` as a space — which is how a typed
    // `a+b` went out as `%2B` and was not found here.
    parts.extend(parsed.path_segments().into_iter().flatten().map(percent_decode));
    for (name, value) in parsed.query_pairs() {
        parts.push(name.into_owned());
        parts.push(value.into_owned());
    }
    parts.iter().any(|part| part_carries(part, typed))
}

/// **Whether one piece of a message carries one of these values.** The one
/// place the rule is written, because it is asked about in three directions and
/// three copies of it are three chances to disagree: a part of an address
/// ([`carries`]), a field's name or value in a body, and the bytes of that body
/// itself.
///
/// **Two questions, and they have different bars.** A part that *is* the value
/// — the whole of a query value, the whole of a path segment, the whole of a
/// form field — is the person's own thing going out, whatever it is spelled
/// with: a bank code is three digits and leaving it in an address is the same
/// mail as leaving a password. So equality asks about **every** value the person
/// typed, however short.
///
/// A value *inside* a part is the other question, and it needs a length: a
/// one- or two-character value appears inside almost every address on this
/// computer, and a check that fires on all of them is a check nobody reads —
/// it would hold every request the page made. Containment therefore asks only
/// about [`MIN_SECRET`] and up, and past [`PLAIN_CONTAINMENT`] it stops asking
/// where the value stands at all — see that constant for why the bar drops
/// with the length rather than rising with it.
///
/// **A field's name is asked about as well as its value.** A page that puts the
/// password where the server reads it as the key — `hunter2=1`, a value welded
/// to a tracking suffix — is sending the same message to that server as one that
/// puts it in the value, and only one of those used to be looked for.
pub fn part_carries(part: &str, typed: &[String]) -> bool {
    typed.iter().filter(|secret| !secret.is_empty()).any(|secret| {
        // **Whole, whatever its length.** A three-digit bank code is short and it
        // is still exactly what it is when it is the whole of a query value.
        if part == secret {
            return true;
        }
        if !part.contains(secret.as_str()) {
            return false;
        }
        // **And how hard it is looked for depends on how long it is**, because who
        // controls the surroundings is the question.
        //
        // Past [`PLAIN_CONTAINMENT`] the secret is looked for anywhere at all.
        // While a window is paused the one writing the request is the page's own
        // script, and it decides what the secret is written next to: a letter on
        // each side is a boundary on both sides and defeats a boundary rule
        // entirely, so one would be a rule a page chooses to obey.
        //
        // A false positive here only holds a request for the person to answer. A
        // false negative is the secret on its way to somebody else's server. That
        // is not a close call, and the length threshold is where the trade stops
        // being close: eight characters is past the point where a secret is
        // something a page would type by accident.
        if secret.chars().count() >= PLAIN_CONTAINMENT {
            return true;
        }
        // **Below it, on a boundary**, because a short value is inside almost every
        // address on this computer and a check that fires on all of them holds every
        // request the page makes — which is a check nobody reads.
        secret.chars().count() >= MIN_SECRET && holds_at_a_boundary(part, secret)
    })
}

/// How long a typed value has to be before it is looked for **inside** a part
/// anywhere, without asking whether it stands on a boundary.
///
/// Eight is not a guess about secrets; it is the point where "the page is
/// choosing the surroundings around it" stops being a plausible accident. Under
/// it the boundary rule stands and its gap — a short value glued straight to
/// letters — is written down at [`holds_at_a_boundary`].
const PLAIN_CONTAINMENT: usize = 8;

/// Whether `part` holds `secret` **on a boundary**: the characters on either
/// side of it, where there are any, are not letters or figures.
///
/// **This is what stops a typed `test` from being found in `latest`.** Containment
/// with no boundary at all fires on every ordinary address on this computer the
/// moment anybody types four ordinary letters into a password field, and the cost
/// is not a line in a report: a held read is a page that does not load, so a
/// secret nobody guessed the meaning of takes the site down with it. A real
/// secret travels welded to punctuation (`token=hunter2-9f3a`,
/// `/api/v2/hunter2/session`) or to nothing at all, which a boundary still finds.
///
/// **What it gives up, stated because it is a real gap:** a **short** secret
/// welded directly to letters — `hunter2x`, `xhunter2` — is not found by
/// containment. A secret of [`PLAIN_CONTAINMENT`] or more never comes here, so
/// the gap is only as wide as a short value. Either way it is still found whole,
/// and equality was never affected.
fn holds_at_a_boundary(part: &str, secret: &str) -> bool {
    let bytes = secret.as_bytes();
    part.match_indices(secret).any(|(at, _)| {
        let before = part[..at].chars().next_back();
        let after = part[at + bytes.len()..].chars().next();
        let edge = |character: Option<char>| character.is_none_or(|one| !one.is_alphanumeric());
        edge(before) && edge(after)
    })
}

/// How long a typed value has to be before it can be **looked for inside** a
/// part of a message. Four is short enough for the shortest thing anybody keeps
/// a secret for and long enough that a search for it means something.
///
/// **This is about containment alone.** A value that *is* a whole part of an
/// address — the whole of a query value, the whole of a path segment — is the
/// person's own thing leaving, and is asked about at any length; see
/// [`part_carries`]. A three-digit bank code is short enough to sit inside every
/// address on this computer and still exactly what it is when it is the whole of
/// one.
pub const MIN_SECRET: usize = 4;

/// What a server sees of one `%`-escaped **path** segment. A path has no rule
/// that makes `+` a space, so this does not invent one.
fn percent_decode(value: &str) -> String {
    percent_encoding::percent_decode_str(value).decode_utf8_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::{carries, classifier, classifier_declaration, part_carries, Typed, PLAIN_CONTAINMENT, SECRET_AUTOCOMPLETE, SECRET_TYPES};

    /// **A GET carrying what the person typed is not a read**, whether the secret
    /// is in the query or the path, spelled the way a server would decode it.
    /// `%68unter2` is that password to the server and a different string to us,
    /// and comparing raw text is what would let it through.
    #[test]
    fn a_read_carrying_a_typed_secret_is_found_in_the_query_or_the_path() {
        let typed = vec!["hunter2".to_owned(), "123456".to_owned()];
        for carrying in [
            "https://shop.example/go?password=hunter2",
            "https://shop.example/go?password=hunter2&next=%2Fcart",
            "https://shop.example/go?password=hunter2#frag",
            "https://shop.example/reset/hunter2",
            "https://shop.example/reset/hunter2/confirm",
            "https://shop.example/go?password=%68unter2",
            "https://shop.example/go?password=hunter%32",
        ] {
            assert!(carries(carrying, &typed), "{carrying} carries one of them");
        }
        for clean in [
            "https://shop.example/",
            "https://shop.example/app.css",
            "https://shop.example/search?q=hunter",
            "https://shop.example/go?password=wrong",
            "https://shop.example/reset/hunter3",
            "not an address at all",
        ] {
            assert!(!carries(clean, &typed), "{clean} carries none of them");
        }
        assert!(!carries("https://shop.example/go?password=hunter2", &[]), "with nothing typed there is nothing to find");
    }

    /// **A secret travels inside things, not as whole pieces.** Equality with a
    /// query value or a path segment would pass every one of these, and every one
    /// is the same mail to a stranger's server: a value welded to an id, a
    /// tracking parameter that grew a suffix, a host label carrying it.
    #[test]
    fn a_typed_secret_is_found_inside_a_part_and_not_only_as_one() {
        let typed = vec!["hunter2".to_owned()];
        for carrying in [
            "https://shop.example/go?token=hunter2-9f3a",
            "https://shop.example/go?next=cart&t=hunter2",
            "https://shop.example/api/v2/hunter2/session",
            "https://hunter2.shop.example/",
            "https://shop.example/reset?code=hunter2%21",
        ] {
            assert!(carries(carrying, &typed), "{carrying} carries it");
        }
    }

    /// **What a server does not get is not a leak.** A fragment stays in the
    /// browser: it is never sent, so a secret that only appears after a `#` left
    /// nothing behind and must not hold every request the page makes.
    #[test]
    fn a_secret_in_the_fragment_is_not_a_secret_that_went_anywhere() {
        let typed = vec!["hunter2".to_owned()];
        assert!(!carries("https://shop.example/go#hunter2", &typed));
        assert!(!carries("https://shop.example/go?a=1#hunter2", &typed));
    }

    /// **A secret too short to mean anything is not looked for.** A value of one
    /// or two characters is inside nearly every address on this computer, and a
    /// check that fires on all of them is a check nobody reads.
    #[test]
    fn a_short_secret_is_a_whole_part_and_is_never_looked_for_inside_one() {
        // **Whole, it is the person's own thing leaving.** A three-digit bank code
        // is short and it is still exactly what it is when it is the whole of a
        // value: a page that puts it in a query is putting it in a stranger's log
        // for no reason a card would ever have to cover.
        let short = vec!["482".to_owned()];
        for carrying in [
            "https://shop.example/go?code=482",
            "https://shop.example/verify/482",
            "https://shop.example/go?code=482&next=cart",
            "https://shop.example/go?code=%34%38%32",
        ] {
            assert!(carries(carrying, &short), "the whole of a part is the value: {carrying}");
        }

        // **Inside another value, a short one is not looked for.** "ab" sits inside
        // almost every address on this computer, and a check that fires on all of
        // them holds every request the page makes — which is a check nobody reads.
        let two = vec!["ab".to_owned()];
        assert!(!carries("https://shop.example/go?password=abcde", &two));
        assert!(!carries("https://shop.example/go?password=xaby", &two));
        assert!(!carries("https://ab.example/", &two));
        // And the same value at four is found when it stands on its own, because
        // at four it means something.
        assert!(carries("https://shop.example/go?password=abcd", &["abcd".to_owned()]));
        // **But not welded directly to letters**, which is the cost of the
        // boundary rule for a value this short and is written here rather than
        // left to be discovered: `xxabcdxx` is the one shape containment walks
        // past below eight characters. See `holds_at_a_boundary` and
        // `a_short_secret_glued_straight_to_letters_is_the_gap_the_boundary_rule_leaves`.
        assert!(!carries("https://shop.example/go?password=xxabcdxx", &["abcd".to_owned()]));
    }

    /// **One rule, asked about one piece at a time** — which is how the guard
    /// asks about a form field's name and about a body's own bytes, and how
    /// every piece of an address is asked about. Equality at any length,
    /// containment from [`super::MIN_SECRET`] up — and from [`PLAIN_CONTAINMENT`]
    /// up without asking where it stands — and a value the person never typed is
    /// not a secret that matches everything.
    #[test]
    fn one_part_carries_a_typed_secret_by_being_it_or_by_holding_it() {
        let typed = vec!["hunter2".to_owned(), "482".to_owned()];
        assert!(part_carries("hunter2", &typed), "the whole of it");
        assert!(part_carries("token=hunter2-9f3a", &typed), "welded to something else");
        assert!(part_carries("hunter2", &typed), "and in whatever part of a message it is");

        // **A short value is still a value when it is the whole of a part.**
        assert!(part_carries("482", &typed), "three digits, whole");
        assert!(!part_carries("code=482x", &typed), "and not looked for inside another part");

        assert!(!part_carries("hunter3", &typed), "a near miss is not the value");
        assert!(!part_carries("anything", &[]), "nothing typed, nothing to find");
        assert!(!part_carries("", &["".to_owned()]), "and an empty value is not a secret that is everywhere");
    }

    /// **A *short* secret has to stand on a boundary to be found inside a part**,
    /// so a typed `test` is not inside `latest`. Without that, four ordinary
    /// letters typed into a password field make every ordinary address on this
    /// computer look like a leak — and a held read is a page that does not load.
    /// This is the short side of [`PLAIN_CONTAINMENT`]; the long side is
    /// `a_secret_of_eight_characters_or_more_is_looked_for_anywhere_inside_a_part`.
    #[test]
    fn a_short_secret_is_only_looked_for_inside_a_part_where_it_stands_on_a_boundary() {
        let typed = vec!["test".to_owned()];
        for ordinary in [
            "https://shop.example/latest",
            "https://shop.example/go?protest=1",
            "https://shop.example/attestation.pdf",
            "https://shop.example/go?x=testing",
        ] {
            assert!(!carries(ordinary, &typed), "an ordinary address is not a leak: {ordinary}");
        }
        // **And the welded shapes a real secret actually travels in are still
        // found**, which is what the rule is for.
        for welded in [
            "https://shop.example/go?token=test-9f3a",
            "https://shop.example/go?next=cart&t=test",
            "https://shop.example/api/v2/test/session",
            "https://test.shop.example/",
            "https://shop.example/go?password=test%21",
        ] {
            assert!(carries(welded, &typed), "a secret welded to punctuation is still a secret: {welded}");
        }
        // Whole, at any length, boundary or not.
        assert!(carries("https://shop.example/go?code=test", &typed));
    }

    /// **Past eight characters the secret is looked for anywhere at all**, because
    /// while a window is paused it is the page's own script that writes the
    /// request — and it decides what the secret is written next to. A rule that
    /// asks whether the secret stands on a boundary is a rule the page chooses to
    /// obey: a letter on either side *is* a boundary, and one on each side defeats
    /// it completely. A false positive here holds a request for the person to
    /// answer; a false negative is the secret on its way to somebody else.
    #[test]
    fn a_secret_of_eight_characters_or_more_is_looked_for_anywhere_inside_a_part() {
        // **Fourteen characters, glued straight to letters or figures on both
        // sides** — every one of these is the shape the boundary rule walked
        // past, and the whole reason it does not apply at this length.
        let typed = vec!["passphrase9f3a".to_owned()];
        for glued in [
            "https://shop.example/go?password=xxpassphrase9f3axx",
            "https://shop.example/go?password=apassphrase9f3ab",
            "https://shop.example/go?password=1passphrase9f3a2",
            "https://shop.example/a/b/passphrase9f3ac/d",
        ] {
            assert!(carries(glued, &typed), "{glued} carries the value that was typed");
        }
        // **A long bar is not a licence to match anything.** A value is one
        // character or it is not; `?password=xpassphrase9f3a` is not a near miss,
        // it is the secret with a letter on the front, and it is in the list
        // above because that is the whole point.
        for clean in [
            "https://shop.example/go?password=passphrase9f3b",
            "https://shop.example/go?password=passphrase",
            "https://shop.example/go?password=passphrase9f3",
        ] {
            assert!(!carries(clean, &typed), "{clean} is not the value");
        }
        // **And the threshold is the length, not a shape**: the same welded part
        // is missed at seven characters and found at eight.
        assert_eq!(PLAIN_CONTAINMENT, 8, "eight characters is where the bar drops");
        assert!(!carries("https://shop.example/go?t=xx1234567x", &["1234567".to_owned()]), "seven is welded over");
        assert!(carries("https://shop.example/go?t=xx12345678x", &["12345678".to_owned()]), "eight is not");
    }

    /// **The gap the boundary rule leaves, on the short side**, stated because it
    /// is a real one rather than an accident: a value under [`PLAIN_CONTAINMENT`]
    /// that is glued straight onto letters or figures is not found inside a part.
    /// It is still found whole, and still found punctuated — which is where a
    /// value that short actually travels.
    #[test]
    fn a_short_secret_glued_straight_to_letters_is_the_gap_the_boundary_rule_leaves() {
        let typed = vec!["hunter2".to_owned()];
        assert!("hunter2".len() < PLAIN_CONTAINMENT, "this is the short side of the threshold");
        assert!(!carries("https://shop.example/go?password=xxhunter2xx", &typed), "no boundary, no containment");
        assert!(!carries("https://shop.example/go?password=1hunter22", &typed), "and welded to figures too");
        assert!(carries("https://shop.example/go?password=hunter2", &typed), "whole, it is still found");
        assert!(carries("https://shop.example/go?token=hunter2-9f3a", &typed), "punctuated, it is still found");
    }

    /// **A `+` is a space in a query and a plus sign everywhere else, and an
    /// address is decoded once.** Two copies of the wrong rule: a path segment
    /// decoded the query way turned `/a+b` into `a b`, and decoding what
    /// `query_pairs` had already decoded turned `%2B` into `+` and then into a
    /// space — so a typed `a+b` sent the way a browser sends it was not found.
    #[test]
    fn a_plus_sign_is_decoded_by_the_rules_of_the_piece_it_is_in_and_only_once() {
        let typed = vec!["a+b".to_owned()];
        for carrying in [
            // **How a browser sends it.** A literal plus in a query is `%2B`.
            "https://shop.example/go?password=a%2Bb",
            // And the same characters in a path, where `+` is not a space at all.
            "https://shop.example/reset/a+b",
            "https://shop.example/reset/a%2Bb/confirm",
        ] {
            assert!(carries(carrying, &typed), "{carrying} carries the value that was typed");
        }
        // **And a space is still a space where it is one.**
        assert!(carries("https://shop.example/go?password=a+b", &["a b".to_owned()]), "a + in a query is a space");
        // The double decode this rule used to do, in one line: `%252B` is `%2B`
        // to a server, so `%2B` is what must be looked for, never `+`.
        assert!(!carries("https://shop.example/go?password=a%252Bb", &["a b".to_owned()]), "one decode, not two");
    }

    /// **What the page may say about the typed values, and what it may not.**
    ///
    /// One value per field, and the latest of them: a value replaces the one
    /// before it for that field alone. What a page still cannot do is reach
    /// another field, or take one away — and what it cannot do with any of this is
    /// *send* anything, which is the only direction that would matter.
    #[test]
    fn a_field_keeps_one_value_and_the_page_cannot_take_it_away() {
        let typed = Typed::default();
        typed.record(1, "first".to_owned());
        typed.record(2, "second".to_owned());
        assert_eq!(typed.values(), vec!["first".to_string(), "second".to_string()]);

        // **The same field again is the same field, not a second one.** Three
        // fields typed in turn are three values; one field typed in turn is the
        // last thing in it.
        typed.record(1, "third".to_owned());
        assert_eq!(typed.values(), vec!["third".to_string(), "second".to_string()]);

        // An empty field adds nothing and takes nothing away, so a page cannot
        // empty a password field to make its contents forgettable.
        typed.record(1, String::new());
        assert_eq!(typed.values(), vec!["third".to_string(), "second".to_string()]);

        // And only this side forgets.
        typed.forget();
        assert!(typed.values().is_empty());
    }

    /// **A prefix of a password is not a password, and holding requests for one
    /// takes the site down.** `record` used to keep every keystroke, so typing
    /// `hunter2` left `h`, `hu`, `hun`, `hunt`, … on the list — and `h` is inside
    /// `shop`, `hu` inside `?hub=1`. Those are ordinary addresses on this
    /// computer, and a held read is a page that does not load.
    #[test]
    fn a_prefix_of_what_was_typed_does_not_hold_an_ordinary_address() {
        let typed = Typed::default();
        // **One field, typed one character at a time** -- which is what the page
        // sends: the same handle with a longer value each keystroke.
        for value in ["h", "hu", "hun", "hunt", "hunte", "hunter", "hunter2"] {
            typed.record(1, value.to_owned());
        }
        assert_eq!(typed.values(), vec!["hunter2".to_string()], "one field, one value, the last one");

        // **The whole password is still found**, welded or not: nothing was given
        // up to stop the real thing being found.
        assert!(carries("https://shop.example/go?password=hunter2", &typed.values()));
        assert!(carries("https://shop.example/go?token=hunter2-9f3a", &typed.values()), "punctuated, found");

        // **And every prefix is gone from the addresses it would have held.**
        for ordinary in [
            "https://shop.example/",
            "https://shop.example/hub?a=1",
            "https://shop.example/go?hub=1",
            "https://hun.example/",
            "https://shop.example/hunt/index.html",
            "https://shop.example/go?hunter=1",
            "https://shop.example/go?hunter0=1",
        ] {
            assert!(!carries(ordinary, &typed.values()), "a prefix of the password held an ordinary address: {ordinary}");
        }
    }

    /// **A host is compared folded; nothing else is.** The URL parser lower-cases
    /// a host on the way in, so a page that upper-cases the secret into the name
    /// it dials is sending the same message to the same server and was not found.
    /// A query is compared byte for byte, and folding it would invent a secret
    /// nobody typed.
    #[test]
    fn a_host_is_compared_in_case_and_nothing_else_is() {
        let typed = vec!["Tr0ub4dor".to_owned()];
        assert!(carries("https://TR0UB4DOR.example/", &typed), "a host the parser folded is still the host");
        assert!(carries("https://tr0ub4dor.example/", &typed));
        assert!(!carries("https://shop.example/", &typed), "an ordinary site is not a leak");

        // **Folded, not made less exact**: the same boundaries and the same
        // equality, only without the case.
        assert!(carries("https://tr0ub4dor.example/", &["tr0ub4dor".to_owned()]), "equality is case for a host");
        assert!(carries("https://tr0ub4dors.example/", &typed), "folded containment still finds a secret welded to a label");

        // **A query is not folded, or a secret nobody typed would be found.**
        assert!(carries("https://shop.example/?t=Tr0ub4dor", &typed), "the value as typed is the value");
        assert!(!carries("https://shop.example/?t=TR0UB4DOR", &typed), "a query is byte for byte");
        assert!(!carries("https://shop.example/TR0UB4DOR", &typed), "and so is a path");
    }

    /// The generated JavaScript is the two Rust lists, and no third place to
    /// forget: a type added to one list without the other cannot happen, because
    /// there is only one list.
    #[test]
    fn the_javascript_is_the_two_rust_lists_and_nothing_else() {
        let said = classifier();
        for type_name in SECRET_TYPES {
            assert!(said.contains(&format!("\"{type_name}\"")), "{type_name} is in the predicate: {said}");
        }
        for token in SECRET_AUTOCOMPLETE {
            assert!(said.contains(&format!("\"{token}\"")), "{token} is in the predicate: {said}");
        }
        // A token matches inside a longer list of tokens, which is the drift that
        // let `section-login current-password` through one of the three.
        assert!(said.contains("tokens.includes(token)"), "autocomplete is matched per token: {said}");
        // **And it is a declaration, not a global**: there is nothing on the page
        // for a page to replace before the person types into a password field.
        let declared = classifier_declaration();
        assert!(declared.starts_with("const isSecretField = ("), "{declared}");
        assert!(declared.trim_end().ends_with(";"), "{declared}");
    }

    /// What the person typed is recorded once per field, an empty field records
    /// nothing, and forgetting it is what opening somewhere else does.
    #[test]
    fn what_a_field_is_held_now_survives_a_later_keystroke_and_a_cleared_field() {
        let typed = Typed::default();
        assert!(typed.values().is_empty(), "nothing has been typed yet");
        // **One field, one value, and it is the last thing typed into it.** This
        // used to keep every edit as well -- "h" and "hu" sat beside "hunter2" --
        // and every prefix is a needle short enough to sit inside an ordinary
        // address on this computer.
        // `a_prefix_of_what_was_typed_does_not_hold_an_ordinary_address` is that
        // failure, written down.
        typed.record(0, "hunter2".to_owned());
        typed.record(0, "hunter2".to_owned());
        typed.record(0, "h".to_owned());
        typed.record(0, "hu".to_owned());
        assert_eq!(typed.values(), vec!["hu".to_owned()], "the last thing in the field, and nothing before it");

        typed.record(1, "123456".to_owned());
        assert_eq!(typed.values().len(), 2, "two fields, two values, none lost");

        typed.record(1, String::new());
        assert_eq!(typed.values().len(), 2, "a cleared field takes nothing away either");

        let shared = typed.clone();
        typed.record(2, "later".to_owned());
        assert!(shared.values().contains(&"later".to_owned()), "and every copy sees it");

        typed.forget();
        assert!(typed.values().is_empty(), "a window that opens somewhere else forgets");
    }
}