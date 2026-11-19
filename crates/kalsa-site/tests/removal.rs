mod common;

use std::path::Path;

use kalsa_site::catalog;

use common::{body, generated, html};

fn static_file(name: &str) -> String {
    std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../site/static").join(name)).unwrap()
}

#[test]
fn every_engine_page_and_card_carries_the_id_the_worker_strips() {
    let files = generated();
    for engine in &catalog().engine {
        let page = body(&files, &format!("engines/{}/index.html", engine.id));
        assert!(page.contains(&format!("<div class=\"wrap\" data-engine=\"{}\">", engine.id)), "{}", engine.id);
    }
    for (page, text) in html(&files) {
        for card in text.split("<a class=\"card\"").skip(1) {
            let card = card.split("</a>").next().unwrap_or_default();
            let id = card.split("data-id=\"").nth(1).and_then(|rest| rest.split('"').next()).unwrap_or_default();
            assert!(card.contains(&format!("data-engine=\"{id}\"")), "{page:?} card {id}");
        }
    }
}

#[test]
fn every_developer_page_and_the_links_to_it_carry_the_login() {
    let files = generated();
    let catalog = catalog();
    for engine in &catalog.engine {
        let login = engine.repo.split('/').next().unwrap();
        let page = body(&files, &format!("dev/{login}/index.html"));
        assert!(page.contains(&format!("<div class=\"wrap\" data-dev=\"{login}\">")), "{login}");
        assert!(page.contains(&format!("data-dev-stats=\"{login}\"")), "{login} stats");
        let engine_page = body(&files, &format!("engines/{}/index.html", engine.id));
        assert!(engine_page.contains(&format!("<div class=\"box\" data-dev=\"{login}\">")), "{} sidebar", engine.id);
        assert!(engine_page.contains(&format!("<span data-dev=\"{login}\">")), "{} crumb", engine.id);
    }
    let dev = body(&files, "dev/antonellof/index.html");
    assert!(dev.contains("<tr data-engine=\"frink\">"), "a benchmark row goes with its engine");
}

#[test]
fn every_page_offers_removal_to_its_owner() {
    let files = generated();
    let catalog = catalog();
    for engine in &catalog.engine {
        let page = body(&files, &format!("engines/{}/index.html", engine.id));
        assert!(page.contains(&format!("href=\"../../remove/index.html?kind=engine&amp;id={}\">Remove this page</a>", engine.id)), "{}", engine.id);
    }
    for engine in &catalog.engine {
        let login = engine.repo.split('/').next().unwrap();
        let page = body(&files, &format!("dev/{login}/index.html"));
        assert!(page.contains(&format!("href=\"../../remove/index.html?kind=developer&amp;id={login}\">Remove this page</a>")), "{login}");
    }
}

#[test]
fn the_allow_list_names_every_page_and_what_ownership_needs() {
    let files = generated();
    let pages: serde_json::Value = serde_json::from_str(body(&files, "pages.json")).expect("pages.json parses");
    let catalog = catalog();
    let engines = pages["engines"].as_array().expect("an engine list");
    assert_eq!(engines.len(), catalog.engine.len());
    for engine in &catalog.engine {
        let row = engines.iter().find(|row| row["id"] == engine.id).unwrap_or_else(|| panic!("{}", engine.id));
        assert_eq!(row["repo"], engine.repo, "{}", engine.id);
        assert_eq!(row["name"], engine.name, "{}", engine.id);
        assert_eq!(row["hardware"].as_array().expect("tags").len(), engine.hardware.len(), "{}", engine.id);
    }
    let devs = pages["developers"].as_array().expect("a developer list");
    for engine in &catalog.engine {
        let login = engine.repo.split('/').next().unwrap();
        assert!(devs.iter().any(|row| row["login"] == login), "{login}");
    }
}

