//! The frame every page shares: head, header, footer, and the "not affiliated" line.

use crate::html::{escape, safe_href, MAIN};
use crate::paths;

pub struct Meta<'a> {
    pub title: &'a str,
    pub description: &'a str,
    /// Where the page is written, e.g. "engines/frink/index.html".
    pub path: &'a str,
    /// The nav entry to mark, if any: "engines", "hardware", "compare", "how", "submit", "app".
    pub active: &'a str,
    /// Script files under static/ to load.
    pub scripts: &'a [&'a str],
}

const NAV: [(&str, &str, &str); 6] = [
    ("engines", "Engines", "engines"),
    ("hardware", "Hardware", "hardware"),
    ("compare", "Compare", "compare"),
    ("how", "How we choose", "how-we-choose"),
    ("submit", "Submit", "submit"),
    ("app", "App", "app"),
];

fn nav(root: &str, active: &str) -> String {
    NAV.iter()
        .map(|(key, label, dir)| {
            let current = if *key == active { " aria-current=\"page\"" } else { "" };
            format!("<a href=\"{root}{}\"{current}>{label}</a>", paths::section(dir))
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
        "<footer class=\"ft\"><div class=\"wrap\"><div class=\"fc\">\
         <div><a class=\"brand\" href=\"{root}index.html\"><span class=\"logo\">K</span>Kalsa</a><p>A database of local inference engines and forks: what each is, who made it, its licence and the published benchmarks. Open source, Apache-2.0.</p></div>\
         <div><h5>Browse</h5><a href=\"{root}{engines}\">Engines</a><a href=\"{root}{hardware}\">Hardware</a><a href=\"{root}{compare}\">Compare</a></div>\
         <div><h5>Project</h5><a href=\"{root}{how}\">How we choose</a><a href=\"{root}{how}#listing-and-removal\">Listing and removal</a><a href=\"{root}{submit}\">Submit an engine</a><a href=\"https://github.com/Aspis0/kalsa\">GitHub</a></div>\
         <div><h5>More</h5><a href=\"{root}{app}\">App</a><a href=\"{contact}\">Contact: {main}</a></div></div>\
         <p class=\"fine strong\">Kalsa is not affiliated with the authors of the listed projects.</p>\
         <p class=\"fine\">Generated from the engine catalog. Every number is claimed by its author until measured on a real Mac. Avatars and usernames come from public GitHub profiles.</p></div></footer>",
        engines = paths::section("engines"),
        hardware = paths::section("hardware"),
        compare = paths::section("compare"),
        how = paths::section("how-we-choose"),
        submit = paths::section("submit"),
        app = paths::section("app"),
        contact = safe_href(&format!("mailto:{MAIN}")),
        main = MAIN,
    )
}

pub fn page(meta: &Meta, body: &str) -> String {
    let root = paths::root_for(meta.path);
    let scripts: String = meta.scripts.iter().map(|name| format!("<script src=\"{root}static/{name}\" defer></script>")).collect();
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
