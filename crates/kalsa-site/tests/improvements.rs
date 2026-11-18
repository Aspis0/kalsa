mod common;

use std::path::{Path};

use common::{body, generated, html};

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
fn an_engine_page_lists_its_improvements_with_tag_machine_source_and_trade_off() {
    let files = generated();
    let ds4 = body(&files, "engines/ds4/index.html");
    let section = ds4.split("id=\"improvements\"").nth(1).expect("ds4 has an Improvements section");
    for line in DS4_LINES {
        assert!(section.contains(line), "{line}");
    }
    for tag in ["Bigger models", "Multiple machines", "New hardware"] {
        assert!(section.contains(&format!("<span class=\"tg imp\">{tag}</span>")), "{tag}");
    }
    assert!(section.contains("81 GiB model on 128 GB of memory, 34.36 tok/s") && section.contains("M5 Max, 128 GB"));
    assert!(section.contains("href=\"https://github.com/antirez/ds4/blob/main/docs/CUDA_MULTI_GPU.md\">Source</a>"));
    assert!(section.contains("<b>Trade-off.</b> The 126 tok/s is total throughput across sessions, not the speed of one user."));
    assert!(ds4.contains("<a href=\"#improvements\">Improvements</a>"));
    assert!(!body(&files, "engines/llama-cpp/index.html").contains("id=\"improvements\""), "a reference with nothing declared has no section");
}

#[test]
fn speed_gains_are_listed_beside_the_declared_improvements() {
    let files = generated();
    let frink = body(&files, "engines/frink/index.html");
    let section = frink.split("id=\"improvements\"").nth(1).expect("frink shows its speed gain");
    assert!(section.contains("<span class=\"tg imp\">Faster decode</span>") || section.contains("<span class=\"tg imp\">Faster prefill</span>"));
    assert!(section.contains("Claimed by the author."));
    assert!(!section.contains("within noise"), "a difference under 5% is not listed");
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
fn the_engines_page_filters_by_improvement_with_only_kinds_that_exist() {
    let files = generated();
    let page = body(&files, "engines/index.html");
    assert!(page.contains("id=\"imp\"") && page.contains("<option value=\"bigger-models\">Bigger models</option>"));
    assert!(!page.contains("<option value=\"energy\">"), "no engine declares an energy improvement yet");
    let json = body(&files, "engines/engines.json");
    assert!(json.contains("\"improvements\":[\"bigger-models\",\"multi-machine\",\"new-hardware\"]"));
    let js = std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../site/static/filters.js")).unwrap();
    assert!(js.contains("row.improvements.indexOf(state.imp)") && js.contains("document.getElementById('imp').value = 'all'"));
}

#[test]
fn a_hardware_family_page_shows_larger_models_only_where_data_exists() {
    let files = generated();
    let m5 = body(&files, "hardware/apple-m5/index.html");
    assert!(m5.contains("Larger models on this hardware") && m5.contains("177.77 GiB on 128 GB, 11.9 tok/s"));
    assert!(m5.contains("DeepSeek Flash Q2") && m5.contains("GLM 5.3 Flash Q4_K") && m5.contains("The expert weights are read from the SSD"));
    assert!(!body(&files, "hardware/apple-m1/index.html").contains("Larger models on this hardware"));
    assert!(!body(&files, "hardware/nvidia/index.html").contains("Larger models on this hardware"), "the nvidia row is not a bigger-models claim");
}
