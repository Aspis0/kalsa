//! Compare pages exist only for published pairs: an engine against the baseline its author measured, on one chip.

use kalsa_engines::Catalog;

use crate::bench::bench_block;
use crate::html::{escape, safe_href, slug};
use crate::layout::{page, Meta};
use crate::model::{pairs, Pair};
use crate::paths;
use crate::widgets::url_bar;

fn banner(pair: &Pair) -> String {
    let note = pair.engine.note.as_deref().map(|note| format!(" {}.", escape(note.trim_end_matches('.')))).unwrap_or_default();
    format!(
        "<div class=\"banner\"><div><b>Before you rely on this.</b><br>Both numbers come from the author of {engine}, who also chose the baseline and ran it. \
         Kalsa has not re-run either.{note}</div></div>",
        engine = escape(&pair.engine.name),
    )
}

pub fn compare_page(pair: &Pair) -> String {
    let path = paths::compare(&pair.slug());
    let blocks: String = pair.benchmarks.iter().map(|benchmark| bench_block(benchmark, pair.engine, None)).collect();
    let hardware = pair.benchmarks.first().map(|b| kalsa_engines::family_label(&b.chip_tag)).unwrap_or_default();
    let chip_page = if pair.chip.starts_with('M') { slug(&format!("Apple {}", pair.chip)) } else { slug(&hardware) };
    let title = format!("{} vs {} on {}", pair.engine.name, pair.baseline, pair.chip);
    let body = format!(
        "<div class=\"wrap\"><section class=\"pagehead\"><h1>{title}</h1><p class=\"lede\">Both sides come from {engine}'s own benchmark source, run on one machine by its author.</p>\
         <div class=\"chips\"><span class=\"chipx\"><em>Engine A</em> {engine}</span><span class=\"chipx\"><em>Engine B</em> {baseline}</span><span class=\"chipx\"><em>Chip</em> {chip}</span></div>\
         <p class=\"sm\">A comparison exists only when an author published both numbers on the same machine.</p><div class=\"gap\">{url}</div></section>\
         <section class=\"blk\"><div class=\"sh left\"><h2>Published numbers</h2></div><div class=\"bgrid\">{blocks}</div></section>{banner}\
         <section class=\"blk\"><div class=\"grid2\"><div class=\"panel\"><h3>On a different chip?</h3><p>These numbers come from {chip}. See what has been published for your own chip.</p>\
         <p><a class=\"lnk\" href=\"../../{hardware}\">Engines for {chip}</a> or <a class=\"lnk\" href=\"../../{engine_page}\">the {engine} page</a></p></div>\
         <div class=\"panel dash\"><h3>Measured by Kalsa users <span class=\"soon\">Coming soon</span></h3><p>The same pair, measured by people on their own Macs, will sit beside the author's numbers.</p></div></div></section></div>",
        title = escape(&title),
        engine = escape(&pair.engine.name),
        baseline = escape(pair.baseline),
        chip = escape(&pair.chip),
        url = url_bar(&path),
        banner = banner(pair),
        hardware = safe_href(&paths::hardware(&chip_page)),
        engine_page = safe_href(&paths::engine(&pair.engine.id)),
    );
    page(
        &Meta {
            title: &format!("{title} | Kalsa"),
            description: &format!("{} compared with {} on {}, using the numbers the author published.", pair.engine.name, pair.baseline, pair.chip),
            path: &path,
            active: "compare",
            scripts: &[],
        },
        &body,
    )
}

pub fn compare_index(catalog: &Catalog) -> String {
    let items: String = pairs(catalog)
        .iter()
        .map(|pair| {
            format!(
                "<li><a class=\"lnk\" href=\"../{}\">{} vs {} on {}</a></li>",
                safe_href(&paths::compare(&pair.slug())),
                escape(&pair.engine.name),
                escape(pair.baseline),
                escape(&pair.chip)
            )
        })
        .collect();
    let body = format!(
        "<div class=\"wrap\"><section class=\"pagehead\"><h1>Compare</h1><p class=\"lede\">Every pair here is a published one: an engine against the baseline its author measured, on one chip. Listed A to Z by engine. Pairs nobody has published do not exist on this site.</p></section>\
         <section class=\"blk\"><ul class=\"plain\">{items}</ul></section></div>"
    );
    page(&Meta { title: "Compare | Kalsa", description: "Published comparisons: an engine against the baseline its author measured.", path: &paths::section("compare"), active: "compare", scripts: &[] }, &body)
}
