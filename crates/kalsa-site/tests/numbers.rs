mod common;

use kalsa_site::{catalog, render, Facts};

use common::{HOSTILE, body, generated, html};

#[test]
fn every_benchmark_number_is_claimed_and_names_its_chip() {
    let files = generated();
    for engine in &catalog().engine {
        let page = body(&files, &format!("engines/{}/index.html", engine.id));
        let blocks: Vec<&str> = page.split("<div class=\"bc").skip(1).collect();
        assert_eq!(blocks.len(), engine.benchmark.len(), "{} card count", engine.id);
        for block in blocks {
            let block = block.split("<h3").next().unwrap_or(block);
            assert!(block.contains("Claimed by the author"), "{} has an unclaimed benchmark", engine.id);
            assert!(block.contains("Measured on "), "{} has no chip label", engine.id);
            assert!(block.contains("tok/s"), "{} has no figure", engine.id);
        }
    }
}

#[test]
fn every_comparison_chip_on_a_card_is_tagged_and_names_its_chip() {
    for (page, text) in html(&generated()) {
        let markers = ["<div class=\"cmp\">", "<div class=\"cmp weak\">", "<div class=\"cmp flat\">", "<div class=\"cmp flat weak\">"];
        for chunk in markers.iter().flat_map(|marker| text.split(marker).skip(1)) {
            let head = &chunk[..chunk.find("</div>").unwrap_or(chunk.len())];
            assert!(head.contains("Measured on "), "{page:?}: a comparison without its chip");
            assert!(head.contains("decode ") || head.contains("prefill "), "{page:?}: a comparison that does not say decode or prefill");
            assert!(head.contains(" vs "), "{page:?}: a comparison without its baseline");
        }
    }
}

#[test]
fn no_page_carries_a_review_badge_until_the_catalog_has_a_review() {
    let files = generated();
    assert!(!html(&files).any(|(_, text)| text.contains("bpill reviewed")));
    assert!(!files.iter().any(|(path, _)| path.starts_with("badge")));
}

#[test]
fn a_newer_commit_turns_a_review_into_a_pending_re_check() {
    let catalog = kalsa_engines::parse(HOSTILE).expect("the fixture is valid");
    let current = Facts::parse(r#"{"evil/hostile":{"latest_commit":"a1b2c3d9999"}}"#).unwrap();
    let newer = Facts::parse(r#"{"evil/hostile":{"latest_commit":"ffff000aaaa"}}"#).unwrap();
    assert!(body(&render(&catalog, &current), "engines/hostile/index.html").contains("bpill reviewed"));
    let pending = render(&catalog, &newer);
    let page = body(&pending, "engines/hostile/index.html");
    assert!(page.contains("re-check pending") && !page.contains("bpill reviewed"));
}

#[test]
fn a_benchmark_with_both_metrics_shows_both_labelled_and_a_small_one_is_noise() {
    let files = generated();
    let mistral = body(&files, "engines/mistral-rs/index.html");
    assert!(mistral.contains("<b>Decode</b><span class=\"g num noise\">+1%, within noise</span>"), "a 1% decode is muted and labelled");
    assert!(mistral.contains("<b>Prefill</b><span class=\"g num\">+35%</span>"), "a 35% prefill is shown normally");
    let frink = body(&files, "engines/frink/index.html");
    assert!(frink.contains("<b>Decode</b><span class=\"g num\">+5%</span>"), "5% or more is a gain, shown normally");
    assert!(!frink.contains("+5%, within noise"));
    let home = body(&files, "index.html");
    assert!(home.contains("<span class=\"mg\">prefill +35%</span> · <span class=\"mg noise\">decode +1%, within noise</span>"), "the home feed leads with the metric that clears 5% and shows the other second");
    assert!(home.contains("<span class=\"g num\">+35%</span>"), "mistral.rs leads with its prefill gain");
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
fn a_both_metrics_fixture_renders_both_labels_on_every_page_that_shows_it() {
    let catalog = kalsa_engines::parse(BOTH).expect("the fixture is valid");
    let files = render(&catalog, &Facts::none());
    for path in ["hardware/apple-m1/index.html", "dev/a/index.html", "index.html"] {
        let page = body(&files, path);
        assert!(page.contains("decode +4%, within noise"), "{path}: decode label");
        assert!(page.contains("prefill +20%"), "{path}: prefill label");
    }
    let engine = body(&files, "engines/both/index.html");
    assert!(engine.contains("<b>Decode</b><span class=\"g num noise\">+4%, within noise</span>"));
    assert!(engine.contains("<b>Prefill</b><span class=\"g num\">+20%</span>"));
}

#[test]
fn a_card_leads_with_the_metric_that_clears_five_percent_or_says_nothing_does() {
    let files = generated();
    let improvement = "[[engine.improvement]]\nkind = \"new-hardware\"\nsummary = \"s\"\nmachine = \"m\"\nsource = \"https://example.invalid/a\"\n";
    let neither = kalsa_engines::parse(&format!("{}{improvement}", BOTH.replace("decode_tok_s = 10.4", "decode_tok_s = 10.1").replace("prefill_tok_s = 120.0", "prefill_tok_s = 101.0"))).unwrap();
    let rendered = render(&neither, &Facts::none());
    let home = body(&rendered, "index.html");
    assert!(home.contains("No gain above noise published"), "neither metric clears 5%");
    assert!(body(&rendered, "dev/a/index.html").contains("<b>No gain above noise published</b><span>Range of published gains"));
    let mistral_dev = body(&files, "dev/EricLBuehler/index.html");
    assert!(mistral_dev.contains("<b>+35%</b><span>Range of published gains"), "one value when low and high are equal, from the metric that clears the bar");
}

#[test]
fn the_listing_panel_does_not_promise_a_benchmark_to_a_reference_engine() {
    let files = generated();
    assert!(!body(&files, "engines/llama-cpp/index.html").contains("a published same-machine benchmark"));
    assert!(body(&files, "engines/llama-cpp/index.html").contains("baseline others are measured against"));
    assert!(body(&files, "engines/frink/index.html").contains("a published same-machine benchmark"));
}

#[test]
fn an_engine_with_only_an_aggregate_figure_shows_it_as_an_improvement_and_no_comparison() {
    let files = generated();
    let locals = body(&files, "engines/locals/index.html");
    assert!(locals.contains("87 to 271 tok/s aggregate, 8 concurrent requests") && locals.contains("<span class=\"tg imp\">Parallel throughput</span>"));
    assert!(locals.contains("No comparison has been published.") && !locals.contains("<div class=\"bc"));
    assert!(!files.iter().any(|(path, _)| path.starts_with("compare/locals")));
}
