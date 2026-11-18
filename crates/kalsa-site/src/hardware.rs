//! Hardware pages: one per chip family, one per concrete chip a benchmark names, and the index.

use kalsa_engines::{chip_label, family_label, gain_of, not_for_reason, Benchmark, Catalog, Engine, Kind, FAMILIES};

use crate::bench::bench_block;
use crate::cards::{avatar, card, metric_labels, tags};
use crate::facts::Facts;
use crate::html::{escape, safe_href};
use crate::layout::{page, Meta};
use crate::model::{alphabetical, author_name, closest_benchmark, hardware_pages, is_org, login, runs_on, HardwarePage};
use crate::paths;
use crate::widgets::url_bar;

/// A benchmark is "same chip" for a family page when the tag matches, for a concrete page when the chip label does.
fn is_same(hw: &HardwarePage, benchmark: &Benchmark) -> bool {
    match &hw.chip {
        Some(chip) => benchmark.chip_tag == hw.tag && chip_label(benchmark) == *chip,
        None => benchmark.chip_tag == hw.tag,
    }
}

fn same_benchmark<'a>(hw: &HardwarePage, engine: &'a Engine) -> Option<&'a Benchmark> {
    engine.benchmark.iter().find(|benchmark| gain_of(benchmark).is_some() && is_same(hw, benchmark))
}

fn heading(title: &str, note: &str) -> String {
    format!("<div class=\"sh left\"><h2>{title}</h2>{}</div>", if note.is_empty() { String::new() } else { format!("<p>{note}</p>") })
}

fn hero(engine: &Engine, benchmark: &Benchmark, title: &str, facts: &Facts) -> String {
    if benchmark.gains.headline().is_none() {
        return String::new();
    }
    let (big, noise) = match benchmark.gains.cleared() {
        Some(gain) => (gain.gain_label.clone(), ""),
        None => ("No gain above noise published".to_string(), " noise"),
    };
    format!(
        "<div class=\"hero\"><div><div class=\"ch\">{avatar}<div class=\"nm\"><b>{name}</b><span>by {author}</span></div></div>\
         <div class=\"meta\"><span class=\"wh same\">Measured on {chip}, same chip</span><span class=\"cl\">Claimed by the author</span></div>\
         <p><span class=\"big num{noise}\">{gain}</span> <span class=\"sm\">{labels} vs {baseline}</span></p><p>{summary}.</p><div class=\"tags\">{tags}</div>\
         <p><a class=\"btn\" href=\"../../{href}\">See the numbers</a></p></div>{block}</div>",
        avatar = avatar(login(engine), "md", is_org(engine)),
        name = escape(&engine.name),
        author = escape(author_name(engine)),
        chip = escape(&chip_label(benchmark)),
        noise = noise,
        gain = escape(&big),
        labels = metric_labels(&benchmark.gains),
        baseline = escape(&benchmark.baseline),
        summary = escape(&engine.summary),
        tags = tags(engine, facts),
        href = safe_href(&paths::engine(&engine.id)),
        block = bench_block(benchmark, engine, Some(title.trim_start_matches("Apple "))),
    )
}

fn same_section(hw: &HardwarePage, catalog: &Catalog, facts: &Facts) -> String {
    let same: Vec<(&Engine, &Benchmark)> = alphabetical(catalog)
        .into_iter()
        .filter(|engine| runs_on(engine, &hw.tag) && engine.recommendable)
        .filter_map(|engine| same_benchmark(hw, engine).map(|benchmark| (engine, benchmark)))
        .collect();
    let body = match same.as_slice() {
        [] => format!("<p class=\"sm\">Nothing has been published from {} yet.</p>", escape(&hw.title)),
        [(engine, benchmark)] if hw.chip.is_some() => hero(engine, benchmark, &hw.title, facts),
        many => format!("<div class=\"grid\">{}</div>", many.iter().map(|(engine, benchmark)| card("../../", engine, Some(benchmark), false, facts)).collect::<String>()),
    };
    format!("<section class=\"blk\">{}{body}</section>", heading(&format!("Measured on {}", escape(&hw.title)), "Same chip, claimed by the authors."))
}

fn other_section(hw: &HardwarePage, catalog: &Catalog, facts: &Facts) -> String {
    let cards: String = alphabetical(catalog)
        .into_iter()
        .filter(|engine| runs_on(engine, &hw.tag) && engine.recommendable && same_benchmark(hw, engine).is_none())
        .filter_map(|engine| closest_benchmark(engine, &hw.tag).map(|(_, benchmark)| (engine, benchmark)))
        .map(|(engine, benchmark)| card("../../", engine, Some(benchmark), true, facts))
        .collect();
    if cards.is_empty() {
        return String::new();
    }
    format!("<section class=\"blk\">{}<div class=\"grid\">{cards}</div></section>", heading("Measured on other chips", "They run here, but the number comes from a different chip. Weaker evidence, shown dashed."))
}

fn reference_section(hw: &HardwarePage, catalog: &Catalog, facts: &Facts) -> String {
    let cards: String = alphabetical(catalog).into_iter().filter(|e| e.kind == Kind::Reference && runs_on(e, &hw.tag)).map(|e| card("../../", e, None, false, facts)).collect();
    if cards.is_empty() {
        return String::new();
    }
    format!("<section class=\"blk\">{}<div class=\"grid\">{cards}</div></section>", heading("Reference engines", "Nothing to compare against. Everything else is measured against these."))
}

