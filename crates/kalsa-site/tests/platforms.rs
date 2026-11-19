mod common;

use kalsa_engines::{chip_generation, family_label, Engine, FAMILIES};
use kalsa_site::catalog;

use common::{body, generated};

fn platform(tag: &str) -> String {
    if chip_generation(tag).is_some() { "Apple".to_string() } else { family_label(tag) }
}

fn on_platform(engine: &Engine, tag: &str) -> bool {
    engine.benchmark.iter().any(|benchmark| benchmark.gains.headline().is_some() && platform(&benchmark.chip_tag) == platform(tag) && (chip_generation(tag).is_some() || benchmark.chip_tag == tag))
}

/// The empty-state line a card must carry on a page for `tag`, or None when the card shows a number or its own state.
fn expected(engine: &Engine, tag: &str) -> Option<String> {
    if !engine.recommendable || engine.benchmark.is_empty() && engine.kind == kalsa_engines::Kind::Reference || on_platform(engine, tag) {
        return None;
    }
    Some(if engine.benchmark.is_empty() { "No benchmarks yet".to_string() } else { format!("No benchmarks on {} yet", platform(tag)) })
}

fn card_of<'a>(page: &'a str, id: &str) -> &'a str {
    page.split(&format!("data-id=\"{id}\"")).nth(1).and_then(|rest| rest.split("</a>").next()).unwrap_or_else(|| panic!("no card for {id}"))
}

fn runs_on(engine: &Engine, tag: &str) -> bool {
    engine.hardware.iter().any(|candidate| candidate == tag)
}

#[test]
fn every_engine_on_every_platform_page_says_what_it_lacks_in_the_platforms_name() {
    let files = generated();
    let catalog = catalog();
    let mut lines = 0;
    for tag in FAMILIES {
        let slug = tag.to_string();
        let page = body(&files, &format!("hardware/{slug}/index.html"));
        let home = body(&files, "index.html").split(&format!("data-panel=\"{tag}\"")).nth(1).and_then(|rest| rest.split("data-panel=").next()).expect("a home panel").to_string();
        for engine in catalog.engine.iter().filter(|engine| runs_on(engine, tag)) {
            for (place, html) in [("chip page", page), ("home panel", home.as_str())] {
                let card = card_of(html, &engine.id);
                match expected(engine, tag) {
                    Some(line) => {
                        assert!(card.contains(&format!("<span class=\"none\">{line}</span>")), "{} on the {place} for {tag}: wanted {line:?}", engine.id);
                        lines += usize::from(line.starts_with("No benchmarks on"));
                    }
                    None => assert!(!card.contains("No benchmarks on") && !card.contains("No benchmarks yet") || !engine.recommendable, "{} on the {place} for {tag}", engine.id),
                }
            }
        }
    }
    assert!(lines > 0, "some cards name a platform they lack");
}

#[test]
fn pages_that_are_not_for_one_platform_keep_the_plain_line() {
    let files = generated();
    for page in ["engines/index.html", "dev/EricLBuehler/index.html"] {
        assert!(!body(&files, page).contains("No benchmarks on"), "{page}");
    }
    assert!(body(&files, "engines/index.html").contains("No benchmarks yet"), "an engine with none keeps the plain line");
}
