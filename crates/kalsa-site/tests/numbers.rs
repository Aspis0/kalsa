mod common;

use kalsa_site::{catalog, render, Facts};

use common::{body, generated, html};

#[test]
fn every_benchmark_is_one_sentence_with_its_machine_its_figure_and_its_source() {
    let files = generated();
    for engine in &catalog().engine {
        let page = body(&files, &format!("engines/{}/index.html", engine.id));
        let section = page.split("id=\"benchmarks\"").nth(1).and_then(|rest| rest.split("<h3").next()).unwrap_or_default();
        let rows: Vec<&str> = section.split("<li>").skip(1).collect();
        assert_eq!(rows.len(), engine.benchmark.len(), "{} row count", engine.id);
        for (row, benchmark) in rows.iter().zip(&engine.benchmark) {
            assert!(row.starts_with(&format!("On {} with {}", benchmark.machine, benchmark.model)), "{} names its machine and model", engine.id);
            assert!(row.contains("tok/s") && row.contains(">Source</a>"), "{} has no figure or source", engine.id);
            assert!(!row.contains("Claimed by the author"), "{}", engine.id);
        }
    }
}

#[test]
fn every_card_line_names_its_baseline_and_its_chip_in_plain_words() {
    for (page, text) in html(&generated()) {
        for chunk in text.split("<span class=\"cmpl").skip(1) {
            let line = chunk.split("</span>").next().unwrap_or_default();
            let line = line.trim_start_matches(" weak").trim_start_matches("\">");
            assert!(line.contains(" faster ") || line.contains(" slower ") || line.starts_with("About the same speed"), "{page:?}: {line}");
            assert!(line.contains(" on "), "{page:?}: a card line without its chip: {line}");
        }
    }
}

#[test]
fn a_benchmark_with_both_metrics_shows_both_and_a_small_one_reads_as_about_the_same() {
    let files = generated();
    let mistral = body(&files, "engines/mistral-rs/index.html");
    assert!(mistral.contains("it decodes at 46.8 tok/s, about the same speed as llama.cpp (46.4 tok/s), and it reads prompts at 2947 tok/s, against 2178.5 tok/s for llama.cpp (+35%)"));
    let frink = body(&files, "engines/frink/index.html");
    assert!(frink.contains("it decodes at 157 tok/s, against 149 tok/s for llama.cpp (+5%)"), "5% or more is a gain");
    assert!(frink.contains("it decodes at 190 tok/s, against 116 tok/s for llama.cpp (+64%)"));
    let home = body(&files, "index.html");
    assert!(home.contains("+35% faster prompt reading than llama.cpp on"), "the card leads with the metric that clears 5%");
}

const BOTH: &str = r#"
[[engine]]
id = "both"
name = "Both"
repo = "a/both"
author = "a"
license = "MIT"
kind = "engine"
hardware = ["apple-m1"]
summary = "s"
[[engine.benchmark]]
source = "https://example.invalid/a"
machine = "M1 Max"
chip_tag = "apple-m1"
model = "m"
quant = "Q4"
decode_tok_s = 10.4
prefill_tok_s = 120.0
baseline = "llama.cpp"
baseline_decode_tok_s = 10.0
baseline_prefill_tok_s = 100.0
"#;

#[test]
fn a_both_metrics_fixture_renders_both_metrics_wherever_it_shows_up() {
    let catalog = kalsa_engines::parse(BOTH).expect("the fixture is valid");
    let files = render(&catalog, &Facts::none());
    let developer = body(&files, "dev/a/index.html");
    assert!(developer.contains("prompt reading +20% · decoding about the same"), "the developer page shows both metrics, the larger first");
    assert!(body(&files, "hardware/apple-m1/index.html").contains("+20% faster prompt reading on M1 Max"), "a baseline that is not a catalog engine is never quoted, and never invented");
    let engine = body(&files, "engines/both/index.html");
    assert!(engine.contains("it decodes at 10.4 tok/s, about the same speed as llama.cpp (10 tok/s), and it reads prompts at 120 tok/s, against 100 tok/s for llama.cpp (+20%)"));
    assert!(body(&files, "index.html").contains("+20% faster prompt reading on M1 Max"));
}

#[test]
fn a_card_leads_with_the_metric_that_clears_five_percent_or_says_nothing_does() {
    let files = generated();
    let improvement = "[[engine.improvement]]\nkind = \"new-hardware\"\nsummary = \"s\"\nmachine = \"m\"\nsource = \"https://example.invalid/a\"\n";
    let neither = kalsa_engines::parse(&format!("{}{improvement}", BOTH.replace("decode_tok_s = 10.4", "decode_tok_s = 10.1").replace("prefill_tok_s = 120.0", "prefill_tok_s = 101.0"))).unwrap();
    let rendered = render(&neither, &Facts::none());
    assert!(body(&rendered, "index.html").contains("About the same speed as its baseline on M1 Max"), "neither metric clears 5%");
    assert!(body(&rendered, "dev/a/index.html").contains("<b>No gain over 5% yet</b><span>Range of gains"));
    let mistral_dev = body(&files, "dev/EricLBuehler/index.html");
    assert!(mistral_dev.contains("<b>+35%</b><span>Range of gains"), "one value when low and high are equal, from the metric that clears the bar");
}

#[test]
fn the_listing_line_and_the_empty_benchmark_states_are_plain() {
    let files = generated();
    for id in ["llama-cpp", "frink", "ds4"] {
        assert!(body(&files, &format!("engines/{id}/index.html")).contains("<a class=\"lnk\" href=\"../../listed-and-community/index.html\">Listed</a>: Passed all seven checks."), "{id}");
    }
    assert!(body(&files, "engines/llama-cpp/index.html").contains("Other engines measure themselves against this one, so it has no benchmarks of its own."));
    assert!(body(&files, "engines/ds4/index.html").contains("The author hasn't published benchmarks yet."));
    let home = body(&files, "index.html");
    assert!(home.contains("<span class=\"none\">The reference engine</span>") && home.contains("<span class=\"none\">No benchmarks yet</span>"));
}

#[test]
fn an_engine_with_only_an_aggregate_figure_lists_it_under_what_it_does_better_and_has_no_benchmark_row() {
    let files = generated();
    let locals = body(&files, "engines/locals/index.html");
    let better = locals.split("id=\"better\"").nth(1).expect("Locals does something better");
    assert!(better.contains("271 tok/s aggregate decode across 8 concurrent requests, against 87 tok/s for mlx-lm; total throughput, not the speed of one stream"));
    assert!(better.contains(">Source</a>") && !better.contains("Trade-off"));
    assert!(locals.contains("The author hasn't published benchmarks yet.") && !locals.contains("class=\"plain rows\""));
}