/// Engines that run here but that the catalog does not recommend. They are listed, with the reason on the card.
fn not_recommended_section(hw: &HardwarePage, catalog: &Catalog, facts: &Facts) -> String {
    let cards: String = alphabetical(catalog)
        .into_iter()
        .filter(|engine| !engine.recommendable && runs_on(engine, &hw.tag))
        .map(|engine| card("../../", engine, closest_benchmark(engine, &hw.tag).map(|(_, benchmark)| benchmark), true, facts))
        .collect();
    if cards.is_empty() {
        return String::new();
    }
    format!("<section class=\"blk\">{}<div class=\"grid\">{cards}</div></section>", heading("Not recommended", "They run here, but the catalog does not recommend them. The reason is on each card."))
}

fn without_number(hw: &HardwarePage, catalog: &Catalog) -> String {
    let panels: String = alphabetical(catalog)
        .into_iter()
        .filter(|e| e.recommendable && e.kind != Kind::Reference && runs_on(e, &hw.tag) && closest_benchmark(e, &hw.tag).is_none())
        .map(|engine| {
            let text = match engine.benchmark.iter().find(|b| gain_of(b).is_some()) {
                Some(b) => format!("It runs here, but the author published only a number from {} ({} vs {}).", escape(&chip_label(b)), escape(&b.gains.label()), escape(&b.baseline)),
                None => "It runs here, and no comparison has been published.".to_string(),
            };
            format!("<div class=\"panel\"><h3>{}</h3><p>{text}</p></div>", escape(&engine.name))
        })
        .collect();
    if panels.is_empty() { String::new() } else { format!("<section class=\"blk\">{}<div class=\"grid2\">{panels}</div></section>", heading("Runs here, no number for it", "")) }
}

fn not_here(hw: &HardwarePage, catalog: &Catalog) -> String {
    let rows: String = alphabetical(catalog)
        .into_iter()
        .filter(|engine| !runs_on(engine, &hw.tag))
        .map(|engine| format!("<tr><td>{}</td><td>{}</td></tr>", escape(&engine.name), escape(&not_for_reason(&engine.hardware))))
        .collect();
    format!(
        "<section class=\"blk\"><details class=\"dets\"><summary>Doesn't run on {}</summary><div class=\"scrollx\"><table class=\"tbl\"><thead><tr><th>Engine</th><th>Why</th></tr></thead><tbody>{rows}</tbody></table></div></details></section>",
        escape(&family_label(&hw.tag))
    )
}

fn family_links() -> String {
    FAMILIES
        .iter()
        .map(|tag| format!("<a class=\"chipx\" href=\"../../{}\">{}</a>", safe_href(&paths::hardware(&crate::html::slug(&family_label(tag)))), escape(&family_label(tag))))
        .collect()
}

pub fn hardware_page(hw: &HardwarePage, catalog: &Catalog, facts: &Facts) -> String {
    let path = paths::hardware(&hw.slug);
    let body = format!(
        "<div class=\"wrap\"><section class=\"pagehead\"><div class=\"crumb\">Hardware / {title}</div><h1>Engines for {title}</h1>\
         <p class=\"lede\">Numbers measured on {title} come first. Numbers from other chips come after, marked as weaker evidence, because a faster or slower chip says little about how an engine behaves on yours. Lists are A to Z.</p>\
         <p class=\"onlyv\">Listed engines only. Community listings are not shown here and are never recommended.</p>\
         <div class=\"chips\"><span class=\"sm\">Other hardware:</span>{links}</div><div class=\"gap\">{url}</div></section>\
         {same}{other}{refs}{none}{notrec}\
         <section class=\"blk\"><div class=\"grid2\"><div class=\"panel\"><h3>Your Mac</h3><p>Not measured yet. Measuring on your own Mac arrives with the chat in the Kalsa app, and the real tok/s will then sit next to the author's claim.</p></div>\
         <div class=\"panel dash\"><h3>Measured by Kalsa users <span class=\"soon\">Coming soon</span></h3><p>A per-chip table from opt-in measurements on real machines. Not available yet, and nothing here is invented.</p></div></div></section>{off}</div>",
        title = escape(&hw.title),
        links = family_links(),
        url = url_bar(&path),
        same = same_section(hw, catalog, facts),
        other = other_section(hw, catalog, facts),
        refs = reference_section(hw, catalog, facts),
        none = without_number(hw, catalog),
        notrec = not_recommended_section(hw, catalog, facts),
        off = not_here(hw, catalog),
    );
    page_with(&path, &format!("Engines for {} | Kalsa", hw.title), &format!("Local inference engines for {}, with numbers measured on the same chip first and other chips marked as weaker evidence.", hw.title), &body)
}

fn page_with(path: &str, title: &str, description: &str, body: &str) -> String {
    page(&Meta { title, description, path, active: "hardware", scripts: &["site.js"] }, body)
}

pub fn hardware_index(catalog: &Catalog) -> String {
    let pages = hardware_pages(catalog);
    let item = |p: &HardwarePage| format!("<li><a class=\"lnk\" href=\"../{}\">{}</a></li>", safe_href(&paths::hardware(&p.slug)), escape(&p.title));
    let families: String = pages.iter().filter(|p| p.chip.is_none()).map(item).collect();
    let chips: String = pages.iter().filter(|p| p.chip.is_some()).map(item).collect();
    let body = format!(
        "<div class=\"wrap\"><section class=\"pagehead\"><h1>Hardware</h1><p class=\"lede\">Engines by the chip they run on. A chip family page lists every engine that runs on it; a concrete chip page puts numbers measured on that exact chip first.</p></section>\
         <section class=\"blk\">{}<ul class=\"plain\">{families}</ul></section><section class=\"blk\">{}<ul class=\"plain\">{chips}</ul></section></div>",
        heading("Chip families", ""),
        heading("Chips named in published benchmarks", "Each appears because an author measured on it."),
    );
    page_with(&paths::section("hardware"), "Hardware | Kalsa", "Local inference engines by the chip they run on.", &body)
}
