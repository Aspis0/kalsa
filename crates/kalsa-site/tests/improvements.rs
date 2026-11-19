mod common;

use std::path::Path;

use common::{body, generated, html, visible};

#[test]
fn the_filter_assets_hide_cards_and_clear_hardware() {
    let css = std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../site/static/base.css")).unwrap();
    assert!(css.contains("[hidden]{display:none!important}"), "a hidden card must really disappear");
    let js = std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../site/static/filters.js")).unwrap();
    assert!(js.contains("function fresh()") && !js.contains("Object.assign({}, start"), "clearing builds a new state");
}

const DS4_LINES: [&str; 4] = [
    "DeepSeek Flash at 2-bit, about 81 GiB, decodes at 34.36 tok/s with a 32,768-token context on a 128 GB Mac",
    "GLM 5.3 Flash at Q4_K, 177.77 GiB and larger than the 128 GB of memory, runs from the SSD at 11.9–14.9 tok/s (three-run median, 2K prompt plus 1K append, 128 generated tokens)",
    "Two 128 GB Macs linked over RDMA run DeepSeek V4 Flash Q4 or MXFP4, or GLM 5.3 Flash Q4, with tensor parallelism that splits the experts between them",
    "DeepSeek V4 Flash runs on eight NVIDIA L40S cards (Ada Lovelace) at about 126 tok/s aggregate with 16 sessions; the author says other implementations of these models need newer GPUs",
];

#[test]
fn an_engine_page_lists_what_it_does_better_with_its_trade_off_and_source() {
    let files = generated();
    let ds4 = body(&files, "engines/ds4/index.html");
    let section = ds4.split("id=\"better\"").nth(1).expect("ds4 has a What it does better section");
    assert!(section.starts_with(">What it does better</h3>"));
    for line in DS4_LINES {
        assert!(section.contains(line), "{line}");
    }
    assert!(section.contains("href=\"https://github.com/antirez/ds4/blob/main/docs/CUDA_MULTI_GPU.md\">Source</a>"));
    assert!(section.contains("<p class=\"trade\">Trade-off: the 126 tok/s is total throughput across sessions, not the speed of one user.</p>"));
    assert!(!section.contains("Claimed by the author") && !section.contains("<span class=\"tg imp\">"), "plain sentences, no tags");
    assert!(!body(&files, "engines/llama-cpp/index.html").contains("id=\"better\""), "an engine that declares nothing has no section");
}

#[test]
fn speed_gains_live_in_the_benchmarks_and_not_in_what_it_does_better() {
    let files = generated();
    let frink = body(&files, "engines/frink/index.html");
    assert!(!frink.contains("id=\"better\"") && frink.contains("id=\"benchmarks\""));
    assert!(!visible(frink).contains("within noise"), "the old noise label is gone");
}

#[test]
fn a_card_shows_at_most_three_improvement_tags_in_plain_words() {
    let files = generated();
    for (page, text) in html(&files) {
        for card in text.split("<a class=\"card\"").skip(1) {
            let card = card.split("</a>").next().unwrap_or_default();
            assert!(card.matches("<span class=\"tg imp\">").count() <= 3, "{page:?}");
        }
    }
    let engines = body(&files, "engines/index.html");
    assert!(engines.contains("<span class=\"tg imp\">Bigger models</span><span class=\"tg imp\">Multiple machines</span><span class=\"tg imp\">New hardware</span>"));
}

#[test]
fn the_engines_page_has_no_improvement_filter_but_cards_keep_their_tags() {
    let files = generated();
    let page = body(&files, "engines/index.html");
    assert!(!page.contains("id=\"imp\"") && !page.contains("Any improvement"), "the improvement filter is gone");
    assert!(page.contains("<span class=\"tg imp\">Bigger models</span>"), "what an engine improves is still on its card");
    let json = body(&files, "engines/engines.json");
    assert!(!json.contains("\"improvements\""), "the script no longer filters by improvement");
    let js = std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../site/static/filters.js")).unwrap();
    assert!(!js.contains("imp"), "the script has no state for a filter that does not exist");
}

#[test]
fn a_speed_row_shows_its_caveat_and_omlx_names_its_requirements() {
    let files = generated();
    let omlx = body(&files, "engines/omlx/index.html");
    let section = omlx.split("id=\"benchmarks\"").nth(1).expect("oMLX has benchmarks");
    assert!(section.contains("it reads prompts at 3000 tok/s, against 1060 tok/s for This Mac alone (2.8×)"));
    assert!(section.contains("Note: ") && section.contains("Remote Login turned on in System Settings") && section.contains("The feature is experimental."));
    assert!(!omlx.contains("<span class=\"tg imp\">Multiple machines</span>"), "the model is not split");
}

#[test]
fn apple_m6_is_a_chip_family_with_its_own_page_and_filter() {
    let files = generated();
    let page = body(&files, "hardware/apple-m6/index.html");
    assert!(page.contains("Engines for Apple M6") && page.contains("SwiftLM"));
    assert!(body(&files, "engines/index.html").contains("data-hw=\"apple-m6\">Apple M6</button>"));
    assert!(body(&files, "engines/swiftlm/index.html").contains("Apple M1–M6"));
    assert!(!body(&files, "engines/omlx/index.html").contains("Apple M1–M6"), "its README lists M1 to M5 only");
    assert!(!body(&files, "engines/vmlx/index.html").contains("Apple M1–M6"), "its README lists M1 to M4 in a badge");
}
