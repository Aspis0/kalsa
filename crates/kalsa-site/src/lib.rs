//! Static pages generated from the shared engine catalog.

mod badge;
mod bench;
mod cards;
mod compare;
mod developer;
mod engine;
mod engines;
mod facts;
mod feeds;
mod hardware;
mod home;
mod html;
mod improvements;
mod layout;
mod model;
mod paths;
mod prose;
mod review;
mod widgets;
mod writer;

use std::path::{Path, PathBuf};

pub use facts::Facts;
pub use html::{escape, safe_href};
pub use kalsa_engines::Catalog;
pub use writer::write_site;

pub const BASE_CSS: &str = include_str!("../../../site/static/base.css");
pub const PALETTE_CSS: &str = include_str!("../../../site/static/palette.css");
const SITE_JS: &str = include_str!("../../../site/static/site.js");
const FILTERS_JS: &str = include_str!("../../../site/static/filters.js");
const ACCOUNT_JS: &str = include_str!("../../../site/static/account.js");
const CHEVRON_SVG: &str = include_str!("../../../site/static/chevron.svg");
const HEADERS: &str = include_str!("../../../site/_headers");

/// The catalog is the single source of truth for this site and the desktop app.
pub fn catalog() -> Catalog {
    kalsa_engines::parse(include_str!("../../../catalog/engines.toml")).expect("the bundled catalog parses and validates")
}

fn file(path: impl Into<PathBuf>, body: impl Into<String>) -> (PathBuf, String) {
    (path.into(), body.into())
}

fn statics() -> Vec<(PathBuf, String)> {
    vec![
        file("static/base.css", BASE_CSS),
        file("static/palette.css", PALETTE_CSS),
        file("static/site.js", SITE_JS),
        file("static/filters.js", FILTERS_JS),
        file("static/account.js", ACCOUNT_JS),
        file("static/chevron.svg", CHEVRON_SVG),
    ]
}

fn sections(catalog: &Catalog, facts: &Facts) -> Vec<(PathBuf, String)> {
    let mut files = vec![
        file(paths::HOME, home::home(catalog, facts)),
        file(paths::section("engines"), engines::engines_page(catalog, facts)),
        file("engines/engines.json", engines::engines_json(catalog)),
        file(paths::section("hardware"), hardware::hardware_index(catalog)),
        file(paths::section("compare"), compare::compare_index(catalog)),
        file(paths::section("how-we-choose"), prose::how_we_choose()),
        file(paths::section("submit"), prose::submit(catalog)),
        file(paths::section("app"), prose::app()),
        file(paths::section("signin"), prose::signin()),
    ];
    files.extend(catalog.engine.iter().map(|engine| file(paths::engine(&engine.id), engine::engine_page(catalog, engine, facts))));
    files.extend(model::hardware_pages(catalog).iter().map(|hw| file(paths::hardware(&hw.slug), hardware::hardware_page(hw, catalog, facts))));
    files.extend(model::pairs(catalog).iter().map(|pair| file(paths::compare(&pair.slug()), compare::compare_page(pair))));
    files.extend(developer::developer_pages(catalog, facts));
    files
}

/// Each item is a path relative to `site/dist` and its body.
pub fn render(catalog: &Catalog, facts: &Facts) -> Vec<(PathBuf, String)> {
    let mut files = sections(catalog, facts);
    files.extend(feeds::badges(catalog));
    let sitemap = feeds::sitemap(&files);
    files.push(file("sitemap.xml", sitemap));
    files.extend(statics());
    // At the root of the assets directory, where Workers static assets reads it.
    files.push(file("_headers", HEADERS));
    files
}

/// Joins a relative href against the page that contains it, without a URL crate. Query and fragment are dropped.
pub fn resolve_href(page: &Path, href: &str) -> PathBuf {
    let href = href.split(['#', '?']).next().unwrap_or_default();
    if href.is_empty() {
        return page.to_path_buf();
    }
    if href.starts_with('/') {
        return PathBuf::from(href.trim_start_matches('/'));
    }
    let base = page.parent().unwrap_or_else(|| Path::new(""));
    let joined = base.join(href);
    let mut parts: Vec<&str> = Vec::new();
    for part in joined.components() {
        match part.as_os_str().to_str().unwrap_or_default() {
            ".." => {
                parts.pop();
            }
            "." | "" => {}
            name => parts.push(name),
        }
    }
    parts.iter().collect()
}
