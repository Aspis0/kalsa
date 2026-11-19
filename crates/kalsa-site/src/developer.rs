//! One page per developer: their engines, the benchmarks they published, and the links.

use kalsa_engines::{chip_label, gain_of, Catalog, Engine};

use crate::cards::{avatar, card, github_url};
use crate::counts::phrase;
use crate::facts::Facts;
use crate::html::{escape, safe_href};
use crate::layout::{page, Meta};
use crate::model::{developers, Developer};
use crate::paths;
use crate::phrase::metric_summary;
use crate::widgets::claim_line;

fn comparison_rows(engines: &[&Engine]) -> String {
    let mut rows = String::new();
    for engine in engines {
        for benchmark in engine.benchmark.iter().filter(|b| gain_of(b).is_some()) {
            rows += &format!(
                "<tr data-engine=\"{id}\"><td>{engine}</td><td>{model}</td><td>{quant}</td><td>{chip}</td><td>{gains}</td><td>{baseline}</td></tr>",
                id = escape(&engine.id),
                engine = escape(&engine.name),
                model = escape(&benchmark.model),
                quant = escape(&benchmark.quant),
                chip = escape(&chip_label(benchmark)),
                gains = escape(&metric_summary(&benchmark.gains)),
                baseline = escape(&benchmark.baseline),
            );
        }
    }
    rows
}

/// The gains that clear the 5% bar, as a range, or as one value when they are all the same.
fn gain_range(engines: &[&Engine]) -> String {
    let cleared: Vec<_> = engines.iter().flat_map(|e| &e.benchmark).filter_map(|b| b.gains.cleared()).collect();
    let low = cleared.iter().min_by(|a, b| a.ratio.total_cmp(&b.ratio));
    let high = cleared.iter().max_by(|a, b| a.ratio.total_cmp(&b.ratio));
    match (low, high) {
        (Some(low), Some(high)) if low.gain_label == high.gain_label => low.gain_label.clone(),
        (Some(low), Some(high)) => format!("{} to {}", low.gain_label, high.gain_label),
        _ => "No gain over 5% yet".to_string(),
    }
}

/// The engine count is recomputed by the Worker when one of them is removed. The other two figures come
/// from the catalog's own gain rules, so the whole block goes instead of showing a stale number.
fn stats(developer: &Developer) -> String {
    let comparisons: usize = developer.engines.iter().flat_map(|e| &e.benchmark).filter(|b| gain_of(b).is_some()).count();
    let stat = |value: String, label: &str| format!("<div class=\"stat\"><b>{}</b><span>{label}</span></div>", escape(&value));
    let scope = format!("dev:{}", developer.login);
    let listed = format!(
        "<div class=\"stat\">{}{}</div>",
        phrase(&scope, developer.engines.len(), "{n}", "{n}"),
        phrase(&scope, developer.engines.len(), "Engine listed", "Engines listed"),
    );
    format!(
        "<div class=\"stats\" data-dev-stats=\"{}\">{listed}{}{}</div>",
        escape(developer.login),
        stat(comparisons.to_string(), if comparisons == 1 { "Benchmark" } else { "Benchmarks" }),
        stat(gain_range(&developer.engines), "Range of gains"),
    )
}

pub fn developer_page(developer: &Developer, facts: &Facts) -> String {
    let path = paths::developer(developer.login);
    let cards: String = developer.engines.iter().map(|engine| card("../../", engine, crate::model::headline(engine), false, facts, None)).collect();
    let rows = comparison_rows(&developer.engines);
    let table = if rows.is_empty() {
        "<p class=\"sm\">These engines have no benchmarks yet.</p>".to_string()
    } else {
        format!("<div class=\"scrollx\"><table class=\"tbl\"><thead><tr><th>Engine</th><th>Model</th><th>Quant</th><th>Chip</th><th>Gains</th><th>Against</th></tr></thead><tbody>{rows}</tbody></table></div>")
    };
    let body = format!(
        "<div class=\"wrap\" data-dev=\"{login}\"><div class=\"crumb\">Developers / {login}</div><div class=\"devhead\">{avatar}<div><h1>{login}</h1>\
         <p class=\"sm\">{name} on Kalsa. The avatar and username come from the public GitHub profile.</p>\
         <div class=\"acts\"><a class=\"btn two\" href=\"{github}\">github.com/{login}</a></div></div></div>{stats}\
         <section class=\"blk\"><div class=\"sh left\"><h2>Engines</h2></div><div class=\"grid\">{cards}</div></section>\
         <section class=\"blk\"><div class=\"sh left\"><h2>Benchmarks</h2><p>Each engine's author measured these. The engine page links the source.</p></div>{table}</section>\
         {claim}</div>",
        login = escape(developer.login),
        avatar = avatar(developer.login, "lg", developer.org),
        name = escape(developer.name),
        github = safe_href(&github_url(developer.login)),
        stats = stats(developer),
        claim = claim_line(&path, "developer", developer.login),
    );
    page(
        &Meta {
            title: &format!("{} | Kalsa developer", developer.login),
            description: &format!("{} on Kalsa: their engines and the benchmarks they published.", developer.login),
            path: &path,
            active: "",
            scripts: &["site.js"],
        },
        &body,
    )
}

pub fn developer_pages(catalog: &Catalog, facts: &Facts) -> Vec<(std::path::PathBuf, String)> {
    developers(catalog).iter().map(|d| (paths::developer(d.login).into(), developer_page(d, facts))).collect()
}
