use std::collections::HashSet;
use std::path::{Path, PathBuf};

use kalsa_site::{catalog, render, resolve_href, write_site, Facts};

type Files = Vec<(PathBuf, String)>;

fn generated() -> Files {
    render(&catalog(), &Facts::none())
}

fn html(files: &Files) -> impl Iterator<Item = &(PathBuf, String)> {
    files.iter().filter(|(path, _)| path.extension().and_then(|extension| extension.to_str()) == Some("html"))
}

fn body<'a>(files: &'a Files, path: &str) -> &'a str {
    &files.iter().find(|(name, _)| name == Path::new(path)).unwrap_or_else(|| panic!("missing page {path}")).1
}

fn banned(text: &str) -> Vec<&'static str> {
    let lower = text.to_ascii_lowercase();
    let words: Vec<&str> = lower.split(|c: char| !c.is_ascii_alphanumeric()).filter(|word| !word.is_empty()).collect();
    let mut hits: Vec<&'static str> = ["best", "fastest", "biggest", "strongest", "leading", "safe", "secure", "certified"]
        .into_iter()
        .filter(|word| words.contains(word))
        .collect();
    if lower.contains("top ") {
        hits.push("top ");
    }
    hits
}

/// The text a reader sees: everything outside tags, scripts and styles.
fn visible(page: &str) -> String {
    let mut out = String::new();
    let mut inside = false;
    for character in page.chars() {
        match character {
            '<' => inside = true,
            '>' => inside = false,
            _ if !inside => out.push(character),
            _ => {}
        }
    }
    out
}

#[test]
fn every_engine_has_a_page_and_every_section_exists() {
    let files = generated();
    for engine in &catalog().engine {
        assert!(files.iter().any(|(name, _)| name == &Path::new("engines").join(&engine.id).join("index.html")), "missing page for {}", engine.id);
    }
    for path in [
        "index.html", "engines/index.html", "engines/engines.json", "hardware/index.html", "compare/index.html",
        "how-we-choose/index.html", "submit/index.html", "download/index.html", "sitemap.xml", "static/filters.js", "static/site.js",
    ] {
        body(&files, path);
    }
}

#[test]
fn hardware_pages_cover_families_and_every_chip_a_benchmark_names() {
    let files = generated();
    for slug in ["apple-m1", "apple-m5", "nvidia", "amd", "intel", "cpu", "apple-m1-max", "apple-m2-pro", "apple-m3-ultra", "apple-m5-max"] {
        let page = body(&files, &format!("hardware/{slug}/index.html"));
        assert!(page.contains("Listed engines only"), "{slug} must say it shows listed engines only");
    }
    assert!(body(&files, "hardware/apple-m1-max/index.html").contains("Measured on M1 Max, same chip"));
}

#[test]
fn every_developer_has_a_page() {
    let files = generated();
    for engine in &catalog().engine {
        let login = engine.repo.split('/').next().unwrap();
        assert!(body(&files, &format!("dev/{login}/index.html")).contains(&engine.name), "{login} page lacks {}", engine.name);
    }
}

#[test]
fn compare_pages_exist_only_for_published_pairs() {
    let files = generated();
    let catalog = catalog();
    let pages: Vec<&PathBuf> = files.iter().map(|(path, _)| path).filter(|path| path.starts_with("compare") && path != &Path::new("compare/index.html")).collect();
    assert!(!pages.is_empty());
    for path in pages {
        let folder = path.parent().unwrap().file_name().unwrap().to_str().unwrap();
        let engine = catalog.engine.iter().find(|engine| folder.starts_with(&format!("{}-vs-", engine.id))).unwrap_or_else(|| panic!("{folder} is not an engine pair"));
        assert!(engine.benchmark.iter().any(|b| b.baseline_decode_tok_s.is_some() || b.baseline_prefill_tok_s.is_some()), "{} has no published baseline", engine.id);
        assert!(body(&files, path.to_str().unwrap()).contains("Claimed by the author"));
    }
    assert!(!files.iter().any(|(path, _)| path.starts_with("compare/llama-cpp-vs")), "a reference engine has no pair of its own");
}

