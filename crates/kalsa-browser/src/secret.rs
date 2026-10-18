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

    /// Records what is in one field now. An empty value is a field that was
    /// cleared, which is not a secret with nothing in it.
    pub fn record(&self, field: u64, value: String) {
        let mut typed = self.0.lock().expect("the typed values are not poisoned");
        typed.retain(|(held, _)| *held != field);
        if !value.is_empty() {
            typed.push((field, value));
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
    if typed.is_empty() {
        return false;
    }
    let Ok(parsed) = url::Url::parse(url) else {
        return false;
    };
    let mut parts: Vec<String> = parsed.path_segments().into_iter().flatten().map(percent_decode).collect();
    for (name, value) in parsed.query_pairs() {
        parts.push(percent_decode(&name));
        parts.push(percent_decode(&value));
    }
    parts.iter().any(|part| typed.iter().any(|secret| !secret.is_empty() && secret == part))
}

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
    fn one_value_per_field_and_never_one_per_keystroke() {
        let typed = Typed::default();
        assert!(typed.values().is_empty(), "nothing has been typed yet");
        typed.record(0, "h".to_owned());
        typed.record(0, "hu".to_owned());
        typed.record(0, "hunter2".to_owned());
        assert_eq!(typed.values(), vec!["hunter2".to_owned()], "the value half-typed is gone");

        typed.record(1, "123456".to_owned());
        assert_eq!(typed.values(), vec!["hunter2".to_owned(), "123456".to_owned()], "two fields, two values");
        typed.record(1, String::new());
        assert_eq!(typed.values(), vec!["hunter2".to_owned()], "a cleared field is not a secret with nothing in it");

        let shared = typed.clone();
        typed.record(2, "later".to_owned());
        assert!(shared.values().contains(&"later".to_owned()), "and every copy sees it");

        typed.forget();
        assert!(typed.values().is_empty(), "a window that opens somewhere else forgets");
    }
}