//! Helpers shared by the site tests. Not every test file uses every helper.
#![allow(dead_code)]

use std::path::{Path, PathBuf};

use kalsa_site::{catalog, render, Facts};

pub type Files = Vec<(PathBuf, String)>;

pub fn generated() -> Files {
    render(&catalog(), &Facts::none())
}

pub fn html(files: &Files) -> impl Iterator<Item = &(PathBuf, String)> {
    files.iter().filter(|(path, _)| path.extension().and_then(|extension| extension.to_str()) == Some("html"))
}

pub fn body<'a>(files: &'a Files, path: &str) -> &'a str {
    &files.iter().find(|(name, _)| name == Path::new(path)).unwrap_or_else(|| panic!("missing page {path}")).1
}

pub fn banned(text: &str) -> Vec<&'static str> {
    let lower = text.to_ascii_lowercase();
    let words: Vec<&str> = lower.split(|c: char| !c.is_ascii_alphanumeric()).filter(|word| !word.is_empty()).collect();
    let mut hits: Vec<&'static str> = ["best", "fastest", "biggest", "strongest", "leading", "safe", "secure", "certified"]
        .into_iter()
        .filter(|word| words.contains(word))
        .collect();
    if format!(" {lower} ").contains(" top ") {
        hits.push("top");
    }
    hits
}

/// The text a reader sees: everything outside tags, scripts and styles.
pub fn visible(page: &str) -> String {
    let mut out = String::new();
    let mut inside = false;
    for character in page.chars() {
        match character {
            '<' => inside = true,
            '>' => inside = false,
            _ if !inside => out.push(character),
            _ => {}
        }
    }
    out
}

/// Catalog text built to break out of markup: every page that shows it must escape it.
pub const HOSTILE: &str = r#"
[[engine]]
id = "hostile"
name = "x\" onmouseover=\"alert(1)"
repo = "evil/hostile"
author = "<img src=x onerror=alert(1)>"
license = "MIT"
kind = "engine"
hardware = ["cpu"]
summary = "<script>alert(1)</script>"
[[engine.benchmark]]
source = "https://example.invalid/a"
machine = "<b>machine</b>"
chip_tag = "cpu"
model = "m"
quant = "Q4"
decode_tok_s = 10.0
baseline = "<i>b</i>"
baseline_decode_tok_s = 5.0
[engine.review]
commit = "a1b2c3d"
date = "2026-11-18"
upstream = "evil/up"
"#;

/// The words a reader or a screen reader can get from a page besides its body text: the title, and the title, content, aria-label and alt attributes.
pub fn attribute_text(page: &str) -> String {
    let mut out = String::new();
    for attribute in [" title=\"", " content=\"", " aria-label=\"", " alt=\""] {
        for rest in page.split(attribute).skip(1) {
            out.push_str(rest.split('"').next().unwrap_or_default());
            out.push('\n');
        }
    }
    if let Some(title) = page.split("<title>").nth(1).and_then(|rest| rest.split("</title>").next()) {
        out.push_str(title);
    }
    out
}
