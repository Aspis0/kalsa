mod common;

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use kalsa_site::{catalog, render, resolve_href, Facts};

use common::{banned, body, generated, html, visible};

#[test]
fn every_engine_has_a_page_and_every_section_exists() {
    let files = generated();
    for engine in &catalog().engine {
        assert!(files.iter().any(|(name, _)| name == &Path::new("engines").join(&engine.id).join("index.html")), "missing page for {}", engine.id);
    }
    for path in [
        "index.html", "engines/index.html", "engines/engines.json", "hardware/index.html",
        "listed-and-community/index.html", "submit/index.html", "app/index.html", "privacy/index.html", "remove/index.html",
        "pages.json", "robots.txt", "llms.txt", "sitemap.xml", "static/filters.js", "static/site.js", "static/remove.js",
    ] {
        body(&files, path);
    }
}

const CHIP_PAGES: [&str; 10] = ["apple-m1", "apple-m5", "nvidia", "amd", "intel", "cpu", "apple-m1-max", "apple-m2-pro", "apple-m3-ultra", "apple-m5-max"];

#[test]
fn a_chip_page_is_one_list_with_no_group_headings() {
    let files = generated();
    for slug in CHIP_PAGES {
        let page = body(&files, &format!("hardware/{slug}/index.html"));
        let main = page.split("<main id=\"main\">").nth(1).and_then(|rest| rest.split("</main>").next()).expect("a main section");
        assert_eq!(main.matches("<h1>").count(), 1, "{slug}");
        for heading in ["<h2", "<h3", "<details", "<table"] {
            assert!(!main.contains(heading), "{slug} has a {heading} group");
        }
        for gone in ["Doesn't run on", "Runs here", "Measured on", "Reference engines", "Larger models", "It runs here", "Engines are listed A to Z"] {
            assert!(!visible(main).contains(gone), "{slug} still says {gone:?}");
        }
        assert_eq!(main.matches("<div class=\"grid listgrid\">").count(), 1, "{slug} has exactly one list");
        let names: Vec<String> = main.split("<a class=\"card\"").skip(1).map(|card| card.split("<b>").nth(1).and_then(|rest| rest.split("</b>").next()).unwrap_or_default().to_lowercase()).collect();
        let mut sorted = names.clone();
        sorted.sort();
        assert_eq!(names, sorted, "{slug} lists its engines A to Z");
        let count = main.split("<p class=\"lede\">").nth(1).and_then(|rest| rest.split("</p>").next()).map(visible).and_then(|text| text.split(' ').next().unwrap_or_default().parse::<usize>().ok());
        assert_eq!(count, Some(names.len()), "{slug} counts the engines it lists");
    }
}

#[test]
fn a_chip_page_lists_the_same_cards_as_the_home_page_and_greys_other_chips() {
    let files = generated();
    let m1 = body(&files, "hardware/apple-m1/index.html");
    assert!(m1.contains("17 engines run on Apple M1."));
    let home = body(&files, "index.html");
    let card = |page: &str, id: &str| page.split(&format!("data-id=\"{id}\"")).nth(1).and_then(|rest| rest.split("</a>").next()).unwrap_or_default().to_string();
    assert_eq!(card(m1, "frink"), card(home, "frink"), "the same card as the home page");
    let m1_max = body(&files, "hardware/apple-m1-max/index.html");
    assert!(card(m1_max, "shunya-mtplx-m1").contains("<span class=\"cmpl\">2.2× faster decoding than MTPLX on M1 Max"), "a number measured on this chip is solid");
    assert!(card(m1_max, "frink").contains("<span class=\"cmpl weak\">"), "a number from another chip is grey");
    assert!(body(&files, "hardware/apple-m5/index.html").contains("engines run on Apple M5."));
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
fn there_is_no_compare_section_and_nothing_links_to_one() {
    let files = generated();
    assert!(!files.iter().any(|(path, _)| path.starts_with("compare")), "no compare page is generated");
    assert!(!body(&files, "sitemap.xml").contains("/compare"));
    for (page, text) in html(&files) {
        assert!(!text.contains("compare/"), "{page:?} links the compare section");
        assert!(!text.contains(">Compare</a>"), "{page:?} has a Compare link");
    }
    let frink = body(&files, "engines/frink/index.html");
    assert!(frink.contains("id=\"benchmarks\"") && frink.contains(">Source</a>"), "the published benchmarks stay on the engine page");
    assert!(!frink.contains("Published pairs"));
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
                // Exactly the three sign-in starts: the Worker answers them, the generator never writes them.
                const WORKER_STARTS: [&str; 3] = ["auth/github/start", "auth/huggingface/start", "auth/gitlab/start"];
                if WORKER_STARTS.iter().any(|route| resolved == Path::new(route)) {
                    continue;
                }
                let ok = resolved.as_os_str().is_empty() || known.contains(&resolved);
                assert!(ok, "{page:?} links to missing {resolved:?} ({target})");
            }
        }
    }
}

