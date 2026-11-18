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
        "index.html", "engines/index.html", "engines/engines.json", "hardware/index.html", "compare/index.html",
        "how-we-choose/index.html", "submit/index.html", "app/index.html", "sitemap.xml", "static/filters.js", "static/site.js",
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
    assert_eq!(resolve_href(Path::new("engines/x/index.html"), "../../how-we-choose/index.html#removal"), PathBuf::from("how-we-choose/index.html"));
    assert_eq!(resolve_href(Path::new("index.html"), "engines/index.html?hw=apple-m1"), PathBuf::from("engines/index.html"));
}

#[test]
fn the_sitemap_names_every_page_at_its_shared_address() {
    let files = generated();
    let sitemap = body(&files, "sitemap.xml");
    assert!(sitemap.contains("<loc>https://kalsa.io/engines/frink</loc>") && sitemap.contains("<loc>https://kalsa.io/</loc>"));
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
