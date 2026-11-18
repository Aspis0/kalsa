mod common;

use kalsa_site::{catalog};

use common::{banned, body, generated, html, visible};

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
fn the_site_is_a_database_and_offers_no_download() {
    let files = generated();
    for (page, text) in html(&files) {
        let shown = visible(text);
        for phrase in ["Download", "Get the app", "Install with Kalsa", "Open in Kalsa"] {
            assert!(!shown.contains(phrase), "{page:?} says {phrase:?}");
        }
        for target in text.split("href=\"").skip(1).map(|rest| rest.split('"').next().unwrap_or_default()) {
            let lower = target.to_ascii_lowercase();
            assert!(!lower.starts_with("kalsa://"), "{page:?} links {target}");
            assert!(![".dmg", ".exe", ".pkg", ".msi", ".zip", ".appimage"].iter().any(|ext| lower.ends_with(ext)), "{page:?} links a binary {target}");
            assert!(!lower.contains("aspis0/kalsa/releases"), "{page:?} links a Kalsa release {target}");
        }
        assert!(!text.contains("download/index.html"), "{page:?} links the old download page");
    }
    assert!(!files.iter().any(|(path, _)| path.starts_with("download")), "the download page is gone");
}

#[test]
fn the_app_page_says_it_is_not_available_yet_and_offers_nothing() {
    let files = generated();
    let page = body(&files, "app/index.html");
    let shown = visible(page);
    assert!(shown.contains("not available yet"));
    assert!(shown.contains("lets you try an engine from this list with one click"));
    for phrase in ["Download", "macOS", "Windows", "Linux", "version", "support@"] {
        assert!(!shown.contains(phrase), "the App page says {phrase:?}");
    }
    assert!(!page.contains("class=\"btn"), "the App page has no button");
    assert!(page.contains("aria-current=\"page\">App</a>"), "the nav marks the App page");
}

#[test]
fn the_home_page_leads_with_the_database_and_has_no_app_call_to_action() {
    let files = generated();
    let home = body(&files, "index.html");
    let shown = visible(home);
    assert!(shown.contains("A database of local inference engines and forks"));
    assert!(home.contains("<meta property=\"og:description\" content=\"A database of local inference engines and forks"));
    let above = &home[..home.find("id=\"picker\"").expect("the picker is on the home page")];
    assert!(!above.contains("app/index.html") || above.matches("app/index.html").count() == 1, "only the quiet nav link may point at the App page");
}

#[test]
fn every_engine_points_to_its_own_project_for_installing() {
    let files = generated();
    for engine in &catalog().engine {
        let page = body(&files, &format!("engines/{}/index.html", engine.id));
        assert!(!page.contains("Before you install"), "{}", engine.id);
        let rows = page.split("id=\"install\"").nth(1).unwrap_or_default();
        assert!(rows.starts_with(">How to install</h3>"), "{} has the How to install heading", engine.id);
        assert!(rows.contains(&format!("href=\"https://github.com/{}\"", engine.repo)), "{} links its project", engine.id);
        assert!(rows.contains(&format!("href=\"https://github.com/{}/releases\"", engine.repo)), "{} links its releases", engine.id);
        for claim in ["pinned", "checksum", "sha256", "Where it goes", "Uninstall", "Who can reach it", "Application Support", "127.0.0.1"] {
            assert!(!rows.contains(claim), "{} claims {claim:?} in its install section", engine.id);
        }
    }
}

#[test]
fn a_website_shows_on_the_engine_page_with_its_label_and_nowhere_else_is_invented() {
    let files = generated();
    let page = |id: &str| body(&files, &format!("engines/{id}/index.html")).to_string();
    assert!(page("llama-cpp").contains("<a class=\"btn two\" href=\"https://llama.app\">Website</a>"));
    assert!(page("ds4").contains("<a class=\"btn two\" href=\"https://dwarfstar.sh\">Community site</a>"));
    assert!(page("splash").contains("href=\"https://inco.ai/blog/splash/\">Announcement</a>"));
    for forked in ["neutronstar", "qvac-fabric", "ingenious-ds4-m3"] {
        assert!(!visible(&page(forked)).contains("Website"), "{forked} has no site of its own");
    }
    for engine in catalog().engine.iter().filter(|engine| engine.website.is_none()) {
        let shown = visible(&page(&engine.id));
        assert!(!shown.contains("Website") && !shown.contains("Announcement") && !shown.contains("Community site"), "{}", engine.id);
    }
}

#[test]
fn a_fork_links_its_upstream_to_the_upstream_page() {
    let files = generated();
    let fork = body(&files, "engines/neutronstar/index.html");
    assert!(fork.contains("<a class=\"lnk\" href=\"../../engines/ds4/index.html\">antirez/ds4</a>"));
    assert!(body(&files, "engines/qvac-fabric/index.html").contains("href=\"../../engines/llama-cpp/index.html\">ggml-org/llama.cpp</a>"));
    assert!(body(&files, "how-we-choose/index.html").contains("Projects that other listed forks build on are listed as references"));
}

#[test]
fn how_we_choose_lists_every_kind_with_its_evidence_and_what_does_not_count() {
    let files = generated();
    let page = visible(body(&files, "how-we-choose/index.html"));
    for kind in kalsa_engines::ImprovementKind::ALL {
        assert!(page.contains(kind.label()), "{}", kind.label());
    }
    for phrase in ["Under 5% is noise", "Trade-offs must be declared", "What does not count", "tool calling, vision or a user interface", "A number without the machine it was measured on"] {
        assert!(page.contains(phrase), "{phrase}");
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