#[test]
fn hrefs_resolve_without_their_fragment_or_query() {
    assert_eq!(resolve_href(Path::new("engines/x/index.html"), "../../listed-and-community/index.html#corrections"), PathBuf::from("listed-and-community/index.html"));
    assert_eq!(resolve_href(Path::new("index.html"), "engines/index.html?hw=apple-m1"), PathBuf::from("engines/index.html"));
}

#[test]
fn the_sitemap_names_every_page_at_its_shared_address() {
    let files = generated();
    let sitemap = body(&files, "sitemap.xml");
    assert!(sitemap.contains(&format!("<loc>{}/engines/frink</loc>", kalsa_site::ORIGIN)) && sitemap.contains(&format!("<loc>{}/</loc>", kalsa_site::ORIGIN)));
    assert_eq!(sitemap.matches("<url>").count(), html(&files).count());
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
fn every_engine_appears_on_the_hardware_page_for_its_hardware_even_if_flagged() {
    let files = generated();
    for engine in &catalog().engine {
        for tag in &engine.hardware {
            let page = body(&files, &format!("hardware/{tag}/index.html"));
            assert!(page.contains(&engine.name), "{} missing from hardware/{tag}", engine.name);
        }
    }
    let nvidia = body(&files, "hardware/nvidia/index.html");
    assert!(nvidia.contains("neutronstar") && nvidia.contains("Warning:"));
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
fn every_page_offers_sign_in_and_the_sign_in_page_lists_the_providers() {
    let files = generated();
    for (path, page) in html(&files) {
        assert!(page.contains("data-account"), "{path:?} has no account item in the nav");
        assert!(page.contains(">Sign in</a>"), "{path:?} has no Sign in label");
        assert!(page.contains("static/account.js"), "{path:?} does not load the account script");
    }
    let signin = body(&files, "signin/index.html");
    for provider in ["huggingface", "github", "gitlab"] {
        assert!(signin.contains(&format!("auth/{provider}/start")), "missing the {provider} button");
    }
    for label in ["Continue with Hugging Face", "Continue with GitHub", "Continue with GitLab"] {
        assert!(signin.contains(label), "missing {label}");
    }
    assert!(banned(&visible(signin)).is_empty(), "the sign-in page must stay plain");
}

#[test]
fn the_account_script_builds_no_markup_and_sets_only_an_https_avatar() {
    let files = generated();
    let script = body(&files, "static/account.js");
    for forbidden in ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write"] {
        assert!(!script.contains(forbidden), "the account script must not build markup with {forbidden}");
    }
    assert!(script.contains("indexOf('https://') !== 0"), "an avatar src must be refused unless it is https");
    assert!(script.contains("setAttribute('src'"), "the avatar src goes through setAttribute");
    assert!(script.contains("textContent"), "the username goes in as text");
}
