use std::collections::HashSet;
use std::path::Path;

use kalsa_site::{catalog, render, resolve_href};

fn generated() -> Vec<(std::path::PathBuf, String)> {
    render(&catalog())
}

fn banned(text: &str) -> Vec<&'static str> {
    let lower = text.to_ascii_lowercase();
    let words: Vec<&str> = lower
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|word| !word.is_empty())
        .collect();
    let mut hits = Vec::new();
    for word in ["best", "fastest", "biggest", "safe", "secure", "certified"] {
        if words.contains(&word) { hits.push(word); }
    }
    if lower.contains("top ") { hits.push("top "); }
    hits
}

#[test]
fn every_engine_has_a_page() {
    let catalog = catalog();
    let files = generated();
    for engine in &catalog.engine {
        let path = Path::new("engines").join(&engine.id).join("index.html");
        assert!(files.iter().any(|(name, _)| name == &path), "missing page for {}", engine.id);
    }
    assert!(files.iter().any(|(name, _)| name == Path::new("index.html")));
}

#[test]
fn every_internal_href_resolves() {
    let files = generated();
    let known: HashSet<_> = files.iter().map(|(path, _)| path.clone()).collect();
    for (page, body) in &files {
        if page.extension().and_then(|ext| ext.to_str()) != Some("html") { continue; }
        let mut rest = body.as_str();
        while let Some(at) = rest.find("href=\"") {
            let value = &rest[at + 6..];
            let Some(end) = value.find('"') else { break };
            let href = &value[..end];
            rest = &value[end + 1..];
            if href.starts_with("http://") || href.starts_with("https://") || href.starts_with("mailto:") {
                continue;
            }
            let target = resolve_href(page, href);
            assert!(known.contains(&target), "{page:?} links to missing {target:?} ({href})");
        }
    }
}

#[test]
fn copy_has_no_banned_words_or_emoji() {
    for (page, body) in generated() {
        if page.extension().and_then(|ext| ext.to_str()) != Some("html") { continue; }
        assert!(banned(&body).is_empty(), "{page:?} has banned words: {:?}", banned(&body));
        assert!(
            !body.chars().any(|character| (character as u32) >= 0x1F000),
            "{page:?} has an emoji",
        );
    }
}

#[test]
fn every_benchmark_number_is_claimed() {
    let catalog = catalog();
    let files = generated();
    for engine in &catalog.engine {
        let path = Path::new("engines").join(&engine.id).join("index.html");
        let body = &files.iter().find(|(name, _)| name == &path).unwrap().1;
        let cards: Vec<&str> = body.split("<article class=\"card\">").skip(1).collect();
        assert_eq!(cards.len(), engine.benchmark.len(), "{} card count", engine.id);
        for card in cards {
            assert!(card.contains("Claimed by the author"), "{} has an unclaimed benchmark", engine.id);
            assert!(card.contains("Measured on "), "{} has no chip label", engine.id);
            assert!(card.contains("tok/s") || card.contains("published result"), "{} has no figure", engine.id);
        }
    }
}
