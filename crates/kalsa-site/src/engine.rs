//! One page per engine: credit, published comparisons, review, and where to install it from.

use kalsa_engines::{chip_label, hardware_labels, Catalog, Engine, Kind};

use crate::bench::bench_block;
use crate::cards::{avatar, github_url, tags};
use crate::facts::{stars_label, Facts};
use crate::html::{escape, safe_href, slug};
use crate::improvements::improvements_section;
use crate::layout::{page, Meta};
use crate::model::{author_name, is_org, login, pairs};
use crate::paths;
use crate::review::{badge_box, review_section};
use crate::widgets::{claim_line, url_bar};

/// The rows of "How to install". Every engine points to its own project; nothing here is a Kalsa install.
fn install_rows(engine: &Engine) -> Vec<(String, String)> {
    let mut rows = Vec::new();
    if let Some(note) = engine.note.as_deref().filter(|note| note.starts_with("Requires")) {
        rows.push(("Needs another app first".to_string(), escape(note)));
    }
    let repo = github_url(&engine.repo);
    rows.push((
        "Follow the project's own instructions".to_string(),
        format!(
            "Instructions: <a class=\"lnk\" href=\"{readme}\">github.com/{name}</a>. Releases and packages: <a class=\"lnk\" href=\"{releases}\">github.com/{name}/releases</a>. Nothing here replaces them.",
            readme = safe_href(&repo),
            releases = safe_href(&format!("{repo}/releases")),
            name = escape(&engine.repo),
        ),
    ));
    rows.push(("Who it runs as".to_string(), "An engine runs as you, with access to your files. macOS does not sandbox it, so install only what you trust.".to_string()));
    rows
}

fn accordions(engine: &Engine) -> String {
    install_rows(engine).iter().map(|(title, text)| format!("<details class=\"acc\"><summary>{title}</summary><p>{text}</p></details>")).collect()
}

fn metrics_note(engine: &Engine) -> &'static str {
    let decode = engine.benchmark.iter().any(|b| b.decode_tok_s.is_some());
    let prefill = engine.benchmark.iter().any(|b| b.prefill_tok_s.is_some());
    match (decode, prefill) {
        (true, true) => "Decode and prefill are shown separately.",
        (true, false) => "Decode only here; no prefill numbers were published for these runs.",
        (false, true) => "Prefill only here; no decode numbers were published for these runs.",
        (false, false) => "",
    }
}

fn comparisons(engine: &Engine) -> String {
    if engine.benchmark.is_empty() {
        return match (engine.kind, engine.note.as_deref()) {
            (Kind::Reference, _) => "<div class=\"refbox\">A reference engine is the baseline other engines are measured against, so it has no comparison of its own.</div>".to_string(),
            (_, Some(note)) => format!("<div class=\"refbox\"><b>No like-for-like comparison.</b> The author's own words: {}</div>", escape(note)),
            _ => "<div class=\"refbox\">No comparison has been published.</div>".to_string(),
        };
    }
    let blocks: String = engine.benchmark.iter().map(|benchmark| bench_block(benchmark, engine, None)).collect();
    format!(
        "<p class=\"sm\">Claimed by the author, with the source linked on each. {} Kalsa has not re-run them.</p><div class=\"bgrid\">{blocks}</div>",
        metrics_note(engine)
    )
}

fn compare_links(catalog: &Catalog, engine: &Engine) -> String {
    let links: String = pairs(catalog)
        .iter()
        .filter(|pair| pair.engine.id == engine.id)
        .map(|pair| {
            format!(
                "<li><a class=\"lnk\" href=\"../../{}\">{} vs {} on {}</a></li>",
                safe_href(&paths::compare(&pair.slug())),
                escape(&engine.name),
                escape(pair.baseline),
                escape(&pair.chip)
            )
        })
        .collect();
    if links.is_empty() { String::new() } else { format!("<h3>Published pairs</h3><ul class=\"plain\">{links}</ul>") }
}

/// The upstream's own page when it is listed (the catalog requires that), else its plain name.
fn upstream_link(catalog: &Catalog, upstream: &str) -> String {
    match catalog.engine.iter().find(|other| other.repo.eq_ignore_ascii_case(upstream)) {
        Some(found) => format!("<a class=\"lnk\" href=\"../../{}\">{}</a>", safe_href(&paths::engine(&found.id)), escape(upstream)),
        None => escape(upstream),
    }
}

fn about(catalog: &Catalog, engine: &Engine) -> String {
    let relation = engine
        .upstream
        .as_deref()
        .map(|upstream| format!(", {} {}", if engine.kind == Kind::Fork { "a fork of" } else { "built on" }, upstream_link(catalog, upstream)))
        .unwrap_or_default();
    let mut chips: Vec<String> = engine.benchmark.iter().map(chip_label).collect();
    chips.sort();
    chips.dedup();
    let measured = if chips.is_empty() { String::new() } else { format!(" Every number below comes from the author's own README, measured on {}.", escape(&chips.join(", "))) };
    format!(
        "<div id=\"about\"><h3 class=\"first\">About</h3><p class=\"aboutp\">{summary}. Made by {author}{relation}. The summary is ours.{measured}</p>",
        summary = escape(&engine.summary),
        author = escape(author_name(engine)),
    )
}

