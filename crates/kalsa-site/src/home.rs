//! The home page: the engine list by hardware, published comparisons, recent additions, the people behind them.

use kalsa_engines::{family_label, Benchmark, Catalog, Engine, FAMILIES};

use crate::cards::{avatar, card, feed_item};
use crate::facts::Facts;
use crate::html::{escape, safe_href};
use crate::layout::{page, Meta};
use crate::model::{alphabetical, closest_benchmark, developers, headline, reference_comparison, runs_on};
use crate::paths;

fn wall(root: &str, catalog: &Catalog) -> String {
    let people: String = developers(catalog)
        .iter()
        .map(|developer| {
            format!(
                "<a href=\"{href}\">{avatar}<em>{login}</em></a>",
                href = safe_href(&format!("{root}{}", paths::developer(developer.login))),
                avatar = avatar(developer.login, "md", developer.org),
                login = escape(developer.login),
            )
        })
        .collect();
    format!("<div class=\"wall\">{people}</div>")
}

fn panel(root: &str, catalog: &Catalog, tag: &str, facts: &Facts) -> String {
    let engines: Vec<&Engine> = alphabetical(catalog).into_iter().filter(|engine| runs_on(engine, tag)).collect();
    let cards: String = engines
        .iter()
        .map(|engine| match closest_benchmark(engine, tag) {
            Some((distance, benchmark)) => card(root, engine, Some(benchmark), distance != 0, facts),
            None => card(root, engine, None, false, facts),
        })
        .collect();
    let note = if kalsa_engines::chip_generation(tag).is_some() {
        "Solid numbers were measured on this chip family. Dashed ones were measured on another chip, so they say less about yours."
    } else {
        "Each number names the card it was measured on."
    };
    format!(
        "<div data-panel=\"{tag}\"{hidden}><p class=\"sm panelnote\">{count} engines run on {label}, in alphabetical order. Listed engines only. {note}</p><div class=\"grid\">{cards}</div></div>",
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
        "<section class=\"blk\" id=\"picker\"><div class=\"sh\"><h2>What are you running?</h2><p>Pick a chip and meet the engines that run on it, A to Z.</p></div>\
         <div class=\"pk\" role=\"group\" aria-label=\"Hardware\">{buttons}</div>{panels}</section>"
    )
}

/// Published comparisons against a reference upstream, A to Z. Never sorted by gain.
fn comparisons(root: &str, catalog: &Catalog, facts: &Facts) -> String {
    let rows: Vec<(&Engine, &Benchmark)> =
        alphabetical(catalog).into_iter().filter_map(|engine| reference_comparison(engine).map(|b| (engine, b))).collect();
    let items: String = rows.iter().map(|(engine, benchmark)| feed_item(root, engine, benchmark, facts)).collect();
    format!(
        "<section class=\"blk\" id=\"comparisons\"><div class=\"sh\"><h2>Published comparisons</h2><p>Against llama.cpp or mlx-lm, as each author ran them. Listed A to Z, not ranked. Each names the chip it was measured on.</p></div><div class=\"feeds\">{items}</div></section>"
    )
}

fn recent(root: &str, catalog: &Catalog, facts: &Facts) -> String {
    let cards: String = catalog.engine.iter().rev().take(4).map(|engine| card(root, engine, headline(engine), false, facts)).collect();
    format!(
        "<section class=\"blk\" id=\"recent\"><div class=\"sh\"><h2>Recently added</h2><p>The last entries in the catalog file. Dates will come from the repository history.</p></div><div class=\"grid\">{cards}</div></section>"
    )
}

pub fn home(catalog: &Catalog, facts: &Facts) -> String {
    let root = "";
    let body = format!(
        "<div class=\"wrap\"><section class=\"top\"><h1>A database of local inference engines and forks</h1>\
         <p class=\"lede\">What each one is, who made it, its licence, the benchmarks its author published, and how we read them.</p>\
         <div class=\"cta\"><a class=\"btn\" href=\"{engines}\">Browse {count} engines</a><a class=\"btn two\" href=\"{how}\">How we choose</a></div></section>\
         {picker}{comparisons}{recent}\
         <section class=\"blk\" id=\"people\"><div class=\"sh\"><h2>The people behind them</h2><p>{people} developers and organisations so far.</p></div>{wall}</section>\
         <section class=\"blk\"><div class=\"sh\"><h2>How we choose</h2><p>What gets listed, what a review looks at, and how a published number is read. <a href=\"{how}\">Read how we choose</a>.</p></div></section></div>",
        engines = paths::section("engines"),
        how = paths::section("how-we-choose"),
        count = catalog.engine.len(),
        wall = wall(root, catalog),
        people = developers(catalog).len(),
        picker = picker(root, catalog, facts),
        comparisons = comparisons(root, catalog, facts),
        recent = recent(root, catalog, facts),
    );
    page(
        &Meta {
            title: "Kalsa: a database of local inference engines and forks",
            description: "A database of local inference engines and forks: what each is, who made it, its licence and the benchmarks its author published.",
            path: paths::HOME,
            active: "",
            scripts: &["site.js"],
        },
        &body,
    )
}
