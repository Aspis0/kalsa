//! Files that are not pages: the sitemap and the README badges.

use std::path::PathBuf;

use kalsa_engines::Catalog;

use crate::badge::badge_svg;
use crate::html::escape;
use crate::paths;

/// Every HTML page, at its shared address.
pub fn sitemap(files: &[(PathBuf, String)]) -> String {
    let mut urls: Vec<String> = files
        .iter()
        .filter(|(path, _)| path.extension().and_then(|extension| extension.to_str()) == Some("html"))
        .filter_map(|(path, _)| path.to_str())
        .map(paths::canonical)
        .collect();
    urls.sort();
    let items: String = urls.iter().map(|url| format!("<url><loc>{}</loc></url>\n", escape(url))).collect();
    format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n{items}</urlset>\n")
}

/// A badge file for each reviewed engine. An unreviewed engine has none.
pub fn badges(catalog: &Catalog) -> Vec<(PathBuf, String)> {
    catalog.engine.iter().filter_map(|engine| badge_svg(engine).map(|svg| (PathBuf::from(format!("badge/{}.svg", engine.id)), svg))).collect()
}
