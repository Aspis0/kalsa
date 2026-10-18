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
    /// **Add-only, and that is not a preference.** The catcher sends values over
    /// `window.__kalsaTyped`, which is on the page and which the page can call.
    /// So **a page-callable path must never remove or replace what a person
    /// typed**: the attack is one call carrying the handle of the field the person
    /// used and an innocent value, and the real password then leaves in the next
    /// request with nothing on this list to stop it. One value per field, the
    /// latest replacing the last, was tried here, and it is exactly that hole.
    ///
    /// What it costs is the keystrokes: typing a password leaves its prefixes
    /// beside it, and a prefix of four characters or more is inside ordinary
    /// addresses, so a paused window can hold a request it did not need to.
    /// **That is cheap, and only there**: this list is asked about while the
    /// window is paused, and a paused navigation carrying what the person typed
    /// goes out only where the person already is -- so the failure is a question
    /// to the person, never a request a page gets sent. Trimming the prefixes is
    /// not available: every value here arrives by a path the page drives, so
    /// anything dropped here would be something a page could drop too.
    ///
    /// The same value again is a keystroke, not a second secret, and skipping it
    /// removes nothing.
    pub fn record(&self, field: u64, value: String) {
        if value.is_empty() {
            return;
        }
        let mut typed = self.0.lock().expect("the typed values are not poisoned");
        if typed.iter().any(|(held, already)| *held == field && *already == value) {
            return;
        }
        typed.push((field, value));
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
/// it would hold every request the page made. So containment asks about
/// [`MIN_SECRET`] and up.
///
/// **And it asks nothing about where the value stands.** There used to be a
/// boundary rule above four characters — the characters either side had to be
/// punctuation — and it was the wrong answer, because of the seam it leaves: a
/// letter on either side *is* a boundary, so `x` + secret + `x` has one on both
/// sides and beats the rule completely. While a window is paused it is the page's
/// own script that writes the request, and it picks what the secret is written
/// next to, so a boundary rule was a rule the page chooses to obey. Plain
/// containment has no such seam, and a false positive here only holds a request
/// for the person to answer, while a false negative is the secret on its way to
/// somebody else's server.
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
        // **Inside, from [`MIN_SECRET`] up, anywhere at all.** Four characters is
        // the only bar left: below it a value sits inside nearly every address on
        // this computer, and above it the page would have to write the secret in
        // the open to make the search miss.
        part.contains(secret.as_str()) && secret.chars().count() >= MIN_SECRET
    })
}

/// How long a typed value has to be before it can be **looked for inside** a
/// part of a message. Four is short enough for the shortest thing anybody keeps
/// a secret for and long enough that a search for it means something.
///
/// **This is about containment alone**, and it is the only bar: a value that *is*
/// a whole part of an address — the whole of a query value, the whole of a path
/// segment — is the person's own thing leaving, and is asked about at any length.
/// A three-digit bank code is short enough to sit inside every address on this
/// computer and still exactly what it is when it is the whole of one; inside one,
/// four characters is where looking becomes worth the false holds. See
/// [`part_carries`].
pub const MIN_SECRET: usize = 4;

