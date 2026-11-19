//! Small pieces shared by the home, engines, hardware and developer pages: avatars, tags, cards.

use kalsa_engines::{hardware_labels, improvement_kinds, Benchmark, Engine, Kind, MetricGain};

use crate::facts::Facts;
use crate::html::{escape, safe_href};
use crate::model::{author_name, is_org, login, recheck_pending};
use crate::paths;
use crate::phrase::{baseline_of, Baseline};

pub fn github_url(repo: &str) -> String {
    format!("https://github.com/{repo}")
}

/// A public GitHub avatar. The initial shows until the image loads (or if it never does).
pub fn avatar(login: &str, size: &str, org: bool) -> String {
    let initial = login.chars().next().map(|c| c.to_ascii_uppercase().to_string()).unwrap_or_default();
    format!(
        "<span class=\"av {size}{org}\" data-i=\"{initial}\"><img src=\"{src}\" alt=\"\" loading=\"lazy\"></span>",
        org = if org { " org" } else { "" },
        initial = escape(&initial),
        src = safe_href(&format!("https://github.com/{login}.png?size=120")),
    )
}

/// The pill shows only on a reviewed entry. No review, no pill.
pub fn badge_pill(engine: &Engine, facts: &Facts) -> String {
    if engine.review_declined.is_some() {
        return String::new();
    }
    match &engine.reviewed {
        None => String::new(),
        Some(_) if recheck_pending(engine, facts) => {
            "<span class=\"bpill pending\" title=\"New commits since the review\">New commits since review</span>".to_string()
        }
        Some(_) => "<span class=\"bpill reviewed\" title=\"Reviewed at a specific commit\">Reviewed</span>".to_string(),
    }
}

fn kind_class(kind: Kind) -> &'static str {
    match kind {
        Kind::Reference => "reference",
        Kind::Fork => "fork",
        Kind::Engine => "engine",
    }
}

pub fn tags(engine: &Engine, facts: &Facts) -> String {
    let hardware: String = hardware_labels(&engine.hardware)
        .iter()
        .map(|label| {
            let class = if label.starts_with("Apple") { "apple".to_string() } else { label.to_lowercase() };
            format!("<span class=\"tg {class}\">{}</span>", escape(label))
        })
        .collect();
    format!(
        "{pill}{hardware}<span class=\"tg {kind}\">{label}</span><span class=\"tg lic\">{licence}</span>",
        pill = badge_pill(engine, facts),
        kind = kind_class(engine.kind),
        label = engine.kind.label(),
        licence = escape(&engine.license),
    )
}

/// What the engine improves, in plain words: at most three tags, so a card stays quiet.
fn improvement_tags(engine: &Engine) -> String {
    let tags: String = improvement_kinds(engine).iter().take(3).map(|kind| format!("<span class=\"tg imp\">{}</span>", kind.label())).collect();
    if tags.is_empty() { tags } else { format!("<div class=\"tags imps\">{tags}</div>") }
}

/// One plain line: "+47% faster decoding than llama.cpp on M2 Pro". A gain that clears 5% leads, then a loss, then "about the same".
/// The "than" clause appears only for a catalog engine or a feature switched off; any other baseline stays out of the card.
fn benchmark_line(benchmark: &Benchmark) -> String {
    let gains = &benchmark.gains;
    let chip = escape(&kalsa_engines::chip_label(benchmark));
    let baseline = baseline_of(benchmark);
    let than = match &baseline {
        Baseline::Engine(name) => format!(" than {}", escape(name)),
        Baseline::FeatureOff => " than without it".to_string(),
        Baseline::Other => String::new(),
    };
    let metrics = [("decoding", &gains.decode), ("prompt reading", &gains.prefill)];
    let found = |keep: fn(&MetricGain) -> bool| metrics.iter().find_map(|(noun, gain)| gain.as_ref().filter(|gain| keep(gain)).map(|gain| (*noun, gain)));
    if let Some((noun, gain)) = found(MetricGain::is_gain) {
        return format!("{} faster {noun}{than} on {chip}", escape(&gain.gain_label));
    }
    if let Some((noun, gain)) = found(|gain| !gain.noise) {
        return format!("{}% slower {noun}{than} on {chip}", ((1.0 - gain.ratio) * 100.0).round());
    }
    match baseline {
        Baseline::Engine(name) => format!("About the same speed as {} on {chip}", escape(name)),
        Baseline::FeatureOff => format!("About the same speed with or without it on {chip}"),
        Baseline::Other => format!("About the same speed as its baseline on {chip}"),
    }
}

fn relation(engine: &Engine) -> String {
    match &engine.upstream {
        Some(upstream) => format!(
            "<span class=\"rel\">{} {}</span>",
            if engine.kind == Kind::Fork { "Fork of" } else { "Built on" },
            escape(upstream)
        ),
        None => String::new(),
    }
}

fn warning(engine: &Engine) -> String {
    let note = engine.note.as_deref().unwrap_or("The catalog does not recommend it");
    note.replacen("Not recommendable:", "Not recommended:", 1)
}

/// What a card says about benchmarks. A non-recommendable engine shows its warning first and its numbers in grey.
fn comparison_area(engine: &Engine, benchmark: Option<&Benchmark>, weak: bool) -> String {
    let line = benchmark.filter(|found| found.gains.headline().is_some()).map(benchmark_line);
    let grey = if weak || !engine.recommendable { " weak" } else { "" };
    let numbers = line.map(|text| format!("<span class=\"cmpl{grey}\">{text}</span>"));
    if !engine.recommendable {
        return format!("<span class=\"none warn\">{}</span>{}", escape(&warning(engine)), numbers.unwrap_or_default());
    }
    match numbers {
        Some(found) => found,
        None if engine.kind == Kind::Reference => "<span class=\"none\">The reference engine</span>".to_string(),
        None => "<span class=\"none\">No benchmarks yet</span>".to_string(),
    }
}

/// An engine card. `weak` marks a number measured on another chip than the page is about.
pub fn card(root: &str, engine: &Engine, benchmark: Option<&Benchmark>, weak: bool, facts: &Facts) -> String {
    format!(
        "<a class=\"card\" href=\"{href}\" data-id=\"{id}\"><div class=\"ch\">{avatar}<div class=\"nm\"><b>{name}</b><span>by {author}</span></div>\
         </div><p class=\"sum\">{summary}</p>{relation}\
         <div class=\"tags\">{tags}</div>{improvements}<div class=\"cmpw\">{area}</div></a>",
        href = safe_href(&format!("{root}{}", paths::engine(&engine.id))),
        id = escape(&engine.id),
        avatar = avatar(login(engine), "md", is_org(engine)),
        name = escape(&engine.name),
        author = escape(author_name(engine)),
        summary = escape(&engine.summary),
        relation = relation(engine),
        tags = tags(engine, facts),
        improvements = improvement_tags(engine),
        area = comparison_area(engine, benchmark, weak),
    )
}