#[test]
fn every_internal_href_and_src_resolves() {
    let files = generated();
    let known: HashSet<PathBuf> = files.iter().map(|(path, _)| path.clone()).collect();
    for (page, text) in html(&files) {
        for attribute in ["href=\"", "src=\""] {
            let mut rest = text.as_str();
            while let Some(at) = rest.find(attribute) {
                let value = &rest[at + attribute.len()..];
                let Some(end) = value.find('"') else { break };
                let target = &value[..end];
                rest = &value[end + 1..];
                if target.starts_with("https://") || target.starts_with("mailto:") || target == "#" {
                    continue;
                }
                let resolved = resolve_href(page, target);
                let ok = resolved.as_os_str().is_empty() || known.contains(&resolved);
                assert!(ok, "{page:?} links to missing {resolved:?} ({target})");
            }
        }
    }
}

#[test]
fn copy_has_no_banned_words_or_emoji() {
    for (page, text) in html(&generated()) {
        let shown = visible(text);
        assert!(banned(&shown).is_empty(), "{page:?} has banned words: {:?}", banned(&shown));
        assert!(!text.chars().any(|character| (character as u32) >= 0x1F000), "{page:?} has an emoji");
    }
}

#[test]
fn every_page_says_kalsa_is_not_affiliated() {
    for (page, text) in html(&generated()) {
        assert!(text.contains("Kalsa is not affiliated with the authors of the listed projects."), "{page:?}");
    }
}

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
fn the_home_page_has_no_gain_sorted_list() {
    let files = generated();
    let home = body(&files, "index.html");
    let feed = home.split("id=\"comparisons\"").nth(1).and_then(|rest| rest.split("</section>").next()).expect("comparisons section");
    let names: Vec<String> = feed.split("<div class=\"fz\"><b>").skip(1).map(|part| part.split("</b>").next().unwrap().to_lowercase()).collect();
    assert!(names.len() > 3, "the home page shows published comparisons");
    let mut sorted = names.clone();
    sorted.sort();
    assert_eq!(names, sorted, "the comparisons are listed A to Z, not by gain");
    for phrase in ["Biggest", "high to low", "Top gains", "Leaderboard"] {
        assert!(!home.contains(phrase), "{phrase}");
    }
    assert!(body(&files, "engines/index.html").contains("Name, A to Z") && !body(&files, "engines/index.html").contains("high to low"));
}

