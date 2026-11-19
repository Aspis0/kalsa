mod common;

use std::path::Path;

use kalsa_site::catalog;

use common::{attribute_text, body, generated, html, visible};

/// The words a social network runs on. "follow" alone stays out: the install line says "follow the
/// project's own instructions", and a Follow button is caught by its label below.
const SOCIAL: [&str; 18] = [
    "recommend", "recommends", "recommended", "recommendation", "recommendations", "recommendable",
    "heart", "hearts", "upvote", "upvotes", "like", "likes", "liked", "following", "follows", "follower", "followers", "unfollow",
];

fn words(text: &str) -> Vec<String> {
    text.to_ascii_lowercase().split(|c: char| !c.is_ascii_alphanumeric()).filter(|word| !word.is_empty()).map(str::to_string).collect()
}

fn social_hits(text: &str) -> Vec<&'static str> {
    let found = words(text);
    SOCIAL.into_iter().filter(|word| found.iter().any(|found| found == word)).collect()
}

#[test]
fn no_page_carries_social_wording() {
    for (page, text) in html(&generated()) {
        let shown = format!("{} {}", visible(text), attribute_text(text));
        assert!(social_hits(&shown).is_empty(), "{page:?} says {:?}", social_hits(&shown));
    }
}

#[test]
fn no_page_carries_a_social_control() {
    for (page, text) in html(&generated()) {
        for marker in ["data-like", "data-heart", "data-follow", "data-upvote", "data-recommend", "data-star=", "aria-label=\"Like", "aria-label=\"Follow"] {
            assert!(!text.contains(marker), "{page:?} has {marker}");
        }
        for label in ["Like", "Likes", "Follow", "Following", "Heart", "Recommend", "Upvote", "Star"] {
            for close in ["</a>", "</button>"] {
                assert!(!text.contains(&format!(">{label}{close}")), "{page:?} has a {label} control");
            }
        }
    }
}

#[test]
fn the_engines_page_filters_only_by_tier_and_hardware() {
    let files = generated();
    let page = body(&files, "engines/index.html");
    assert!(page.contains("id=\"listing\"") && page.contains("id=\"hw\"") && page.contains("id=\"q\""), "the two filters and the search box");
    for (value, label) in [("all", "All"), ("listed", "Listed"), ("community", "Community")] {
        assert!(page.contains(&format!("data-v=\"{value}\">{label}</button>")), "{label}");
    }
    for gone in ["id=\"imp\"", "id=\"lic\"", "id=\"sort\"", "id=\"badge\"", "id=\"kind\"", "Any licence", "Any improvement", "Any kind", "Recently added</option>"] {
        assert!(!page.contains(gone), "{gone} is still on the page");
    }
    assert!(page.contains("data-hw=\"apple-m1\""), "the hardware chips stay");
}

#[test]
fn the_script_filters_by_tier_and_hardware_and_nothing_else() {
    let js = std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../site/static/filters.js")).unwrap();
    assert!(js.contains("row.listing !== state.listing") && js.contains("row.hardware.indexOf(tag)"), "the two filters");
    assert!(js.contains("row.text.indexOf(state.q)"), "the search box");
    for gone in ["row.license", "row.improvements", "row.badge", "row.kind", "row.index", "state.sort", "state.imp", "state.lic"] {
        assert!(!js.contains(gone), "the script still reads {gone}");
    }
}

#[test]
fn the_engines_json_carries_only_what_the_two_filters_and_the_search_need() {
    let files = generated();
    let json = body(&files, "engines/engines.json");
    let rows: Vec<serde_json::Value> = serde_json::from_str(json).expect("engines.json parses");
    assert_eq!(rows.len(), catalog().engine.len());
    for row in &rows {
        let mut keys: Vec<&str> = row.as_object().expect("a row is an object").keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(keys, ["hardware", "id", "listing", "name", "text"], "{row}");
        assert_eq!(row["listing"], "listed", "every catalog entry is Listed until community listing opens");
    }
}

#[test]
fn an_empty_community_tier_says_so_in_its_own_words() {
    let files = generated();
    let page = body(&files, "engines/index.html");
    assert!(page.contains("id=\"empty-community\"") && page.contains("<b>No community engines yet.</b>"), "the community empty state");
    assert!(page.contains("id=\"empty\"") && page.contains("<b>No engine matches</b>"), "the generic empty state stays for the other filters");
    let js = std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../site/static/filters.js")).unwrap();
    assert!(js.contains("state.listing === 'community'"), "the script picks the community wording");
}
