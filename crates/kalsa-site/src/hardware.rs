//! Hardware pages: one per chip family, one per concrete chip a benchmark names, and the index.

use kalsa_engines::{chip_label, family_label, gain_of, not_for_reason, Benchmark, Catalog, Engine, ImprovementKind, Kind, FAMILIES};

use crate::bench::bench_block;
use crate::cards::{avatar, card, tags};
use crate::facts::Facts;
use crate::html::{escape, safe_href};
use crate::layout::{page, Meta};
use crate::model::{alphabetical, author_name, closest_benchmark, hardware_pages, is_org, login, runs_on, HardwarePage};
use crate::paths;
use crate::phrase::{baseline_of, metric_summary, Baseline};
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
        None => ("About the same speed".to_string(), " noise"),
    };
    format!(
        "<div class=\"hero\"><div><div class=\"ch\">{avatar}<div class=\"nm\"><b>{name}</b><span>by {author}</span></div></div>\
         <div class=\"meta\"><span class=\"wh same\">Measured on this chip: {chip}</span></div>\
         <p><span class=\"big num{noise}\">{gain}</span> <span class=\"sm\">{labels}{against}</span></p><p>{summary}</p><div class=\"tags\">{tags}</div>\
         <p><a class=\"btn\" href=\"../../{href}\">See the numbers</a></p></div>{block}</div>",
        avatar = avatar(login(engine), "md", is_org(engine)),
        name = escape(&engine.name),
        author = escape(author_name(engine)),
        chip = escape(&chip_label(benchmark)),
        noise = noise,
        gain = escape(&big),
        labels = escape(&metric_summary(&benchmark.gains)),
        against = match baseline_of(benchmark) {
            Baseline::Engine(name) => format!(", against {}", escape(name)),
            Baseline::FeatureOff => ", against the same build with the feature off".to_string(),
            Baseline::Other => String::new(),
        },
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
        [] => format!("<p class=\"sm\">No engine has published a benchmark from {} yet.</p>", escape(&hw.title)),
        [(engine, benchmark)] if hw.chip.is_some() => hero(engine, benchmark, &hw.title, facts),
        many => format!("<div class=\"grid\">{}</div>", many.iter().map(|(engine, benchmark)| card("../../", engine, Some(benchmark), false, facts)).collect::<String>()),
    };
    format!("<section class=\"blk\">{}{body}</section>", heading(&format!("Measured on {}", escape(&hw.title)), "Their authors measured these on this chip."))
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
    format!("<section class=\"blk\">{}<div class=\"grid\">{cards}</div></section>", heading("Measured on other chips", "These run here, but their authors measured a different chip, so the numbers say less about yours. Grey marks them."))
}

fn reference_section(hw: &HardwarePage, catalog: &Catalog, facts: &Facts) -> String {
    let cards: String = alphabetical(catalog).into_iter().filter(|e| e.kind == Kind::Reference && runs_on(e, &hw.tag)).map(|e| card("../../", e, None, false, facts)).collect();
    if cards.is_empty() {
        return String::new();
    }
    format!("<section class=\"blk\">{}<div class=\"grid\">{cards}</div></section>", heading("Reference engines", "These are the reference upstreams. They have no benchmarks of their own."))
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
    format!("<section class=\"blk\">{}<div class=\"grid\">{cards}</div></section>", heading("Not recommended", "These run here, but we don't recommend them. Each card says why."))
}

fn without_number(hw: &HardwarePage, catalog: &Catalog) -> String {
    let panels: String = alphabetical(catalog)
        .into_iter()
        .filter(|e| e.recommendable && e.kind != Kind::Reference && runs_on(e, &hw.tag) && closest_benchmark(e, &hw.tag).is_none())
        .map(|engine| {
            let text = match engine.benchmark.iter().find(|b| gain_of(b).is_some()) {
                Some(b) => format!("It runs here, but the author only published a benchmark on {}.", escape(&chip_label(b))),
                None => "It runs here, and the author hasn't published benchmarks yet.".to_string(),
            };
            format!("<div class=\"panel\"><h3>{}</h3><p>{text}</p></div>", escape(&engine.name))
        })
        .collect();
    if panels.is_empty() { String::new() } else { format!("<section class=\"blk\">{}<div class=\"grid2\">{panels}</div></section>", heading("Runs here, no benchmark for this chip yet", "")) }
}

/// Bigger models measured on this chip family. Only declared rows: with none, the block is not there.
fn larger_models_section(hw: &HardwarePage, catalog: &Catalog) -> String {
    if hw.chip.is_some() {
        return String::new();
    }
    let rows: String = alphabetical(catalog)
        .into_iter()
        .flat_map(|engine| engine.improvement.iter().map(move |item| (engine, item)))
        .filter(|(_, item)| item.kind == ImprovementKind::BiggerModels && item.chip_tag.as_deref() == Some(hw.tag.as_str()))
        .map(|(engine, item)| {
            format!(
                "<tr><td><a class=\"lnk\" href=\"../../{page}\">{name}</a></td><td>{model}</td><td class=\"num\">{size} GiB on {memory} GB, {speed} tok/s</td><td>{machine}</td>\
                 <td><a class=\"lnk\" href=\"{source}\">Source</a>{tradeoff}</td></tr>",
                page = safe_href(&paths::engine(&engine.id)),
                name = escape(&engine.name),
                model = escape(item.model.as_deref().unwrap_or_default()),
                size = item.model_gib.unwrap_or_default(),
                memory = item.memory_gb.unwrap_or_default(),
                speed = item.tok_s.unwrap_or_default(),
                machine = escape(&item.machine),
                source = safe_href(&item.source),
                tradeoff = item.tradeoff.as_deref().map(|text| format!(" · {}", escape(text))).unwrap_or_default(),
            )
        })
        .collect();
    if rows.is_empty() {
        return String::new();
    }
    format!(
        "<section class=\"blk\">{}<div class=\"scrollx\"><table class=\"tbl\"><thead><tr><th>Engine</th><th>Model</th><th>Size, memory, speed</th><th>Machine</th><th>Source and trade-off</th></tr></thead><tbody>{rows}</tbody></table></div></section>",
        heading("Larger models on this hardware", "Their authors report these, each with the machine it ran on.")
    )
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
         <p class=\"lede\">Numbers measured on {title} come first. Numbers from other chips come after, in grey, because a faster or slower chip says little about yours. Engines are listed A to Z.</p>\
         <div class=\"chips\"><span class=\"sm\">Other hardware:</span>{links}</div><div class=\"gap\">{url}</div></section>\
         {same}{other}{larger}{refs}{none}{notrec}\
         {off}</div>",
        title = escape(&hw.title),
        links = family_links(),
        url = url_bar(&path),
        same = same_section(hw, catalog, facts),
        other = other_section(hw, catalog, facts),
        larger = larger_models_section(hw, catalog),
        refs = reference_section(hw, catalog, facts),
        none = without_number(hw, catalog),
        notrec = not_recommended_section(hw, catalog, facts),
        off = not_here(hw, catalog),
    );
    page_with(&path, &format!("Engines for {} | Kalsa", hw.title), &format!("The engines that run on {}, and the benchmarks their authors measured on it.", hw.title), &body)
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
