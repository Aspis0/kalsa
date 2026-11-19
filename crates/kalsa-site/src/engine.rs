//! One page per engine: who made it, what it does better, its benchmarks, its review, and where to install it.

use kalsa_engines::{chip_label, hardware_labels, Catalog, Engine, Kind};

use crate::cards::{avatar, github_url, tags};
use crate::facts::{stars_label, Facts};
use crate::html::{escape, safe_href, slug};
use crate::benchmarks::benchmarks_section;
use crate::better::better_section;
use crate::layout::{page, Meta};
use crate::model::{author_name, is_org, login};
use crate::paths;
use crate::review::{badge_box, review_section};
use crate::widgets::{claim_line, url_bar};

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
        .map(|upstream| format!(" It is {} {}.", if engine.kind == Kind::Fork { "a fork of" } else { "built on" }, upstream_link(catalog, upstream)))
        .unwrap_or_default();
    format!("<p class=\"aboutp\" id=\"about\">{}{relation}</p>", escape(&engine.summary))
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
    let repo = github_url(&engine.repo);
    format!(
        "<div class=\"crumb\"><a href=\"../index.html\">Engines</a> / <a href=\"../../{dev}\">{login}</a> / {name}</div>\
         <div class=\"title\">{avatar}<div><h1>{name}</h1><p class=\"byline\">by {author} · {licence} licence</p><div class=\"tags\">{tags}</div></div></div>\
         <div class=\"acts\"><a class=\"btn\" href=\"{repo_href}\">Repository</a>{website}<a class=\"btn two\" href=\"{releases}\">Releases</a></div>",
        dev = safe_href(&paths::developer(login(engine))),
        login = escape(login(engine)),
        name = escape(&engine.name),
        author = escape(author_name(engine)),
        licence = escape(&engine.license),
        avatar = avatar(login(engine), "lg", is_org(engine)),
        tags = tags(engine, facts),
        repo_href = safe_href(&repo),
        releases = safe_href(&format!("{repo}/releases")),
        website = website_button(engine),
    )
}

fn install(engine: &Engine) -> String {
    format!(
        "<h3 id=\"install\">Install</h3><p>To install it, follow the project's own instructions on <a class=\"lnk\" href=\"{}\">GitHub</a>. \
         The engine runs with your user's permissions. macOS doesn't sandbox it, so install only engines you trust.</p>",
        safe_href(&github_url(&engine.repo))
    )
}

/// Promises only what the page shows: benchmarks and improvements are named only when the engine has some.
fn description(engine: &Engine) -> String {
    let mut shows = vec!["its licence"];
    if !engine.benchmark.is_empty() {
        shows.push("its benchmarks");
    }
    if !engine.improvement.is_empty() {
        shows.push("what it does better");
    }
    shows.push("how to install it");
    let (last, rest) = shows.split_last().expect("the list is never empty");
    format!("{} by {}: {}, and {last}.", engine.name, author_name(engine), rest.join(", "))
}

pub fn engine_page(catalog: &Catalog, engine: &Engine, facts: &Facts) -> String {
    let path = paths::engine(&engine.id);
    let note = engine.note.as_deref().map(|note| format!("<div class=\"note\"><b>Read this first.</b> {}</div>", escape(note))).unwrap_or_default();
    let main = format!(
        "{about}{better}{benchmarks}{review}{install}",
        about = about(catalog, engine),
        better = better_section(engine),
        benchmarks = benchmarks_section(catalog, engine),
        review = review_section(engine, facts),
        install = install(engine),
    );
    let body = format!(
        "<div class=\"wrap\">{header}{note}<div class=\"cols\"><div>{main}</div>{side}</div>{claim}</div>",
        header = header(engine, facts),
        side = sidebar(catalog, engine, facts, &path),
        claim = claim_line(&engine.name),
    );
    page(
        &Meta {
            title: &format!("{} by {} | Kalsa", engine.name, author_name(engine)),
            description: &description(engine),
            path: &path,
            active: "engines",
            scripts: &["site.js"],
        },
        &body,
    )
}
