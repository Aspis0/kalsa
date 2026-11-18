//! Small pieces shared by the home, engines, hardware and developer pages: avatars, tags, cards.

use kalsa_engines::{hardware_labels, Benchmark, Engine, Gains, Kind};

use crate::facts::Facts;
use crate::html::{escape, safe_href};
use crate::model::{author_name, is_org, login, recheck_pending};
use crate::paths;

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
    match &engine.reviewed {
        None => String::new(),
        Some(_) if recheck_pending(engine, facts) => {
            "<span class=\"bpill pending\" title=\"A newer commit has landed since the review\">Reviewed, re-check pending</span>".to_string()
        }
        Some(_) => "<span class=\"bpill reviewed\" title=\"Kalsa checked the code at a commit\">Reviewed</span>".to_string(),
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

/// "prefill +35% · decode +1%, within noise": the metric that clears the 5% bar leads, a small one is muted.
pub fn metric_labels(gains: &Gains) -> String {
    gains
        .ordered()
        .into_iter()
        .map(|gain| format!("<span class=\"mg{}\">{}</span>", if gain.noise { " noise" } else { "" }, escape(&gain.label)))
        .collect::<Vec<_>>()
        .join(" · ")
}

/// The headline is the metric that clears 5%; when neither does the card says so, and still shows the figures.
pub fn cmp_chip(benchmark: &Benchmark, weak: bool) -> String {
    let gains = &benchmark.gains;
    if gains.headline().is_none() {
        return String::new();
    }
    let weak = if weak { " weak" } else { "" };
    let rest = format!(
        "<span class=\"k\">{labels} vs {baseline}</span><span class=\"m\">Measured on {chip}</span>",
        labels = metric_labels(gains),
        baseline = escape(&benchmark.baseline),
        chip = escape(&kalsa_engines::chip_label(benchmark)),
    );
    match gains.cleared() {
        Some(head) => format!("<div class=\"cmp{weak}\"><span class=\"g num\">{}</span>{rest}</div>", escape(&head.gain_label)),
        None => format!("<div class=\"cmp flat{weak}\"><span class=\"k\"><b>No gain above noise published</b></span>{rest}</div>"),
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

/// What a card says about numbers. A non-recommendable engine shows its warning first and its numbers muted.
fn comparison_area(engine: &Engine, benchmark: Option<&Benchmark>, weak: bool) -> String {
    let numbers = benchmark
        .filter(|found| found.gains.headline().is_some())
        .map(|found| format!("{}<span class=\"cl\">Claimed by the author</span>", cmp_chip(found, weak || !engine.recommendable)));
    if !engine.recommendable {
        return format!("<span class=\"none warn\">{}</span>{}", escape(&warning(engine)), numbers.unwrap_or_default());
    }
    match numbers {
        Some(found) => found,
        None if engine.kind == Kind::Reference => "<span class=\"none\">Reference engine: the baseline others compare against.</span>".to_string(),
        None => "<span class=\"none\">No comparison published for this hardware yet.</span>".to_string(),
    }
}

/// An engine card. `weak` marks a number measured on another chip than the page is about.
pub fn card(root: &str, engine: &Engine, benchmark: Option<&Benchmark>, weak: bool, facts: &Facts) -> String {
    format!(
        "<a class=\"card\" href=\"{href}\" data-id=\"{id}\"><div class=\"ch\">{avatar}<div class=\"nm\"><b>{name}</b><span>by {author}</span></div>\
         <span class=\"like\" title=\"Likes are coming soon\">&#9825;<i>soon</i></span></div><p class=\"sum\">{summary}.</p>{relation}\
         <div class=\"tags\">{tags}</div><div class=\"cmpw\">{area}</div></a>",
        href = safe_href(&format!("{root}{}", paths::engine(&engine.id))),
        id = escape(&engine.id),
        avatar = avatar(login(engine), "md", is_org(engine)),
        name = escape(&engine.name),
        author = escape(author_name(engine)),
        summary = escape(&engine.summary),
        relation = relation(engine),
        tags = tags(engine, facts),
        area = comparison_area(engine, benchmark, weak),
    )
}

/// One row of the home page's published comparisons, listed A to Z.
pub fn feed_item(root: &str, engine: &Engine, benchmark: &Benchmark, facts: &Facts) -> String {
    format!(
        "<a class=\"feed\" href=\"{href}\">{avatar}<div class=\"fi\"><div class=\"fz\"><b>{name}</b> <span>by {author}</span> {pill}</div>{chip}</div>\
         <span class=\"cl\">Claimed by the author</span></a>",
        href = safe_href(&format!("{root}{}", paths::engine(&engine.id))),
        avatar = avatar(login(engine), "md", is_org(engine)),
        name = escape(&engine.name),
        author = escape(author_name(engine)),
        pill = badge_pill(engine, facts),
        chip = cmp_chip(benchmark, false),
    )
}
