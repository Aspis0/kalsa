//! Files that are not pages: the sitemap and the README badges.

use std::path::PathBuf;

use kalsa_engines::Catalog;
use serde_json::json;

use crate::badge::badge_svg;
use crate::html::escape;
use crate::model::developers;
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

/// Every page the Worker may remove, with what it needs to check ownership and recount a list.
/// The Worker trusts an id from a request only when it appears here.
pub fn pages(catalog: &Catalog) -> String {
    let engines: Vec<_> = catalog
        .engine
        .iter()
        .map(|engine| json!({"id": engine.id, "name": engine.name, "repo": engine.repo, "hardware": engine.hardware}))
        .collect();
    let devs: Vec<_> = developers(catalog).iter().map(|dev| json!({"login": dev.login, "name": dev.name})).collect();
    serde_json::to_string(&json!({"engines": engines, "developers": devs})).expect("plain data serializes")
}

/// Every reader is allowed. Search indexing is refused by the X-Robots-Tag header, not by this file.
pub fn robots() -> String {
    "# Every agent may read every page. Search indexing is refused by the X-Robots-Tag header.\nUser-agent: *\nAllow: /\n".to_string()
}

/// A plain description and the main addresses, for a reader that does not run JavaScript.
pub fn llms() -> String {
    let origin = paths::ORIGIN;
    format!(
        "# Kalsa\n\n\
         Kalsa is a catalog of engines and forks that run AI models on your own computer. Each entry names its author, \
         its licence, the chips it runs on, and the benchmarks its author published, with a link to the source. \
         Kalsa does not re-run benchmarks: every number comes from the author who measured it.\n\n\
         ## Pages\n\n\
         - [Engines]({origin}/engines): every engine, A to Z, by chip and by Listed or Community.\n\
         - [Hardware]({origin}/hardware): the engines that run on each chip.\n\
         - [Listed and community engines]({origin}/listed-and-community): what the Listed mark needs, and what a review means.\n\
         - [Submit]({origin}/submit): how to add an engine.\n\
         - [Privacy]({origin}/privacy): what the site stores when you sign in.\n\n\
         ## Data\n\n\
         - [engines.json]({origin}/engines/engines.json): one row per engine, with its id, name, tier, hardware tags and search text.\n\
         - [sitemap.xml]({origin}/sitemap.xml): every page.\n\n\
         ## Reading\n\n\
         Every page is static HTML and needs no account. The site sends X-Robots-Tag: noindex, nofollow, so search \
         engines do not index it; reading it with an agent or a script is not blocked.\n"
    )
}
