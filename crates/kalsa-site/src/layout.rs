//! The frame every page shares: head, header, footer, and the "not affiliated" line.

use crate::html::{escape, safe_href, MAIN};
use crate::paths;

pub struct Meta<'a> {
    pub title: &'a str,
    pub description: &'a str,
    /// Where the page is written, e.g. "engines/frink/index.html".
    pub path: &'a str,
    /// The nav entry to mark, if any: "engines", "hardware", "rules", "submit", "app", "signin".
    pub active: &'a str,
    /// Script files under static/ to load.
    pub scripts: &'a [&'a str],
}

const NAV: [(&str, &str, &str); 6] = [
    ("engines", "Engines", "engines"),
    ("hardware", "Hardware", "hardware"),
    ("rules", "Listing", "listed-and-community"),
    ("submit", "Submit", "submit"),
    ("app", "App", "app"),
    ("signin", "Sign in", "signin"),
];

fn nav(root: &str, active: &str) -> String {
    NAV.iter()
        .map(|(key, label, dir)| {
            let current = if *key == active { " aria-current=\"page\"" } else { "" };
            // The account script finds this one entry and swaps it for the signed-in visitor.
            let hook = if *key == "signin" { " data-account" } else { "" };
            format!("<a href=\"{root}{}\"{current}{hook}>{label}</a>", paths::section(dir))
        })
        .collect()
}

fn head(meta: &Meta, root: &str) -> String {
    let canonical = paths::canonical(meta.path);
    format!(
        "<meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"color-scheme\" content=\"light dark\">\n\
         <title>{title}</title><meta name=\"description\" content=\"{desc}\"><link rel=\"canonical\" href=\"{canonical}\">\n\
         <meta property=\"og:title\" content=\"{title}\"><meta property=\"og:description\" content=\"{desc}\"><meta property=\"og:type\" content=\"website\">\
         <meta property=\"og:url\" content=\"{canonical}\"><meta name=\"twitter:card\" content=\"summary\">\n\
         <link rel=\"stylesheet\" href=\"{root}static/palette.css\"><link rel=\"stylesheet\" href=\"{root}static/base.css\">",
        title = escape(meta.title),
        desc = escape(meta.description),
        canonical = safe_href(&canonical),
    )
}

fn footer(root: &str) -> String {
    format!(
        "<footer class=\"ft\"><div class=\"wrap\"><p class=\"fine strong\">Kalsa is not affiliated with the projects it lists. · \
         <a href=\"{contact}\">Contact</a> · <a href=\"{root}{privacy}\">Privacy</a> · <a href=\"{root}{rules}\">Listed and community engines</a></p></div></footer>",
        privacy = paths::section("privacy"),
        rules = paths::section("listed-and-community"),
        contact = safe_href(&format!("mailto:{MAIN}")),
    )
}

pub fn page(meta: &Meta, body: &str) -> String {
    let root = paths::root_for(meta.path);
    let mut scripts = format!("<script src=\"{root}static/account.js\" defer></script>");
    scripts.extend(meta.scripts.iter().map(|name| format!("<script src=\"{root}static/{name}\" defer></script>")));
    format!(
        "<!doctype html>\n<html lang=\"en\"><head>{head}</head><body>\n\
         <a class=\"skip\" href=\"#main\">Skip to content</a>\n\
         <header class=\"hd\"><div class=\"wrap\"><a class=\"brand\" href=\"{root}index.html\" aria-label=\"Kalsa home\"><span class=\"logo\">K</span>Kalsa</a>\
         <nav class=\"nav\" aria-label=\"Main\">{nav}</nav></div></header>\n\
         <main id=\"main\">{body}</main>\n{footer}{scripts}</body></html>\n",
        head = head(meta, &root),
        nav = nav(&root, meta.active),
        footer = footer(&root),
    )
}
