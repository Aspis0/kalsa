//! The engines page: every listed engine as a card, and the `engines.json` its filter script reads.

use kalsa_engines::{family_label, hardware_labels, Catalog, Engine, FAMILIES};
use serde_json::json;

use crate::cards::card;
use crate::facts::Facts;
use crate::html::escape;
use crate::layout::{page, Meta};
use crate::model::{alphabetical, headline};
use crate::paths;

fn segment(id: &str, label: &str, items: &[(&str, &str)], active: &str) -> String {
    let buttons: String = items
        .iter()
        .map(|(value, text)| {
            let disabled = if text.contains("soon") { " disabled" } else { "" };
            format!("<button aria-pressed=\"{}\" data-v=\"{value}\"{disabled}>{text}</button>", *value == active)
        })
        .collect();
    format!("<span class=\"sm\">{label}</span><div class=\"seg\" id=\"{id}\" role=\"group\" aria-label=\"{label}\">{buttons}</div>")
}

fn filters(catalog: &Catalog) -> String {
    let hardware: String =
        FAMILIES.iter().map(|tag| format!("<button class=\"pillb\" aria-pressed=\"false\" data-hw=\"{tag}\">{}</button>", escape(&family_label(tag)))).collect();
    let mut licences: Vec<&str> = catalog.engine.iter().map(|engine| engine.license.as_str()).collect();
    licences.sort_unstable();
    licences.dedup();
    let options: String = licences.iter().map(|licence| format!("<option>{}</option>", escape(licence))).collect();
    format!(
        "<div class=\"filters\"><div class=\"frow\"><input class=\"search\" id=\"q\" type=\"search\" placeholder=\"Search engines, authors, models\" aria-label=\"Search\"><span class=\"sp\"></span>\
         <select class=\"sel\" id=\"lic\" aria-label=\"Licence\"><option value=\"all\">Any licence</option>{options}</select>\
         <select class=\"sel\" id=\"sort\" aria-label=\"Sort\"><option value=\"name\">Name, A to Z</option><option value=\"recent\">Recently added</option></select></div>\
         <div class=\"frow\">{listing}{badge}</div><div class=\"frow\" id=\"hw\" role=\"group\" aria-label=\"Hardware\">{hardware}</div>\
         <div class=\"frow\">{kind}<span class=\"sm num\" id=\"count\"></span></div></div>",
        listing = segment("listing", "Listing", &[("listed", "Listed"), ("community", "Community, coming soon")], "listed"),
        badge = segment("badge", "Badge", &[("any", "Any"), ("reviewed", "Reviewed"), ("none", "Not reviewed")], "any"),
        kind = segment("kind", "Kind", &[("all", "Any kind"), ("reference", "Reference"), ("fork", "Fork"), ("engine", "Engine")], "all"),
    )
}

pub fn engines_page(catalog: &Catalog, facts: &Facts) -> String {
    let cards: String = alphabetical(catalog).iter().map(|engine| card("../", engine, headline(engine), false, facts)).collect();
    let body = format!(
        "<div class=\"wrap\"><section class=\"pagehead\"><h1>Engines</h1><p class=\"lede\">{count} listed engines and forks that passed the catalog rules, A to Z by default. \
         Each number is claimed by its author and names the chip it was measured on.</p>{filters}</section>\
         <div class=\"grid listgrid\" id=\"list\">{cards}</div>\
         <div class=\"empty\" id=\"empty\" hidden><b>No engine matches</b>Try fewer filters.<br><button id=\"clear\">Clear filters</button></div>\
         <div class=\"panel dash\"><h3>Community listings <span class=\"soon\">Coming soon</span></h3>\
         <p>Engines that authors list themselves will appear here in their own section. Kalsa never recommends them. <a class=\"lnk\" href=\"../{submit}\">How listing works</a></p></div></div>",
        count = catalog.engine.len(),
        filters = filters(catalog),
        submit = paths::section("submit"),
    );
    page(
        &Meta {
            title: "Engines | Kalsa",
            description: "All listed local inference engines and forks in the Kalsa catalog, with the benchmark each author published.",
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
    parts.join(" ").to_lowercase()
}

/// What the filter script reads. Strings here are data, not markup: the script never uses innerHTML on them.
pub fn engines_json(catalog: &Catalog) -> String {
    let rows: Vec<_> = catalog
        .engine
        .iter()
        .enumerate()
        .map(|(index, engine)| {
            json!({
                "id": engine.id,
                "name": engine.name.to_lowercase(),
                "listing": "listed",
                "badge": if engine.reviewed.is_some() { "reviewed" } else { "none" },
                "hardware": engine.hardware,
                "labels": hardware_labels(&engine.hardware),
                "kind": engine.kind.label().to_lowercase(),
                "license": engine.license,
                "index": index,
                "text": search_text(engine),
            })
        })
        .collect();
    serde_json::to_string(&rows).expect("plain data serializes")
}