#[test]
fn stars_and_updates_show_only_when_github_facts_exist() {
    let without = generated();
    assert!(!body(&without, "engines/frink/index.html").contains("<dt>Stars</dt>"));
    let facts = Facts::parse(r#"{"antonellof/frink":{"stars":1234,"pushed":"2026-11-10"}}"#).unwrap();
    let with = render(&catalog(), &facts);
    let page = body(&with, "engines/frink/index.html");
    assert!(page.contains("<dt>Stars</dt><dd>1.2k</dd>") && page.contains("2026-11-10"));
    assert!(!body(&with, "engines/llama-cpp/index.html").contains("<dt>Stars</dt>"), "no invented numbers for other repos");
}

#[test]
fn the_engines_json_lists_every_engine() {
    let files = generated();
    let json = body(&files, "engines/engines.json");
    for engine in &catalog().engine {
        assert!(json.contains(&format!("\"id\":\"{}\"", engine.id)), "{}", engine.id);
    }
}

#[test]
fn the_sitemap_names_every_page_at_its_shared_address() {
    let files = generated();
    let sitemap = body(&files, "sitemap.xml");
    assert!(sitemap.contains("<loc>https://kalsa.io/engines/frink</loc>") && sitemap.contains("<loc>https://kalsa.io/</loc>"));
    assert_eq!(sitemap.matches("<url>").count(), html(&files).count());
}

#[test]
fn no_page_carries_a_review_badge_until_the_catalog_has_a_review() {
    let files = generated();
    assert!(!html(&files).any(|(_, text)| text.contains("bpill reviewed")));
    assert!(!files.iter().any(|(path, _)| path.starts_with("badge")));
}

const HOSTILE: &str = r#"
[[engine]]
id = "hostile"
name = "x\" onmouseover=\"alert(1)"
repo = "evil/hostile"
author = "<img src=x onerror=alert(1)>"
license = "MIT"
kind = "engine"
hardware = ["cpu"]
summary = "<script>alert(1)</script>"
[[engine.benchmark]]
source = "https://example.invalid/a"
machine = "<b>machine</b>"
chip_tag = "cpu"
model = "m"
quant = "Q4"
decode_tok_s = 10.0
baseline = "<i>b</i>"
baseline_decode_tok_s = 5.0
[engine.review]
commit = "a1b2c3d"
date = "2026-11-18"
upstream = "evil/up"
"#;

#[test]
fn hostile_catalog_text_is_escaped_in_text_and_attributes() {
    let catalog = kalsa_engines::parse(HOSTILE).expect("the fixture is valid");
    let files = render(&catalog, &Facts::none());
    for (page, text) in html(&files) {
        assert!(!text.contains("<script>alert"), "{page:?} has a live script");
        assert!(!text.contains("<img src=x"), "{page:?} has a live image");
        assert!(!text.contains("<b>machine</b>") && !text.contains("<i>b</i>"), "{page:?}");
        assert!(!text.contains("onmouseover=\"alert"), "{page:?} has an injected attribute");
    }
    assert!(body(&files, "engines/hostile/index.html").contains("&lt;script&gt;alert(1)&lt;/script&gt;"));
    assert!(files.iter().any(|(path, text)| path == Path::new("badge/hostile.svg") && text.contains("reviewed a1b2c3d")));
}

#[test]
fn hostile_sources_and_ids_are_rejected_at_validation() {
    let source = HOSTILE.replace("https://example.invalid/a", "javascript:alert(1)");
    assert!(kalsa_engines::parse(&source).unwrap_err().contains("benchmark source must be an https URL"));
    let id = HOSTILE.replace("id = \"hostile\"", "id = \"../evil\"");
    assert!(kalsa_engines::parse(&id).unwrap_err().contains("id must be"));
}

#[test]
fn the_writer_refuses_paths_that_leave_the_output_directory() {
    let out = std::env::temp_dir().join(format!("kalsa-site-writer-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&out);
    for bad in ["../escape.html", "/etc/escape.html", "a/../../escape.html"] {
        let files = vec![(PathBuf::from(bad), "x".to_string())];
        assert!(write_site(&files, &out).is_err(), "{bad} must be refused");
    }
    assert!(!out.parent().unwrap().join("escape.html").exists());
    let fine = vec![(PathBuf::from("a/b/index.html"), "ok".to_string())];
    assert_eq!(write_site(&fine, &out), Ok(1));
    assert_eq!(std::fs::read_to_string(out.join("a/b/index.html")).unwrap(), "ok");
    let _ = std::fs::remove_dir_all(&out);
}

#[test]
fn hrefs_resolve_without_their_fragment_or_query() {
    assert_eq!(resolve_href(Path::new("engines/x/index.html"), "../../how-we-choose/index.html#removal"), PathBuf::from("how-we-choose/index.html"));
    assert_eq!(resolve_href(Path::new("index.html"), "engines/index.html?hw=apple-m1"), PathBuf::from("engines/index.html"));
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

fn mailtos(text: &str) -> Vec<&str> {
    text.split("href=\"mailto:").skip(1).map(|rest| rest.split('"').next().unwrap_or_default()).collect()
}

#[test]
fn mailto_links_are_only_ever_our_three_addresses_and_never_catalog_data() {
    let files = generated();
    for (page, text) in html(&files) {
        for address in mailtos(text) {
            assert!(["help@kalsa.io", "support@kalsa.io", "main@kalsa.io"].contains(&address), "{page:?} has mailto:{address}");
        }
    }
    let hostile = HOSTILE.replace("summary = \"<script>alert(1)</script>\"", "summary = \"mailto:evil@example.invalid\"").replace("name = \"x\\\" onmouseover=\\\"alert(1)\"", "name = \"mailto:evil@example.invalid\"");
    let catalog = kalsa_engines::parse(&hostile).expect("the fixture is valid");
    for (page, text) in html(&render(&catalog, &Facts::none())) {
        assert!(!text.contains("href=\"mailto:evil"), "{page:?} turned catalog text into a mailto link");
    }
}

#[test]
fn the_contact_addresses_sit_where_the_owner_put_them() {
    let files = generated();
    for (page, text) in html(&files) {
        assert!(text.contains("href=\"mailto:main@kalsa.io\">Contact: main@kalsa.io"), "{page:?} footer contact");
    }
    for path in ["engines/frink/index.html", "dev/antonellof/index.html"] {
        let page = body(&files, path);
        assert!(page.contains("href=\"mailto:help@kalsa.io\">help@kalsa.io") && page.contains("issues/new?title=Removal%20request%3A%20"), "{path}");
    }
    assert!(body(&files, "how-we-choose/index.html").contains("mailto:help@kalsa.io"));
    assert!(body(&files, "submit/index.html").contains("mailto:help@kalsa.io"));
    assert!(body(&files, "download/index.html").contains("mailto:support@kalsa.io"));
}

#[test]
fn install_claims_are_made_only_for_engines_with_an_install_recipe() {
    let files = generated();
    let catalog = catalog();
    for engine in &catalog.engine {
        let page = body(&files, &format!("engines/{}/index.html", engine.id));
        let rows = page.split("id=\"install\"").nth(1).unwrap_or_default();
        if engine.install.is_some() {
            assert!(rows.contains("sha256") || rows.contains("locked packages") || rows.contains("lock file"), "{} shows its pinned recipe", engine.id);
            assert!(rows.contains("Where it goes") && rows.contains("Uninstall"));
        } else {
            for claim in ["pinned", "checksum", "Where it goes", "Uninstall", "Who can reach it"] {
                assert!(!rows.contains(claim), "{} claims {claim:?} without a recipe", engine.id);
            }
            assert!(rows.contains("isn't available yet") && rows.contains(&format!("github.com/{}", engine.repo)), "{}", engine.id);
        }
    }
    for path in ["index.html", "download/index.html", "submit/index.html"] {
        let text = visible(body(&files, path));
        assert!(!text.contains("One click, as usual") && !text.contains("installs the engine you"), "{path}");
        assert!(text.contains("llama.cpp and mlx-lm"), "{path} names the two installable engines");
    }
}

#[test]
fn there_is_no_open_in_kalsa_button_until_the_app_registers_the_scheme() {
    for (page, text) in html(&generated()) {
        assert!(!text.contains("kalsa://") && !text.contains("Open in Kalsa"), "{page:?}");
    }
    assert!(body(&generated(), "engines/frink/index.html").contains(">Get the app<"));
}

#[test]
fn the_listing_panel_does_not_promise_a_benchmark_to_a_reference_engine() {
    let files = generated();
    assert!(!body(&files, "engines/llama-cpp/index.html").contains("a published same-machine benchmark"));
    assert!(body(&files, "engines/llama-cpp/index.html").contains("baseline others are measured against"));
    assert!(body(&files, "engines/frink/index.html").contains("a published same-machine benchmark"));
}

#[test]
fn an_engine_with_only_a_baseline_figure_shows_the_authors_note_and_no_comparison() {
    let files = generated();
    let locals = body(&files, "engines/locals/index.html");
    assert!(locals.contains("271 tok/s") && locals.contains("No like-for-like comparison") && !locals.contains("<div class=\"bc"));
    assert!(!files.iter().any(|(path, _)| path.starts_with("compare/locals")));
}

#[test]
fn every_engine_appears_on_the_hardware_page_for_its_hardware_even_if_not_recommended() {
    let files = generated();
    for engine in &catalog().engine {
        for tag in &engine.hardware {
            let page = body(&files, &format!("hardware/{tag}/index.html"));
            assert!(page.contains(&engine.name), "{} missing from hardware/{tag}", engine.name);
        }
    }
    let nvidia = body(&files, "hardware/nvidia/index.html");
    assert!(nvidia.contains("neutronstar") && nvidia.contains("Not recommended"));
}

#[test]
fn a_card_leads_with_the_metric_that_clears_five_percent_or_says_nothing_does() {
    let files = generated();
    let neither = kalsa_engines::parse(&BOTH.replace("decode_tok_s = 10.4", "decode_tok_s = 10.1").replace("prefill_tok_s = 120.0", "prefill_tok_s = 101.0")).unwrap();
    let rendered = render(&neither, &Facts::none());
    let home = body(&rendered, "index.html");
    assert!(home.contains("No gain above noise published"), "neither metric clears 5%");
    assert!(body(&rendered, "dev/a/index.html").contains("<b>No gain above noise published</b><span>Range of published gains"));
    let mistral_dev = body(&files, "dev/EricLBuehler/index.html");
    assert!(mistral_dev.contains("<b>+35%</b><span>Range of published gains"), "one value when low and high are equal, from the metric that clears the bar");
}

#[test]
fn the_filter_assets_hide_cards_and_clear_hardware() {
    let css = std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../site/static/base.css")).unwrap();
    assert!(css.contains("[hidden]{display:none!important}"), "a hidden card must really disappear");
    let js = std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../site/static/filters.js")).unwrap();
    assert!(js.contains("function fresh()") && !js.contains("Object.assign({}, start"), "clearing builds a new state");
}
