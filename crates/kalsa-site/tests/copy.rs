mod common;

use kalsa_site::catalog;

use common::{attribute_text, banned, body, generated, html, visible};

#[test]
fn copy_has_no_banned_words_or_emoji() {
    for (page, text) in html(&generated()) {
        let shown = format!("{} {}", visible(text), attribute_text(text));
        assert!(banned(&shown).is_empty(), "{page:?} has banned words: {:?}", banned(&shown));
        assert!(!text.chars().any(|character| (character as u32) >= 0x1F000), "{page:?} has an emoji");
    }
}

#[test]
fn every_page_ends_with_the_same_footer_line() {
    for (page, text) in html(&generated()) {
        let footer = text.split("<footer").nth(1).unwrap_or_default();
        assert!(visible(footer).contains("Kalsa is not affiliated with the projects it lists. · Contact · Privacy · Listed and community engines"), "{page:?}");
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
fn the_home_page_uses_the_approved_headline_buttons_and_section_names() {
    let files = generated();
    let home = body(&files, "index.html");
    let shown = visible(home);
    assert!(shown.contains("The home of local inference and the people behind it"));
    assert!(shown.contains("Discover the engines and forks that run AI models on your own computer."));
    assert!(shown.contains(&format!("Browse all {} engines", catalog().engine.len())) && shown.contains("Listed and community engines"));
    for section in ["Find engines for your chip", "Recently added"] {
        assert!(shown.contains(section), "{section}");
    }
    assert!(shown.contains("Numbers in grey were measured on a different chip."));
    assert!(shown.contains("engines run on Apple M1."));
    for gone in ["Published comparisons", "How we choose", "database of local inference", "What are you running?"] {
        assert!(!shown.contains(gone), "{gone}");
    }
    let above = &home[..home.find("id=\"picker\"").expect("the picker is on the home page")];
    assert!(above.matches("app/index.html").count() <= 1, "only the quiet nav link may point at the App page");
    assert!(home.contains("<meta property=\"og:description\" content=\"Discover the engines and forks that run AI models on your own computer.\">"));
}

#[test]
fn every_engine_page_ends_with_a_plain_install_line_and_links_the_project() {
    let files = generated();
    for engine in &catalog().engine {
        let page = body(&files, &format!("engines/{}/index.html", engine.id));
        assert!(!page.contains("Before you install") && !page.contains("How to install"), "{}", engine.id);
        let install = page.split("id=\"install\"").nth(1).unwrap_or_default();
        assert!(install.starts_with(">Install</h3><p>To install it, follow the project's own instructions on <a class=\"lnk\" "), "{}", engine.id);
        assert!(install.contains(&format!("href=\"https://github.com/{}\">GitHub</a>.", engine.repo)), "{} links its project", engine.id);
        let header = page.split("class=\"acts\"").nth(1).and_then(|rest| rest.split("</div>").next()).unwrap_or_default();
        assert!(header.contains(&format!("href=\"https://github.com/{}\">Repository</a>", engine.repo)), "{}", engine.id);
        assert!(header.contains(&format!("href=\"https://github.com/{}/releases\">Releases</a>", engine.repo)), "{}", engine.id);
        for claim in ["pinned", "checksum", "sha256", "Where it goes", "Uninstall", "Who can reach it", "Application Support", "127.0.0.1"] {
            assert!(!install.contains(claim), "{} claims {claim:?} in its install section", engine.id);
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
    assert!(fork.contains("It is a fork of <a class=\"lnk\" href=\"../../engines/ds4/index.html\">antirez/ds4</a>."));
    assert!(body(&files, "engines/qvac-fabric/index.html").contains("href=\"../../engines/llama-cpp/index.html\">ggml-org/llama.cpp</a>"));
}

#[test]
fn the_listed_and_community_page_replaces_the_old_rules_page() {
    let files = generated();
    assert!(!files.iter().any(|(path, _)| path.starts_with("how-we-choose")) && !files.iter().any(|(path, _)| path.starts_with("how-listing-works")));
    let raw = body(&files, "listed-and-community/index.html");
    let page = visible(raw);
    assert!(raw.contains("<title>Listed and community engines | Kalsa</title>") && raw.contains("aria-current=\"page\">Listing</a>") && !raw.contains(">Listed and community engines</a><a"));
    for heading in [
        "Community engines", "Listed engines", "What every Listed engine needs", "What counts as better", "How we judge the proof",
        "Where the numbers come from", "What “Reviewed” means", "Corrections",
    ] {
        assert!(raw.contains(&format!("<h2>{heading}</h2>")), "{heading}");
    }
    for line in [
        "Anyone can add an engine to Kalsa, whether it’s a new project, a fork or an experiment.",
        "Community listing opens soon.",
        "If a number looks wrong, write to help@kalsa.io and we’ll take another look.",
        "It has at least 5 stars on GitHub.",
        "It doesn’t need sudo or changes to your system. If one feature does, we show it as a trade-off.",
        "Writing replies faster", "Using less energy", "tokens per joule, measured",
        "A gain under 5% is noise, so we don’t count it.",
        "Beating its own older version doesn’t count.",
        "A different weight format counts only if the quality loss is measured too.",
        "Numbers measured on a different chip appear in grey.",
        "A review lowers the risk, but it can’t remove it.",
        "Any engine runs with your user’s permissions, and macOS doesn’t sandbox it, so install only engines you trust.",
        "We write the short summary on each page.",
    ] {
        assert!(page.contains(line), "{line}");
    }
    assert_eq!(raw.matches("<li>").count(), 7 + 5, "seven rules and five ways of judging proof");
    assert_eq!(raw.matches("<tr><td>").count(), 12, "twelve things that can count as better");
}

#[test]
fn the_home_page_and_the_engine_list_are_not_ranked_by_gain() {
    let files = generated();
    let engines = body(&files, "engines/index.html");
    assert!(engines.contains("Name, A to Z") && !engines.contains("high to low"));
    for page in [body(&files, "index.html"), engines] {
        for phrase in ["Biggest", "high to low", "Top gains", "Leaderboard"] {
            assert!(!page.contains(phrase), "{phrase}");
        }
    }
}

#[test]
fn the_home_page_has_no_grid_of_developer_portraits() {
    let files = generated();
    let home = body(&files, "index.html");
    let shown = visible(home);
    for gone in ["The people building them", "developers and organisations so far"] {
        assert!(!shown.contains(gone), "{gone}");
    }
    assert!(!home.contains("class=\"wall\"") && !home.contains("id=\"people\""), "no avatar grid");
    assert!(!home.contains("href=\"dev/"), "the home page links no developer page");
    assert!(body(&files, "dev/antonellof/index.html").contains("antonellof"), "developer pages stay");
    assert!(body(&files, "engines/frink/index.html").contains("by antonellof"), "engine pages keep their author line");
}
