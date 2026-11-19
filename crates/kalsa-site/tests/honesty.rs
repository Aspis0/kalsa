mod common;

use kalsa_site::{catalog, render, Facts};

use common::{body, generated, html, visible};

const RISK: &str = "The engine runs with your user's permissions. macOS doesn't sandbox it, so install only engines you trust.";

#[test]
fn every_engine_page_warns_that_the_engine_runs_with_your_permissions() {
    let files = generated();
    for engine in &catalog().engine {
        let page = body(&files, &format!("engines/{}/index.html", engine.id));
        let install = page.split("id=\"install\"").nth(1).unwrap_or_default();
        assert!(install.contains(RISK), "{} lacks the install warning", engine.id);
    }
}

#[test]
fn only_a_recommended_engine_says_it_passed_all_seven_checks() {
    let files = generated();
    let (mut recommended, mut declined) = (0, 0);
    for engine in &catalog().engine {
        let page = body(&files, &format!("engines/{}/index.html", engine.id));
        let listing = page.split("id=\"listing\"").nth(1).and_then(|rest| rest.split("<h3").next()).unwrap_or_default();
        if engine.recommendable {
            recommended += 1;
            assert!(listing.contains("Listed</a>: Passed all seven checks."), "{}", engine.id);
        } else {
            declined += 1;
            assert!(listing.contains("Listed</a>, but we don't recommend it"), "{} says what applies to it", engine.id);
            assert!(!listing.contains("Passed all seven checks"), "{}", engine.id);
        }
    }
    assert!(recommended > 30 && declined >= 1, "the check covers both kinds of entry");
    assert!(body(&files, "engines/neutronstar/index.html").contains("but we don't recommend it: ~0.4 tok/s generation"));
}

#[test]
fn no_page_keeps_the_old_vocabulary_for_benchmarks() {
    for (page, text) in html(&generated()) {
        let shown = visible(text);
        for old in ["Published comparisons", "All claimed by the author", "Claimed by the author", "within noise", "No gain above noise published", "Your Mac", "same chip"] {
            assert!(!shown.contains(old), "{page:?} still says {old:?}");
        }
    }
}

#[test]
fn the_community_tier_is_described_as_coming_and_has_no_filter() {
    let files = generated();
    let engines = body(&files, "engines/index.html");
    assert!(!engines.contains("id=\"listing\"") && !engines.contains(">Community</button>"));
    assert!(!body(&files, "engines/engines.json").contains("\"listing\""));
    let js = std::fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../site/static/filters.js")).unwrap();
    assert!(!js.contains("listing"), "the script has no state for a filter that does not exist");
    for path in ["submit/index.html", "listed-and-community/index.html"] {
        assert!(visible(body(&files, path)).contains("opens soon"), "{path} says community listing opens soon");
    }
    let submit = visible(body(&files, "submit/index.html"));
    assert!(submit.contains("You will list your own engine") && submit.contains("It will appear in the Community section"), "future tense on the submit page");
}

/// Every comparison line a card prints, with the page it is on.
fn card_lines(files: &common::Files) -> Vec<(String, String)> {
    let mut lines = Vec::new();
    for (page, text) in html(files) {
        for chunk in text.split("<span class=\"cmpl").skip(1) {
            let line = chunk.split("</span>").next().unwrap_or_default().trim_start_matches(" weak").trim_start_matches("\">");
            lines.push((page.to_string_lossy().into_owned(), line.to_string()));
        }
    }
    lines
}

/// The words after "than" or "as" and before the last " on ", or None when the line names no baseline.
fn named_baseline(line: &str) -> Option<&str> {
    let rest = [" than ", " as "].iter().find_map(|marker| line.split(marker).nth(1))?;
    Some(rest.rsplit_once(" on ").map_or(rest, |(name, _)| name))
}

const ABLATIONS: [&str; 7] = ["engramhalo", "lidenburg-llama-cpp", "thecodacus-expert-cache", "neutronstar", "qvac-fabric", "stew675-rdna-boosts", "turbo-tan-llama-cpp-tq3"];
const OTHER_BASELINES: [&str; 10] = [
    "dmlx", "kapitsa", "tandem-cpp", "selfref-llama-cpp-rdna", "rocmforge", "raymond-kv-streaming", "neurall-llama-cpp", "ingenious-ds4-m3", "architectds-strata", "omlx",
];

