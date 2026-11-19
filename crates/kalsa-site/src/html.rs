//! The two gates every catalog-derived string passes before it enters HTML.

/// Escapes text, and attribute values, that come from the catalog.
pub fn escape(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(character),
        }
    }
    out
}

fn plain(value: &str) -> bool {
    !value.chars().any(|c| c.is_control() || c.is_whitespace() || matches!(c, '"' | '\'' | '<' | '>' | '\\' | '`'))
}

pub const HELP: &str = "help@kalsa.io";
pub const MAIN: &str = "main@kalsa.io";

/// The only mailto targets that may appear: our own two addresses, exactly. Catalog data never reaches this list.
fn own_mailbox(value: &str) -> bool {
    value.strip_prefix("mailto:").is_some_and(|address| [HELP, MAIN].contains(&address))
}

fn relative_path(value: &str) -> bool {
    let first = value.split(['/', '?', '#']).next().unwrap_or_default();
    !value.starts_with("//") && !first.contains(':')
}

/// The one helper for an href or src built from data: https URLs, our own three mailboxes and our own
/// relative paths are allowed; anything else (javascript:, data:, http:, //host, any other mailto:) becomes "#".
pub fn safe_href(value: &str) -> String {
    let allowed = plain(value)
        && (value.starts_with("https://") && value.len() > 8 || own_mailbox(value) || relative_path(value));
    if allowed { escape(value) } else { "#".to_string() }
}

/// "M1 Max on Llama.cpp (build 3)" to "m1-max-on-llama-cpp-build-3", for URLs.
pub fn slug(text: &str) -> String {
    let mut out = String::new();
    for character in text.chars() {
        if character.is_ascii_alphanumeric() {
            out.push(character.to_ascii_lowercase());
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    out.trim_end_matches('-').to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hostile_hrefs_become_a_dead_anchor() {
        for bad in ["javascript:alert(1)", "JaVaScRiPt:x", "data:text/html,x", "http://a.invalid", "//evil.invalid", "https://", "https://a b", "vbscript:x", "https://a.invalid/\"onmouseover=x"] {
            assert_eq!(safe_href(bad), "#", "{bad}");
        }
    }

    #[test]
    fn our_own_links_pass() {
        assert_eq!(safe_href("https://github.com/a/b"), "https://github.com/a/b");
        assert_eq!(safe_href("../../engines/x/index.html#about"), "../../engines/x/index.html#about");
        assert_eq!(safe_href("mailto:help@kalsa.io"), "mailto:help@kalsa.io");
        assert_eq!(safe_href("mailto:main@kalsa.io"), "mailto:main@kalsa.io");
    }

    #[test]
    fn mailto_is_allowed_only_for_our_two_exact_addresses() {
        for bad in [
            "mailto:evil@example.invalid", "mailto:help@kalsa.io?subject=x", "mailto:help@kalsa.io,evil@example.invalid", "mailto:HELP@kalsa.io",
            "mailto:", "mailto:help@kalsa.io.evil.invalid", "MAILTO:help@kalsa.io", "mailto:xhelp@kalsa.io", "mailto:support@kalsa.io", "kalsa://engine/llama-cpp",
        ] {
            assert_eq!(safe_href(bad), "#", "{bad}");
        }
    }

    #[test]
    fn slugs_are_url_safe() {
        assert_eq!(slug("llama.cpp (build unknown)"), "llama-cpp-build-unknown");
        assert_eq!(slug("M1 Max"), "m1-max");
    }
}
