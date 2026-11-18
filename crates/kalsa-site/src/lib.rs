//! Static pages generated from the shared engine catalog.

mod html;
mod layout;
mod pages;

use std::path::{Path, PathBuf};

pub use kalsa_engines::Catalog;

pub const BASE_CSS: &str = include_str!("../../../site/static/base.css");
pub const PALETTE_CSS: &str = include_str!("../../../site/static/palette.css");

/// The catalog is the single source of truth for this site and the desktop app.
pub fn catalog() -> Catalog {
    kalsa_engines::parse(include_str!("../../../catalog/engines.toml"))
        .expect("the bundled catalog parses and validates")
}

/// Each item is a path relative to `site/dist` and its HTML or CSS body.
pub fn render(catalog: &Catalog) -> Vec<(PathBuf, String)> {
    let first = catalog
        .engine
        .first()
        .map(|engine| pages::engine_path(&engine.id))
        .unwrap_or_default();
    let mut files = vec![
        (PathBuf::from("index.html"), pages::home(&catalog.engine)),
        (PathBuf::from("static/base.css"), BASE_CSS.to_string()),
        (PathBuf::from("static/palette.css"), PALETTE_CSS.to_string()),
    ];
    files.extend(catalog.engine.iter().map(|engine| {
        (
            PathBuf::from(pages::engine_path(&engine.id)),
            pages::engine(engine, &first),
        )
    }));
    files
}

/// Joins a relative href against the page that contains it, without a URL crate.
pub fn resolve_href(page: &Path, href: &str) -> PathBuf {
    if href.starts_with('/') {
        return PathBuf::from(href.trim_start_matches('/'));
    }
    let base = page.parent().unwrap_or_else(|| Path::new(""));
    let joined = base.join(href);
    let mut parts: Vec<&str> = Vec::new();
    for part in joined.components() {
        match part.as_os_str().to_str().unwrap_or_default() {
            ".." => { parts.pop(); }
            "." | "" => {}
            name => parts.push(name),
        }
    }
    parts.iter().collect()
}