#[test]
fn the_confirmation_page_and_its_script_are_generated() {
    let files = generated();
    let page = body(&files, "remove/index.html");
    assert!(page.contains("<title>Remove this page | Kalsa</title>") && page.contains("static/remove.js"));
    for id in ["remove-status", "remove-title", "remove-signin", "remove-confirm", "remove-undo", "remove-help"] {
        assert!(page.contains(&format!("id=\"{id}\"")), "{id}");
    }
    assert!(page.contains("href=\"../auth/github/start\""), "the GitHub sign-in start");
    assert!(page.contains("id=\"remove-help\" hidden"), "the fallback mailbox stays hidden until it is needed");
    let script = static_file("remove.js");
    for forbidden in ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write"] {
        assert!(!script.contains(forbidden), "the script must not build markup with {forbidden}");
    }
    assert!(script.contains("textContent") && script.contains("'/api/remove'") && script.contains("'/api/undo'"));
    assert!(script.contains("'Content-Type': 'application/json'"), "the POST is JSON, as the guard requires");
    assert!(script.contains("encodeURIComponent(location.pathname + location.search)"), "sign-in comes back to this page");
}

#[test]
fn the_submit_example_is_invented_and_republishes_no_catalog_entry() {
    let files = generated();
    let submit = body(&files, "submit/index.html");
    assert!(submit.contains("id = &quot;example-engine&quot;"), "the example is its own entry");
    assert!(submit.contains("repo = &quot;your-name/example-engine&quot;"));
    for engine in &catalog().engine {
        assert!(!submit.contains(&engine.repo), "the submit page publishes {}", engine.repo);
        assert!(!submit.contains(&format!("id = &quot;{}&quot;", engine.id)), "the submit page publishes {}", engine.id);
    }
}

#[test]
fn a_reference_to_another_engine_carries_its_repo_and_the_words_to_replace_it_with() {
    let files = generated();
    let fork = body(&files, "engines/neutronstar/index.html");
    assert!(fork.contains("data-ref-repo=\"antirez/ds4\""), "the upstream link");
    assert!(fork.contains("data-ref-text=\"another project\""), "the prose form");
    assert!(fork.contains("data-ref-text=\"not listed\""), "the details row");
    let cards = body(&files, "engines/index.html");
    assert!(cards.contains("class=\"rel\" data-ref-repo=\"antirez/ds4\" data-ref-text=\"Fork of another project\""), "the card relation");
}

#[test]
fn the_confirmation_script_asks_the_api_so_undo_survives_a_reload() {
    let script = static_file("remove.js");
    assert!(script.contains("'/api/page?kind="), "the entry comes from the API, which still knows a removed page");
    assert!(!script.contains("'/pages.json'"), "pages.json no longer lists a removed page");
    assert!(script.contains("entry.removed") && script.contains("offerUndo"), "a removed entry offers Undo on a fresh load");
    assert!(script.contains("'organisation'") && script.contains("remove-org"), "an organisation page gets the mailbox fallback");
    let files = generated();
    let page = body(&files, "remove/index.html");
    assert!(page.contains("id=\"remove-org\" hidden"), "the organisation fallback stays hidden until it is needed");
}

#[test]
fn every_count_the_worker_recomputes_carries_both_grammatical_forms() {
    let files = generated();
    let engines = body(&files, "engines/index.html");
    assert!(engines.contains("data-count=\"all\"") && engines.contains("data-one=\"Browse all {n} engine, A to Z.\""), "the engines total");
    let hardware = body(&files, "hardware/apple-m1/index.html");
    assert!(hardware.contains("data-count=\"hw:apple-m1\"") && hardware.contains("data-one=\"{n} engine runs on Apple M1.\""), "a chip page");
    let home = body(&files, "index.html");
    assert!(home.contains("data-count=\"hw:apple-m1\""), "a home panel");
    let dev = body(&files, "dev/antonellof/index.html");
    assert!(dev.contains("data-count=\"dev:antonellof\"") && dev.contains("data-many=\"Engines listed\""), "a developer's own count");
    for (page, text) in html(&files) {
        for span in text.split("data-count=\"").skip(1) {
            assert!(span.contains("data-one=\"") && span.contains("data-many=\""), "{page:?} has a count with no forms");
        }
    }
}
