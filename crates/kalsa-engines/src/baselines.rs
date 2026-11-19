//! Which catalog engine a benchmark's free-text baseline names, so pages can say "than llama.cpp" and never quote the author's wording.

use crate::Engine;

const FILLER: [&str; 4] = ["stock", "mainline", "upstream", "official"];

/// "stock mlx-lm 0.31.3" and "llama.cpp (build unknown)" read as "mlx-lm" and "llama.cpp".
fn core(baseline: &str) -> String {
    let mut without_notes = String::new();
    let mut depth = 0;
    for character in baseline.to_lowercase().chars() {
        match character {
            '(' => depth += 1,
            ')' if depth > 0 => depth -= 1,
            _ if depth == 0 => without_notes.push(character),
            _ => {}
        }
    }
    let words: Vec<&str> = without_notes.split_whitespace().collect();
    let start = words.iter().take_while(|word| FILLER.contains(word)).count();
    let end = words.iter().rposition(|word| !word.starts_with(|c: char| c.is_ascii_digit())).map_or(start, |last| last + 1);
    words[start..end.max(start)].join(" ")
}

/// Letters and digits only, so "llama.cpp" and the id "llama-cpp" read the same.
fn squashed(text: &str) -> String {
    text.chars().filter(char::is_ascii_alphanumeric).collect::<String>().to_lowercase()
}

fn only_one(found: Vec<&Engine>, baseline: &str) -> Result<Option<String>, String> {
    match found.as_slice() {
        [] => Ok(None),
        [engine] => Ok(Some(engine.name.clone())),
        several => Err(format!("baseline {baseline:?} could be any of {}", several.iter().map(|engine| engine.id.as_str()).collect::<Vec<_>>().join(", "))),
    }
}

/// The display name of the engine the baseline is, or None when it is anything else ("This Mac alone", "feature off").
/// An exact catalog id wins; a name or repository name counts only when exactly one entry carries it.
pub(crate) fn engine_named(baseline: &str, engines: &[Engine]) -> Result<Option<String>, String> {
    let wanted = core(baseline);
    if wanted.is_empty() {
        return Ok(None);
    }
    let by_id: Vec<&Engine> = engines.iter().filter(|engine| squashed(&engine.id) == squashed(&wanted)).collect();
    if !by_id.is_empty() {
        return only_one(by_id, baseline);
    }
    let by_name = engines
        .iter()
        .filter(|engine| engine.name.to_lowercase() == wanted || engine.repo.rsplit('/').next().is_some_and(|name| name.to_lowercase() == wanted))
        .collect();
    only_one(by_name, baseline)
}

#[cfg(test)]
mod tests {
    use super::core;

    #[test]
    fn filler_versions_and_notes_are_dropped() {
        assert_eq!(core("stock mlx-lm 0.31.3"), "mlx-lm");
        assert_eq!(core("llama.cpp (build unknown)"), "llama.cpp");
        assert_eq!(core("upstream MTPLX 2.12.2"), "mtplx");
        assert_eq!(core("mainline llama.cpp"), "llama.cpp");
        assert_eq!(core("stock 0.1.40.2"), "");
        assert_eq!(core("upstream 9ab7053"), "");
        assert_eq!(core("This Mac alone"), "this mac alone");
    }
}
