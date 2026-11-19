//! Where each page lives. Every page is `<dir>/index.html`, so links work from a file or a server.

/// The one origin the site is served on. Every canonical URL, sitemap entry, badge link and llms.txt
/// link is built from it, and the Worker's SITE_ORIGIN must match it.
pub const ORIGIN: &str = "https://preview.kalsa.io";

pub const HOME: &str = "index.html";

pub fn engine(id: &str) -> String {
    format!("engines/{id}/index.html")
}

pub fn developer(login: &str) -> String {
    format!("dev/{login}/index.html")
}

pub fn hardware(slug: &str) -> String {
    format!("hardware/{slug}/index.html")
}

pub fn section(name: &str) -> String {
    format!("{name}/index.html")
}

/// "../" repeated once for each directory the page sits in.
pub fn root_for(path: &str) -> String {
    "../".repeat(path.matches('/').count())
}

/// "engines/frink/index.html" is shared as https://preview.kalsa.io/engines/frink.
pub fn canonical(path: &str) -> String {
    let pretty = path.strip_suffix("index.html").unwrap_or(path).trim_end_matches('/');
    format!("{ORIGIN}/{pretty}")
}