#[test]
fn every_card_line_names_a_catalog_engine_a_feature_switched_off_or_nothing() {
    let files = generated();
    let names: Vec<String> = catalog().engine.iter().map(|engine| engine.name.clone()).collect();
    let lines = card_lines(&files);
    assert!(lines.len() > 100, "the check reaches many cards");
    for (page, line) in &lines {
        for bad in ["build unknown", "This Mac alone", "feature off", "stock ", "upstream ", "reference"] {
            assert!(!line.contains(bad), "{page}: {line}");
        }
        if let Some(baseline) = named_baseline(line) {
            assert!(baseline == "without it" || baseline == "its baseline" || baseline == "with or without it" || names.iter().any(|name| name == baseline), "{page} names {baseline:?}: {line}");
        }
    }
    let home = body(&files, "index.html");
    assert!(home.contains("+47% faster decoding than llama.cpp on M2 Pro"));
    for (page, line) in &lines {
        assert!(line.contains(" faster ") || line.contains(" slower ") || line.starts_with("About the same speed"), "{page}: not one of the three forms: {line}");
    }
}

#[test]
fn without_it_is_said_only_of_the_seven_genuine_ablations() {
    let files = generated();
    let catalog = catalog();
    let card = |id: &str| -> String {
        let engine = catalog.engine.iter().find(|engine| engine.id == id).unwrap_or_else(|| panic!("{id}"));
        let card = body(&files, "engines/index.html").split(&format!("data-id=\"{id}\"")).nth(1).and_then(|rest| rest.split("</a>").next()).unwrap_or_else(|| panic!("{}", engine.id));
        card.split("<span class=\"cmpl").nth(1).and_then(|rest| rest.split("</span>").next()).unwrap_or_default().to_string()
    };
    for id in ABLATIONS {
        let engine = catalog.engine.iter().find(|engine| engine.id == id).unwrap();
        assert!(engine.benchmark.iter().all(|benchmark| benchmark.feature_off), "{id} marks every row as a feature switched off");
        assert!(card(id).contains("than without it on"), "{id}");
    }
    for id in OTHER_BASELINES {
        let engine = catalog.engine.iter().find(|engine| engine.id == id).unwrap();
        assert!(!engine.benchmark.iter().any(|benchmark| benchmark.feature_off), "{id} is not an ablation");
        let shown = card(id);
        assert!(!shown.contains("without it") && !shown.contains(" than "), "{id} invents a baseline: {shown}");
    }
    let marked = catalog.engine.iter().flat_map(|engine| &engine.benchmark).filter(|benchmark| benchmark.feature_off).count();
    assert_eq!(marked, 8, "eight rows in seven entries, and no other");
    for (page, text) in html(&files) {
        assert!(!visible(text).contains("against without it"), "{page:?}");
    }
}

const SLOWER: &str = r#"
[[engine]]
id = "slow"
name = "Slow"
repo = "a/slow"
author = "a"
license = "MIT"
kind = "engine"
hardware = ["apple-m1"]
summary = "Runs something."
[[engine.benchmark]]
source = "https://example.invalid/a"
machine = "M1 Max"
chip_tag = "apple-m1"
model = "m"
quant = "Q4"
decode_tok_s = 8.0
prefill_tok_s = 101.0
baseline = "feature off"
baseline_decode_tok_s = 10.0
baseline_prefill_tok_s = 100.0
[[engine.improvement]]
kind = "new-hardware"
summary = "Runs here."
machine = "m"
source = "https://example.invalid/a"
"#;

#[test]
fn a_feature_switched_off_is_the_only_baseline_a_card_words_as_without_it() {
    let marked = SLOWER.replace("baseline = \"feature off\"", "baseline = \"feature off\"\nfeature_off = true");
    let files = render(&kalsa_engines::parse(&marked).expect("the fixture is valid"), &Facts::none());
    assert!(body(&files, "index.html").contains("20% slower decoding than without it on M1 Max"));
}

#[test]
fn a_loss_of_five_percent_or_more_is_never_called_about_the_same() {
    let catalog = kalsa_engines::parse(SLOWER).expect("the fixture is valid");
    let files = render(&catalog, &Facts::none());
    let home = body(&files, "index.html");
    assert!(home.contains("20% slower decoding on M1 Max"), "a 20% loss leads over a 1% prefill difference, and a baseline that is only text stays out");
    assert!(!home.contains("About the same speed"));
}

#[test]
fn a_description_promises_only_what_the_page_shows() {
    let files = generated();
    for engine in &catalog().engine {
        let page = body(&files, &format!("engines/{}/index.html", engine.id));
        let description = page.split("<meta name=\"description\" content=\"").nth(1).and_then(|rest| rest.split('"').next()).unwrap_or_default();
        assert_eq!(description.contains("its benchmarks"), !engine.benchmark.is_empty(), "{}: {description}", engine.id);
        assert_eq!(description.contains("what it does better"), !engine.improvement.is_empty(), "{}: {description}", engine.id);
    }
    let engines = body(&files, "engines/index.html");
    assert!(engines.contains("filtered by chip, licence or what it does better") && !engines.contains("content=\"Every engine and fork in the Kalsa catalog, with its licence and the benchmarks"));
}