/// What a server sees of one `%`-escaped **path** segment. A path has no rule
/// that makes `+` a space, so this does not invent one.
fn percent_decode(value: &str) -> String {
    percent_encoding::percent_decode_str(value).decode_utf8_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::{carries, classifier, classifier_declaration, part_carries, Typed, MIN_SECRET, SECRET_AUTOCOMPLETE, SECRET_TYPES};

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

    /// **A value too short to mean anything inside a part is the whole of a part,
    /// and nothing else.** Two or three characters sits inside nearly every
    /// address on this computer, so looking for it inside one would fire on all of
    /// them -- but a value *being* a whole query value or path segment is still the
    /// person's own thing leaving, and is asked about at any length.
    #[test]
    fn a_value_too_short_to_mean_anything_inside_a_part_is_the_whole_of_one_and_nothing_else() {
        let short = vec!["482".to_owned()];
        for carrying in [
            "https://shop.example/go?code=482",
            "https://shop.example/verify/482",
            "https://shop.example/go?code=482&next=cart",
            "https://shop.example/go?code=%34%38%32",
        ] {
            assert!(carries(carrying, &short), "the whole of a part is the value: {carrying}");
        }

        // **Inside another value, three characters is not looked for at all.**
        let two = vec!["ab".to_owned()];
        assert!(!carries("https://shop.example/go?password=abcde", &two));
        assert!(!carries("https://shop.example/go?password=xaby", &two));
        assert!(!carries("https://ab.example/", &two));

        // **And the bar is the length and nothing else.** Four is looked for
        // anywhere inside a part, welded on both sides like any other value --
        // there is no shape it has to take.
        assert_eq!(MIN_SECRET, 4, "four characters is where containment starts");
        assert!(carries("https://shop.example/go?password=abcd", &["abcd".to_owned()]));
        assert!(carries("https://shop.example/go?password=xxabcdxx", &["abcd".to_owned()]), "welded to letters on both sides");
    }

    /// **One rule, asked about one piece at a time** — which is how the guard
    /// asks about a form field's name and about a body's own bytes, and how
    /// every piece of an address is asked about. Equality at any length,
    /// containment from [`super::MIN_SECRET`] up and nowhere else, and a value
    /// the person never typed is not a secret that matches everything.
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

    /// **Containment asks nothing about where the value stands.** A typed `test`
    /// is found in `latest` and in `attestation.pdf`, and that is the trade.
    ///
    /// A boundary rule looked like the careful answer and was the wrong one,
    /// because of the seam it leaves: a letter on either side *is* a boundary, so
    /// `x` + secret + `x` has one on both sides and beats it completely. While a
    /// window is paused it is the page's own script that writes the request, and
    /// it picks what the secret is written next to -- so a boundary rule was a
    /// rule the page chooses to obey, and it protected nobody.
    ///
    /// **What the false positives cost is bounded by where this is asked.** It
    /// decides whether a request is *held*; it runs only while the window is
    /// paused; and a paused navigation carrying what the person typed goes out only
    /// where the person already is. So the price of `latest` being held is a
    /// question to the person, and never a request a page gets sent.
    #[test]
    fn a_secret_is_looked_for_anywhere_inside_a_part_from_four_characters_on() {
        let typed = vec!["test".to_owned()];
        for found in [
            // **The welded shapes, which the boundary rule walked past.**
            "https://shop.example/latest",
            "https://shop.example/go?x=testing",
            "https://shop.example/go?password=x2testx",
            "https://shop.example/go?t=1test2",
            // And the shapes a real secret travels in.
            "https://shop.example/go?token=test-9f3a",
            "https://shop.example/api/v2/test/session",
            "https://test.shop.example/",
            "https://shop.example/go?password=test%21",
            "https://shop.example/go?code=test",
        ] {
            assert!(carries(found, &typed), "{found} carries what the person typed");
        }
        // **And the bar below it is the length**: two characters is still equality.
        assert!(!carries("https://shop.example/go?password=xaby", &["ab".to_owned()]));
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

    /// **A page can add a typed value, and it can do nothing else.**
    ///
    /// Add-only, and that is the whole point of it: the binding the catcher sends
    /// values over is on the page, so the page can call it. The attack is one call
    /// carrying the handle of the field the person used and an innocent value -- and
    /// the real password then leaves in the next request with nothing on the list
    /// to stop it. One value per field, the latest replacing the last, was tried
    /// here, and **that is the attack**, so it is not what this does.
    #[test]
    fn a_later_call_for_the_same_field_cannot_remove_an_earlier_value() {
        let typed = Typed::default();
        typed.record(1, "the-password".to_owned());
        typed.record(2, "second".to_owned());
        assert_eq!(typed.values(), vec!["the-password".to_string(), "second".to_string()]);

        // The same value again is a keystroke, not a second secret.
        typed.record(1, "the-password".to_owned());
        assert_eq!(typed.values().len(), 2, "the same value adds nothing and removes nothing");

        // **The page's version of the attack**: the handle of the field the person
        // used, with an innocent value.
        typed.record(1, "not-the-password".to_owned());
        assert!(
            typed.values().contains(&"the-password".to_string()),
            "the real value is still here after a page called the binding: {:?}",
            typed.values()
        );

        // A cleared field adds nothing and takes nothing away.
        typed.record(1, String::new());
        assert!(typed.values().contains(&"the-password".to_string()), "and cannot erase it either");

        // Only this side forgets, and that is opening somewhere else.
        typed.forget();
        assert!(typed.values().is_empty());
    }

    /// **Every prefix stays, and the cost is a held request.** A password typed one
    /// character at a time leaves its prefixes on the list, and from four characters
    /// on they are looked for inside ordinary addresses -- `pass` is in
    /// `passenger`, `hunt` in `hunting`.
    ///
    /// That was tried the other way round: one value per field, the latest
    /// replacing the last, and the prefixes gone. **It cannot be done** -- every
    /// value on this list arrives over a binding the page can call, so anything
    /// dropped here is something a page could drop too, and the price of dropping
    /// is the person's password leaving unseen. So the prefixes stay and the false
    /// holds are paid for where they are cheap: only while the window is paused,
    /// and only for a request held rather than sent.
    #[test]
    fn a_prefix_of_what_was_typed_is_held_too_and_nothing_a_page_says_removes_it() {
        let typed = Typed::default();
        let whole = "passphrase9f3a";
        // One field, typed one character at a time, which is what the page sends.
        for at in 1..=whole.len() {
            typed.record(1, whole[..at].to_owned());
        }
        assert_eq!(typed.values().len(), whole.len(), "every keystroke the person made is still here");

        // **The finished password is found, welded or not** -- nothing was given up
        // to stop the real thing being found.
        assert!(carries("https://shop.example/go?password=passphrase9f3a", &typed.values()));
        assert!(carries("https://shop.example/go?t=xxpassphrase9f3axx", &typed.values()));

        // **And a prefix holds an ordinary address**, which is the cost, stated here
        // rather than discovered later.
        assert!(carries("https://shop.example/passenger/list", &typed.values()), "a four-letter prefix holds an ordinary page");
        assert!(carries("https://shop.example/go?passenger=1", &typed.values()));
        // **Below four characters nothing is looked for at all**, so the cost is set
        // by the length of the password, not by how many keystrokes it took.
        assert!(!carries("https://shop.example/pastry", &typed.values()), "three characters is equality only");

        // **Which is exactly why nothing may shrink the list.**
        typed.record(1, "p".to_owned());
        assert_eq!(typed.values().len(), whole.len(), "the same value again is a keystroke, not a second secret");
        typed.record(1, "quiet".to_owned());
        assert!(
            typed.values().contains(&whole.to_owned()),
            "and a page cannot take the password off the list: {:?}",
            typed.values()
        );
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

    /// What the person typed is recorded once, an empty field records nothing,
    /// and forgetting it is what opening somewhere else does.
    #[test]
    fn what_a_field_is_held_now_survives_a_later_keystroke_and_a_cleared_field() {
        let typed = Typed::default();
        assert!(typed.values().is_empty(), "nothing has been typed yet");
        // **Both halves stay.** This used to keep only the last value per field,
        // and that is what a page-callable binding must not be able to do: one
        // call with the field's handle and an innocent value would erase the
        // password from the list and the next request would carry it out unseen.
        // The finished value and the halves of it are all still here.
        typed.record(0, "hunter2".to_owned());
        typed.record(0, "hunter2".to_owned());
        typed.record(0, "h".to_owned());
        typed.record(0, "hu".to_owned());
        assert_eq!(
            typed.values(),
            vec!["hunter2".to_owned(), "h".to_owned(), "hu".to_owned()],
            "the finished value and both halves of it are all still here"
        );

        typed.record(1, "123456".to_owned());
        assert_eq!(typed.values().len(), 4, "two fields, four values, none lost");

        typed.record(1, String::new());
        assert_eq!(typed.values().len(), 4, "a cleared field takes nothing away either");

        let shared = typed.clone();
        typed.record(2, "later".to_owned());
        assert!(shared.values().contains(&"later".to_owned()), "and every copy sees it");

        typed.forget();
        assert!(typed.values().is_empty(), "a window that opens somewhere else forgets");
    }
}