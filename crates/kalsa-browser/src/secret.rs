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

/// The installable form: the predicate, named. What the catcher needs, because
/// the catcher runs before anything else on every document.
pub(crate) fn classifier_script() -> String {
    format!("window.__kalsaPasswords = {};", classifier())
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
    /// **Add-only, on this side of the wire.** The page can add; it cannot remove
    /// and it cannot overwrite. That is the whole reason this list is here and
    /// not asked of the page: a page that empties the list to cover its tracks,
    /// or points one field's handle at a value nobody typed, is describing
    /// itself, and a description is not evidence. Both values stay, so what a
    /// person really typed is still what is checked — and a field edited twice
    /// leaves both edits, because both were typed.
    ///
    /// An empty value is a field that was cleared, which is not a secret with
    /// nothing in it: it adds nothing, and it takes nothing away.
    pub fn record(&self, field: u64, value: String) {
        if value.is_empty() {
            return;
        }
        let mut typed = self.0.lock().expect("the typed values are not poisoned");
        // The same value again is a keystroke, not a second secret.
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
    // **A secret too short to mean anything is not one.** A one- or two-character
    // value appears inside almost every address on this computer, and a check
    // that fires on all of them is a check nobody reads — so it is refused at the
    // start rather than after it has held every request the page made.
    let secrets: Vec<&String> = typed.iter().filter(|secret| secret.chars().count() >= MIN_SECRET).collect();
    if secrets.is_empty() {
        return false;
    }
    let Ok(parsed) = url::Url::parse(url) else {
        return false;
    };
    // **Everywhere a server would look, and nowhere it would not.** The host, the
    // path and the query are all sent; the fragment is not — it lives in the
    // browser — so a secret that only appears after a `#` never left this
    // computer and is not this function's business.
    let mut parts: Vec<String> = Vec::new();
    if let Some(host) = parsed.host_str() {
        parts.push(host.to_owned());
    }
    parts.extend(parsed.path_segments().into_iter().flatten().map(percent_decode));
    for (name, value) in parsed.query_pairs() {
        parts.push(percent_decode(&name));
        parts.push(percent_decode(&value));
    }
    // **Containment, not equality.** A secret does not travel as one whole piece:
    // it is a value inside a bigger one, a base64 blob with a prefix, a path
    // segment with the value welded to an id. Equality with the whole part would
    // pass all three, and all three are the same mail to a stranger's server.
    parts.iter().any(|part| secrets.iter().any(|secret| part.contains(secret.as_str())))
}

/// How long a typed value has to be before it can be looked for in an address.
/// Four is short enough for the shortest thing anybody keeps a secret for and
/// long enough that a search for it means something.
pub const MIN_SECRET: usize = 4;

/// What a server sees of one `%`-escaped piece of an address.
fn percent_decode(value: &str) -> String {
    let replaced = value.replace('+', " ");
    percent_encoding::percent_decode_str(&replaced).decode_utf8_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::{carries, classifier, classifier_script, Typed, SECRET_AUTOCOMPLETE, SECRET_TYPES};

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
    fn a_secret_shorter_than_four_characters_is_not_looked_for() {
        let short = vec!["ab".to_owned()];
        assert!(!carries("https://shop.example/go?password=ab", &short));
        assert!(!carries("https://ab.example/", &short));
        // The same value at four is, because at four it means something.
        assert!(carries("https://shop.example/go?password=abcd", &["abcd".to_owned()]));
    }

    /// **What the page may say about the typed values, and what it may not.**
    ///
    /// The list is this side's evidence, so it is add-only: the page can add and
    /// it cannot take anything away, replace one value with another, or smuggle a
    /// value in that nobody typed. Everything it told us is still on the list,
    /// which is what makes it worth asking the route on every request.
    #[test]
    fn the_page_can_add_a_typed_value_and_neither_replace_nor_take_one_away() {
        let typed = Typed::default();
        typed.record(1, "first".to_owned());
        typed.record(2, "second".to_owned());
        assert_eq!(typed.values(), vec!["first".to_string(), "second".to_string()]);

        // The same field again is a keystroke, not a second secret.
        typed.record(1, "first".to_owned());
        assert_eq!(typed.values(), vec!["first".to_string(), "second".to_string()]);

        // A different value for a field somebody already typed is **added**, not
        // swapped in: both were typed, and the old one is still a secret.
        typed.record(1, "third".to_owned());
        assert_eq!(typed.values(), vec!["first".to_string(), "second".to_string(), "third".to_string()]);

        // An empty value is a cleared field: it adds nothing and takes nothing.
        typed.record(1, String::new());
        assert_eq!(typed.values(), vec!["first".to_string(), "second".to_string(), "third".to_string()]);

        // And only this side forgets.
        typed.forget();
        assert!(typed.values().is_empty());
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
        assert!(classifier_script().starts_with("window.__kalsaPasswords = ("));
        assert!(classifier_script().trim_end().ends_with(";"));
    }

    /// What the person typed is recorded once, an empty field records nothing,
    /// and forgetting it is what opening somewhere else does.
    #[test]
    fn what_a_field_is_held_now_survives_a_later_keystroke_and_a_cleared_field() {
        let typed = Typed::default();
        assert!(typed.values().is_empty(), "nothing has been typed yet");
        // **Both halves stay.** This used to keep only the last value per field,
        // which meant a page could empty the list simply by typing something else
        // into the same field — and the list is this side's evidence, so a page
        // gets no say in it. What the person really typed is still what is
        // looked for; the only thing a keystroke does is arrive again unchanged.
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