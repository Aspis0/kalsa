//! Where each page lives. Every page is `<dir>/index.html`, so links work from a file or a server.

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

/// "engines/frink/index.html" is shared as https://kalsa.io/engines/frink.
pub fn canonical(path: &str) -> String {
    let pretty = path.strip_suffix("index.html").unwrap_or(path).trim_end_matches('/');
    format!("https://kalsa.io/{pretty}")
}
