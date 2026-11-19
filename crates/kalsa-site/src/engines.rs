//! The engines page: every listed engine as a card, and the `engines.json` its filter script reads.

use kalsa_engines::{family_label, Catalog, Engine, FAMILIES};
use serde_json::json;

use crate::cards::card;
use crate::counts::phrase;
use crate::facts::Facts;
use crate::html::escape;
use crate::layout::{page, Meta};
use crate::model::{alphabetical, headline};
use crate::paths;

fn segment(id: &str, label: &str, items: &[(&str, &str)], active: &str) -> String {
    let buttons: String = items
        .iter()
        .map(|(value, text)| {
            format!("<button aria-pressed=\"{}\" data-v=\"{value}\">{text}</button>", *value == active)
        })
        .collect();
    format!("<span class=\"sm\">{label}</span><div class=\"seg\" id=\"{id}\" role=\"group\" aria-label=\"{label}\">{buttons}</div>")
}

/// Two filters and a search box: the tier an engine is in, and the chip it runs on. Nothing ranks them.
fn filters() -> String {
    let hardware: String =
        FAMILIES.iter().map(|tag| format!("<button class=\"pillb\" aria-pressed=\"false\" data-hw=\"{tag}\">{}</button>", escape(&family_label(tag)))).collect();
    format!(
        "<div class=\"filters\"><div class=\"frow\"><input class=\"search\" id=\"q\" type=\"search\" placeholder=\"Search engines, authors, models\" aria-label=\"Search\"><span class=\"sp\"></span>{listing}</div>\
         <div class=\"frow\" id=\"hw\" role=\"group\" aria-label=\"Hardware\">{hardware}</div>\
         <div class=\"frow\"><span class=\"sm num\" id=\"count\"></span></div></div>",
        listing = segment("listing", "Listing", &[("all", "All"), ("listed", "Listed"), ("community", "Community")], "all"),
    )
}

pub fn engines_page(catalog: &Catalog, facts: &Facts) -> String {
    let cards: String = alphabetical(catalog).iter().map(|engine| card("../", engine, headline(engine), false, facts, None)).collect();
    let body = format!(
        "<div class=\"wrap\"><section class=\"pagehead\"><h1>Engines</h1><p class=\"lede\">{count} Pick a chip, or choose Listed or Community. \
         <a class=\"lnk\" href=\"../{rules}\">Listed and community engines</a> explains what the Listed mark needs.</p>{filters}</section>\
         <div class=\"grid listgrid\" id=\"list\">{cards}</div>\
         <div class=\"empty\" id=\"empty\" hidden><b>No engine matches</b>Try fewer filters.<br><button id=\"clear\">Clear filters</button></div>\
         <div class=\"empty\" id=\"empty-community\" hidden><b>No community engines yet.</b></div></div>",
        count = phrase("all", catalog.engine.len(), "Browse all {n} engine, A to Z.", "Browse all {n} engines, A to Z."),
        filters = filters(),
        rules = paths::section("listed-and-community"),
    );
    page(
        &Meta {
            title: "Engines | Kalsa",
            description: "Every engine and fork in the Kalsa catalog, A to Z, by chip and by Listed or Community.",
            path: &paths::section("engines"),
            active: "engines",
            scripts: &["filters.js"],
        },
        &body,
    )
}

fn search_text(engine: &Engine) -> String {
    let mut parts = vec![engine.name.as_str(), engine.repo.as_str(), engine.author.as_str(), engine.summary.as_str()];
    parts.extend(engine.benchmark.iter().map(|benchmark| benchmark.model.as_str()));
    parts.extend(engine.improvement.iter().flat_map(|item| [item.summary.as_str(), item.model.as_deref().unwrap_or_default()]));
    parts.join(" ").to_lowercase()
}

/// What the filter script reads. Strings here are data, not markup: the script never uses innerHTML on them.
/// Every catalog entry is Listed; Community rows arrive when community listing opens.
pub fn engines_json(catalog: &Catalog) -> String {
    let rows: Vec<_> = catalog
        .engine
        .iter()
        .map(|engine| {
            json!({
                "id": engine.id,
                "name": engine.name.to_lowercase(),
                "listing": "listed",
                "hardware": engine.hardware,
                "text": search_text(engine),
            })
        })
        .collect();
    serde_json::to_string(&rows).expect("plain data serializes")
}
