//! The assistant's two eyes on the internet: one search, one page fetch.
//!
//! Both return the text a language model will read, already bounded and
//! truncated with a marker, and both fail as a sentence rather than a panic.
//! Nothing here knows about chat, tools or Tauri. Both take a stop flag, which
//! the caller sets when the user presses Stop: it is checked between the steps
//! of a call, so a sequence of requests ends at the next step rather than
//! running to its end.
//!
//! The one rule that matters: neither will open an address the webview's
//! content security policy exists to keep out. Text is refused unless it is a
//! publicly routable host over http or https, every redirect is re-checked
//! before it is followed, and — because a boring name can resolve to this
//! machine — the address a request actually connects to is resolved and
//! checked first (see [`url`](crate)).

mod body;
mod exa;
mod failure;
mod fetch;
mod search;
mod text;
mod url;

pub use fetch::fetch;
pub use search::search;

/// The most one request may take, however slowly the server feeds it. A read
/// timeout alone is not a bound: `ureq` applies it per read, so a page that
/// dribbles a byte at a time reaches it only on the first byte. Measured live
/// 2026-09-19: a 20 kB trickle ran past sixty seconds with only per-read
/// timeouts set.
pub(crate) const REQUEST_BUDGET: std::time::Duration = std::time::Duration::from_secs(30);

/// Why a web request did not produce text. [`Display`](std::fmt::Display) is
/// the sentence the user and the model read; it is the only place these are
/// phrased.
#[derive(Debug, PartialEq, Eq)]
pub enum WebError {
    /// The address is not a public web page: wrong scheme, a private or
    /// loopback host, or a host that resolves to one.
    Refused,
    /// The search service answered with a refusal of its own, in its words.
    Provider(String),
    /// The user stopped the call before it finished.
    Stopped,
    /// The request ran past its deadline, whatever the server was doing.
    Timeout,
    /// The response was larger than this crate reads at once, so it cannot be
    /// trusted to be whole.
    Oversize,
    /// The server answered, but not with a body this crate can read.
    Unsupported,
    /// The server answered with a status that is not success.
    Status(u16),
    /// The request never got an answer: DNS, TLS, timeout, connection reset.
    Network,
}

impl std::fmt::Display for WebError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            WebError::Refused => f.write_str(
                "That address is not a public web page. Only http and https addresses on the \
                 public internet can be opened.",
            ),
            WebError::Provider(message) => {
                write!(f, "The search service refused the search: {message}")
            }
            WebError::Stopped => f.write_str("That was stopped before it finished."),
            WebError::Timeout => f.write_str(
                "That address took too long to answer. It may be slow or busy; try again, or try \
                 another address.",
            ),
            WebError::Oversize => {
                f.write_str("The answer was larger than this app reads at once, so it was dropped.")
            }
            WebError::Unsupported => f.write_str(
                "That address returned something other than a web page, so there is no text to \
                 read.",
            ),
            WebError::Status(429) => f.write_str(
                "That service is refusing this computer for now. Try again in a minute.",
            ),
            WebError::Status(code) => write!(f, "The server answered {code}."),
            WebError::Network => {
                f.write_str("That address could not be reached. Check the connection and try again.")
            }
        }
    }
}