fn hardware_links(engine: &Engine) -> String {
    let mut seen: Vec<(String, String)> = Vec::new();
    for benchmark in &engine.benchmark {
        let label = chip_label(benchmark);
        let (title, slug_text) = if kalsa_engines::chip_generation(&benchmark.chip_tag).is_some() && label.starts_with('M') {
            (format!("Apple {label}"), slug(&format!("Apple {label}")))
        } else {
            let family = kalsa_engines::family_label(&benchmark.chip_tag);
            (family.clone(), slug(&family))
        };
        if !seen.iter().any(|(_, existing)| *existing == slug_text) {
            seen.push((title, slug_text));
        }
    }
    seen.iter().map(|(title, slug_text)| format!("<a class=\"chipx\" href=\"../../{}\">Engines for {}</a>", safe_href(&paths::hardware(slug_text)), escape(title))).collect()
}

fn details(catalog: &Catalog, engine: &Engine, facts: &Facts) -> String {
    let mut rows = format!("<dt>Licence</dt><dd>{}</dd><dt>Kind</dt><dd>{}</dd>", escape(&engine.license), engine.kind.label());
    if let Some(upstream) = &engine.upstream {
        rows += &format!("<dt>Upstream</dt><dd>{}</dd>", upstream_link(catalog, upstream));
    }
    rows += &format!("<dt>Runs on</dt><dd>{}</dd>", escape(&hardware_labels(&engine.hardware).join(", ")));
    if let Some(fact) = facts.get(&engine.repo) {
        if let Some(stars) = fact.stars {
            rows += &format!("<dt>Stars</dt><dd>{}</dd>", stars_label(stars));
        }
        if let Some(pushed) = &fact.pushed {
            rows += &format!("<dt>Updated</dt><dd>{}</dd>", escape(pushed));
        }
    }
    format!("<div class=\"box\"><h5>Details</h5><dl class=\"kv\">{rows}</dl></div>")
}

fn sidebar(catalog: &Catalog, engine: &Engine, facts: &Facts, path: &str) -> String {
    format!(
        "<aside class=\"side\"><div class=\"box\"><h5>Developer</h5><div class=\"dev\">{avatar}<div><b>{author}</b><span>github.com/{login}</span></div></div>\
         <p class=\"sm\">Avatar and username come from the public GitHub profile. <a class=\"lnk\" href=\"../../{dev}\">Developer page</a></p></div>{details}\
         <div class=\"box\"><h5>Share</h5>{url}</div><div class=\"box\"><h5>Hardware pages</h5><div class=\"chips\">{hardware}</div></div>{badge}</aside>",
        avatar = avatar(login(engine), "md", is_org(engine)),
        author = escape(author_name(engine)),
        login = escape(login(engine)),
        dev = safe_href(&paths::developer(login(engine))),
        details = details(catalog, engine, facts),
        url = url_bar(path),
        hardware = hardware_links(engine),
        badge = badge_box(engine),
    )
}

fn website_button(engine: &Engine) -> String {
    let Some(site) = &engine.website else { return String::new() };
    let label = engine.website_label.as_deref().unwrap_or("Website");
    format!("<a class=\"btn two\" href=\"{}\">{}</a>", safe_href(site), escape(label))
}

fn header(engine: &Engine, facts: &Facts) -> String {
    format!(
        "<div class=\"crumb\"><a href=\"../index.html\">Engines</a> / <a href=\"../../{dev}\">{login}</a> / {name}</div>\
         <div class=\"title\">{avatar}<div><h1><span>{login} /</span> {name}</h1><div class=\"tags\">{tags}</div></div></div>\
         <div class=\"acts\"><a class=\"btn\" href=\"{github}\">GitHub</a>{website}\
         <span class=\"soonbtn\">Like <span class=\"ph\">coming soon</span></span><span class=\"soonbtn\">Used by <span class=\"ph\">coming soon</span></span></div>\
         <nav class=\"tabs\" aria-label=\"Sections\"><a href=\"#about\" aria-current=\"page\">Overview</a>{improvements_tab}<a href=\"#cmp\">Comparisons</a><a href=\"#review\">Review</a><a href=\"#install\">How to install</a><span>Discussion<i>coming soon</i></span></nav>",
        dev = safe_href(&paths::developer(login(engine))),
        login = escape(login(engine)),
        name = escape(&engine.name),
        avatar = avatar(login(engine), "lg", is_org(engine)),
        tags = tags(engine, facts),
        github = safe_href(&github_url(&engine.repo)),
        website = website_button(engine),
        improvements_tab = if improvements_section(engine).is_empty() { "" } else { "<a href=\"#improvements\">Improvements</a>" },
    )
}

pub fn engine_page(catalog: &Catalog, engine: &Engine, facts: &Facts) -> String {
    let path = paths::engine(&engine.id);
    let note = engine.note.as_deref().map(|note| format!("<div class=\"note\"><b>Read this first.</b> {}</div>", escape(note))).unwrap_or_default();
    let main = format!(
        "{about}{improvements}<h3 id=\"cmp\">Published comparisons</h3>{comparisons}\
         {pairs}{review}<h3 id=\"install\">How to install</h3>{install}</div>",
        about = about(catalog, engine),
        comparisons = comparisons(engine),
        improvements = improvements_section(engine),
        pairs = compare_links(catalog, engine),
        review = review_section(engine, facts),
        install = accordions(engine),
    );
    let body = format!(
        "<div class=\"wrap\">{header}{note}<div class=\"cols\"><div>{main}</div>{side}</div>{claim}</div>",
        header = header(engine, facts),
        side = sidebar(catalog, engine, facts, &path),
        claim = claim_line("../../", &engine.name),
    );
    page(
        &Meta {
            title: &format!("{} / {} | Kalsa", login(engine), engine.name),
            description: &format!("{} by {}: licence and the benchmarks its author published, with the source of each.", engine.name, author_name(engine)),
            path: &path,
            active: "engines",
            scripts: &["site.js"],
        },
        &body,
    )
}
