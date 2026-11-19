//! The home page: the engines by chip and the newest entries.

use kalsa_engines::{family_label, Catalog, Engine, FAMILIES};

use crate::cards::card;
use crate::facts::Facts;
use crate::html::escape;
use crate::layout::{page, Meta};
use crate::model::{alphabetical, closest_benchmark, headline, runs_on};
use crate::paths;

const SUBTITLE: &str = "Discover the engines and forks that run AI models on your own computer.";

fn panel(root: &str, catalog: &Catalog, tag: &str, facts: &Facts) -> String {
    let engines: Vec<&Engine> = alphabetical(catalog).into_iter().filter(|engine| runs_on(engine, tag)).collect();
    let cards: String = engines
        .iter()
        .map(|engine| match closest_benchmark(engine, tag) {
            Some((distance, benchmark)) => card(root, engine, Some(benchmark), distance != 0, facts),
            None => card(root, engine, None, false, facts),
        })
        .collect();
    format!(
        "<div data-panel=\"{tag}\"{hidden}><p class=\"sm panelnote\">{count} engines run on {label}. Numbers in grey were measured on a different chip.</p><div class=\"grid\">{cards}</div></div>",
        hidden = if tag == FAMILIES[0] { "" } else { " hidden" },
        count = engines.len(),
        label = escape(&family_label(tag)),
    )
}

fn picker(root: &str, catalog: &Catalog, facts: &Facts) -> String {
    let buttons: String = FAMILIES
        .iter()
        .map(|tag| format!("<button aria-pressed=\"{}\" data-pk=\"{tag}\">{}</button>", *tag == FAMILIES[0], escape(&family_label(tag))))
        .collect();
    let panels: String = FAMILIES.iter().map(|tag| panel(root, catalog, tag, facts)).collect();
    format!(
        "<section class=\"blk\" id=\"picker\"><div class=\"sh\"><h2>Find engines for your chip</h2><p>Pick your chip to see the engines that run on it.</p></div>\
         <div class=\"pk\" role=\"group\" aria-label=\"Hardware\">{buttons}</div>{panels}</section>"
    )
}

fn recent(root: &str, catalog: &Catalog, facts: &Facts) -> String {
    let cards: String = catalog.engine.iter().rev().take(4).map(|engine| card(root, engine, headline(engine), false, facts)).collect();
    format!(
        "<section class=\"blk\" id=\"recent\"><div class=\"sh\"><h2>Recently added</h2><p>The newest engines in the catalog.</p></div><div class=\"grid\">{cards}</div></section>"
    )
}

pub fn home(catalog: &Catalog, facts: &Facts) -> String {
    let root = "";
    let body = format!(
        "<div class=\"wrap\"><section class=\"top\"><h1>The home of local inference and the people behind it</h1>\
         <p class=\"lede\">{SUBTITLE}</p>\
         <div class=\"cta\"><a class=\"btn\" href=\"{engines}\">Browse all {count} engines</a><a class=\"btn two\" href=\"{rules}\">Listed and community engines</a></div></section>\
         {picker}{recent}</div>",
        engines = paths::section("engines"),
        rules = paths::section("listed-and-community"),
        count = catalog.engine.len(),
        picker = picker(root, catalog, facts),
        recent = recent(root, catalog, facts),
    );
    page(
        &Meta {
            title: "Kalsa: the home of local inference and the people behind it",
            description: SUBTITLE,
            path: paths::HOME,
            active: "",
            scripts: &["site.js"],
        },
        &body,
    )
}
