//! Hardware pages: one per chip family and one per concrete chip a benchmark names, each a single list of the engines that run on it.

use kalsa_engines::{chip_label, family_label, Benchmark, Catalog, Engine, FAMILIES};

use crate::cards::card;
use crate::facts::Facts;
use crate::html::{escape, safe_href, slug};
use crate::layout::{page, Meta};
use crate::model::{alphabetical, closest_benchmark, hardware_pages, runs_on, HardwarePage};
use crate::paths;
use crate::phrase::platform_label;

/// The benchmark a card shows, and whether it comes from another chip than the page is about (it is then grey).
/// A concrete chip page prefers a number measured on exactly that chip; every other number is from another chip.
fn shown<'a>(hw: &HardwarePage, engine: &'a Engine) -> (Option<&'a Benchmark>, bool) {
    if let Some(chip) = &hw.chip {
        let exact = engine.benchmark.iter().find(|benchmark| benchmark.chip_tag == hw.tag && chip_label(benchmark) == *chip && benchmark.gains.headline().is_some());
        if exact.is_some() {
            return (exact, false);
        }
        return (closest_benchmark(engine, &hw.tag).map(|(_, benchmark)| benchmark), true);
    }
    match closest_benchmark(engine, &hw.tag) {
        Some((distance, benchmark)) => (Some(benchmark), distance != 0),
        None => (None, false),
    }
}

fn family_links() -> String {
    FAMILIES
        .iter()
        .map(|tag| format!("<a class=\"chipx\" href=\"../../{}\">{}</a>", safe_href(&paths::hardware(&slug(&family_label(tag)))), escape(&family_label(tag))))
        .collect()
}

pub fn hardware_page(hw: &HardwarePage, catalog: &Catalog, facts: &Facts) -> String {
    let path = paths::hardware(&hw.slug);
    let engines: Vec<&Engine> = alphabetical(catalog).into_iter().filter(|engine| runs_on(engine, &hw.tag)).collect();
    let platform = platform_label(&hw.tag);
    let cards: String = engines
        .iter()
        .map(|engine| {
            let (benchmark, weak) = shown(hw, engine);
            card("../../", engine, benchmark, weak, facts, Some(&platform))
        })
        .collect();
    let body = format!(
        "<div class=\"wrap\"><section class=\"pagehead\"><div class=\"crumb\">Hardware / {title}</div><h1>Engines for {title}</h1>\
         <p class=\"lede\">{count} {verb} on {title}.</p>\
         <div class=\"chips\"><span class=\"sm\">Other hardware:</span>{links}</div></section>\
         <div class=\"grid listgrid\">{cards}</div></div>",
        title = escape(&hw.title),
        count = engines.len(),
        verb = if engines.len() == 1 { "engine runs" } else { "engines run" },
        links = family_links(),
    );
    page_with(&path, &format!("Engines for {} | Kalsa", hw.title), &format!("The engines that run on {}, with the benchmarks their authors published.", hw.title), &body)
}

fn page_with(path: &str, title: &str, description: &str, body: &str) -> String {
    page(&Meta { title, description, path, active: "hardware", scripts: &["site.js"] }, body)
}

fn heading(title: &str, note: &str) -> String {
    format!("<div class=\"sh left\"><h2>{title}</h2>{}</div>", if note.is_empty() { String::new() } else { format!("<p>{note}</p>") })
}

pub fn hardware_index(catalog: &Catalog) -> String {
    let pages = hardware_pages(catalog);
    let item = |p: &HardwarePage| format!("<li><a class=\"lnk\" href=\"../{}\">{}</a></li>", safe_href(&paths::hardware(&p.slug)), escape(&p.title));
    let families: String = pages.iter().filter(|p| p.chip.is_none()).map(item).collect();
    let chips: String = pages.iter().filter(|p| p.chip.is_some()).map(item).collect();
    let body = format!(
        "<div class=\"wrap\"><section class=\"pagehead\"><h1>Hardware</h1><p class=\"lede\">Pick a chip to see the engines that run on it.</p></section>\
         <section class=\"blk\">{}<ul class=\"plain\">{families}</ul></section><section class=\"blk\">{}<ul class=\"plain\">{chips}</ul></section></div>",
        heading("Chip families", ""),
        heading("Chips named in benchmarks", "Each appears because an author measured on it."),
    );
    page_with(&paths::section("hardware"), "Hardware | Kalsa", "Local inference engines by the chip they run on.", &body)
}
