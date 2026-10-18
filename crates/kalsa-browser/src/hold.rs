//! What a request that passed the guard may do next (one responsibility: the
//! decision made about a write, before it reaches anyone).
//!
//! In slice 1 this module refuses. A POST, PUT, PATCH or DELETE — a form post,
//! a `fetch`, an XHR, a `sendBeacon`, a scripted `requestSubmit()` — never
//! leaves the browser, because the person cannot yet be asked about it: the
//! held request and its confirm card arrive in step 4, and until then refusing
//! is the only answer that is not a promise we cannot keep.
//!
//! Step 4 replaces `Refused` with a hold and the same call site becomes the
//! confirm card's. Nothing else moves: the decision is already made in one
//! place, on the method, before dispatch.

#[derive(PartialEq, Eq, Debug)]
pub(crate) enum Verdict {
    Allow,
    Refused,
}

pub(crate) fn verdict(method: &str) -> Verdict {
    if method.eq_ignore_ascii_case("GET") {
        return Verdict::Allow;
    }
    Verdict::Refused
}

/// The one line the model is given when it asks for something that would write.
pub(crate) const REFUSED: &str =
    "that would send something to the site, and Kalsa does not do that yet: fill the field and \
     read the answer instead";

#[cfg(test)]
mod tests {
    use super::verdict;

    fn refused(method: &str) -> bool {
        matches!(verdict(method), super::Verdict::Refused)
    }

    /// Only a read goes out on its own. A HEAD asks for no body but still asks
    /// the site to do the work of answering, so it is refused with the writes.
    #[test]
    fn only_a_get_is_allowed_through_in_slice_one() {
        for method in ["GET", "get"] {
            assert!(!refused(method), "{method} is the one read");
        }
        for method in [
            "HEAD", "head", "POST", "post", "PUT", "PATCH", "DELETE", "OPTIONS", "TRACE", "CONNECT",
            "",
        ] {
            assert!(refused(method), "{method} is not the one read");
        }
    }

    #[test]
    fn the_refusal_names_what_it_is_and_names_no_address() {
        assert!(crate::hold::REFUSED.contains("does not do that yet"));
        assert!(!crate::hold::REFUSED.contains("http"));
    }
}