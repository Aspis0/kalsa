//! The webview's own line on the log: a stable code for one failure the
//! person is already reading on screen.
//!
//! The page never sends a sentence. A sentence shown to the owner can quote a
//! conversation title, an answer or a file name, and the log promises none of
//! those ever reach it; the page therefore sends a code, and this module is
//! the only writer of the `ui:` line. The shape check is the second lock on
//! the same door: a bug or a hostile page that hands over prose gets the
//! fixed refusal line instead, never the prose.
//!
//! The code is the app's own vocabulary (`chat.slot_hold_expired`,
//! `chat.attach_failed`, `chat.turn_network`), minted where the sentence is
//! chosen in `chat/src`, so one grep finds both ends of a report line.

/// The longest code the log writes. Long enough for a dotted path, short
/// enough that no runaway string can spend the log's cap on one line.
const CODE_MAX: usize = 64;

/// What a code may be made of, and all of it: lowercase letters, digits,
/// dots and underscores — the sentence case has no way in, and neither does
/// a newline, a path separator or a quote.
fn code_is_valid(code: &str) -> bool {
    !code.is_empty()
        && code.len() <= CODE_MAX
        && code.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'.' || byte == b'_'
        })
}

/// The one line a UI event writes: the code, or nothing of what was sent.
pub(crate) fn event_line(code: &str) -> String {
    if code_is_valid(code) {
        format!("ui: {code}")
    } else {
        "ui: refused_code".to_string()
    }
}

/// The page's request for a line: the code of the sentence it just showed.
/// Fire and forget; an invalid code costs one fixed line and never the
/// caller's text.
#[tauri::command]
pub(crate) fn brain_log_event(code: String) {
    log::info!("{}", event_line(&code));
}

/// A page-load URL as the log writes it: the address without its query or
/// fragment. A reload URL can carry a device port or a dev-server token, and
/// neither is a fact a report needs.
pub(crate) fn page_url(url: &str) -> String {
    url.split(['?', '#']).next().unwrap_or(url).to_string()
}

/// One page load, named for the report: which load of this process it is
/// (`1` is the app start; a later one is a reload), the event, the window and
/// the address without its query.
pub(crate) fn page_line(loads: u64, event: &str, label: &str, url: &str) -> String {
    format!("webview page {event} #{loads} {label} {}", page_url(url))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_valid_code_is_the_whole_line() {
        assert_eq!(
            event_line("chat.slot_hold_expired"),
            "ui: chat.slot_hold_expired"
        );
    }

    #[test]
    fn a_sentence_sent_as_a_code_never_reaches_the_line() {
        let sentence = "Kalsa non ha potuto aprire questa conversazione. Riprova.";
        let line = event_line(sentence);
        assert_eq!(line, "ui: refused_code");
        assert!(!line.contains("Kalsa"), "{line}");
        assert!(!line.contains("conversazione"), "{line}");
        // The other shapes a runaway string can take.
        for bad in [
            "Chat.Slot",
            "chat slot",
            "chat.slot\nforged",
            "chat/slot",
            "\u{e9}",
            "",
        ] {
            assert_eq!(event_line(bad), "ui: refused_code", "{bad:?}");
        }
        let long = "a".repeat(CODE_MAX + 1);
        assert_eq!(event_line(&long), "ui: refused_code");
        let at_max = "a".repeat(CODE_MAX);
        assert_eq!(event_line(&at_max), format!("ui: {at_max}"));
    }

    #[test]
    fn a_page_line_counts_the_load_and_drops_the_query() {
        let line = page_line(2, "started", "main", "tauri://localhost/index.html?token=SECRET#x");
        assert_eq!(line, "webview page started #2 main tauri://localhost/index.html");
        assert!(!line.contains("SECRET"), "{line}");
        assert!(!line.contains('?'), "{line}");
        assert_eq!(
            page_line(1, "finished", "main", "http://127.0.0.1:8131/a?k=v"),
            "webview page finished #1 main http://127.0.0.1:8131/a"
        );
    }
}
