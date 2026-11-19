//! The engines page: every listed engine as a card, and the `engines.json` its filter script reads.

use kalsa_engines::{family_label, hardware_labels, improvement_kinds, Catalog, Engine, ImprovementKind, FAMILIES};
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
            format!("<button aria-pressed=\"{}\" data-v=\"{value}\">{text}</button>", *value == active)
        })
        .collect();
    format!("<span class=\"sm\">{label}</span><div class=\"seg\" id=\"{id}\" role=\"group\" aria-label=\"{label}\">{buttons}</div>")
}

/// One option per kind that some listed engine shows, so the filter never offers an empty result.
fn improvement_options(catalog: &Catalog) -> String {
    ImprovementKind::ALL
        .iter()
        .filter(|kind| catalog.engine.iter().any(|engine| improvement_kinds(engine).contains(kind)))
        .map(|kind| format!("<option value=\"{}\">{}</option>", kind.id(), kind.label()))
        .collect()
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
         <select class=\"sel\" id=\"imp\" aria-label=\"Improvement\"><option value=\"all\">Any improvement</option>{improvements}</select>\
         <select class=\"sel\" id=\"lic\" aria-label=\"Licence\"><option value=\"all\">Any licence</option>{options}</select>\
         <select class=\"sel\" id=\"sort\" aria-label=\"Sort\"><option value=\"name\">Name, A to Z</option><option value=\"recent\">Recently added</option></select></div>\
         <div class=\"frow\">{badge}</div><div class=\"frow\" id=\"hw\" role=\"group\" aria-label=\"Hardware\">{hardware}</div>\
         <div class=\"frow\">{kind}<span class=\"sm num\" id=\"count\"></span></div></div>",
        improvements = improvement_options(catalog),
        badge = segment("badge", "Review", &[("any", "Any"), ("reviewed", "Reviewed"), ("none", "Not reviewed")], "any"),
        kind = segment("kind", "Kind", &[("all", "Any kind"), ("reference", "Reference"), ("fork", "Fork"), ("engine", "Engine")], "all"),
    )
}

pub fn engines_page(catalog: &Catalog, facts: &Facts) -> String {
    let cards: String = alphabetical(catalog).iter().map(|engine| card("../", engine, headline(engine), false, facts)).collect();
    let body = format!(
        "<div class=\"wrap\"><section class=\"pagehead\"><h1>Engines</h1><p class=\"lede\">Browse all {count} engines, A to Z. Filter them by chip, licence or what they do better. \
         <a class=\"lnk\" href=\"../{rules}\">Listed and community engines</a> explains what the Listed mark needs.</p>{filters}</section>\
         <div class=\"grid listgrid\" id=\"list\">{cards}</div>\
         <div class=\"empty\" id=\"empty\" hidden><b>No engine matches</b>Try fewer filters.<br><button id=\"clear\">Clear filters</button></div></div>",
        count = catalog.engine.len(),
        filters = filters(catalog),
        rules = paths::section("listed-and-community"),
    );
    page(
        &Meta {
            title: "Engines | Kalsa",
            description: "Every engine and fork in the Kalsa catalog, filtered by chip, licence or what it does better.",
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
pub fn engines_json(catalog: &Catalog) -> String {
    let rows: Vec<_> = catalog
        .engine
        .iter()
        .enumerate()
        .map(|(index, engine)| {
            json!({
                "id": engine.id,
                "name": engine.name.to_lowercase(),
                "badge": if engine.reviewed.is_some() && engine.review_declined.is_none() { "reviewed" } else { "none" },
                "hardware": engine.hardware,
                "labels": hardware_labels(&engine.hardware),
                "kind": engine.kind.label().to_lowercase(),
                "improvements": improvement_kinds(engine).iter().map(|kind| kind.id()).collect::<Vec<_>>(),
                "license": engine.license,
                "index": index,
                "text": search_text(engine),
            })
        })
        .collect();
    serde_json::to_string(&rows).expect("plain data serializes")
}
