//! The "What it does better" section of an engine page: what the author declares beyond raw speed.

use kalsa_engines::Engine;

use crate::html::{escape, safe_href};

/// "The speed depends" reads as "the speed depends" after "Trade-off:", while an acronym such as "ISQ" keeps its capitals.
fn lower_first(text: &str) -> String {
    let mut characters = text.chars();
    match (characters.next(), characters.next()) {
        (Some(first), Some(second)) if first.is_uppercase() && second.is_lowercase() => format!("{}{}", first.to_lowercase(), &text[first.len_utf8()..]),
        _ => text.to_string(),
    }
}

fn item(summary: &str, tradeoff: Option<&str>, source: &str) -> String {
    let tradeoff = tradeoff.map(|text| format!("<p class=\"trade\">Trade-off: {}</p>", escape(&lower_first(text)))).unwrap_or_default();
    format!(
        "<div class=\"impitem\"><p class=\"isum\">{}</p>{tradeoff}<p class=\"sm\"><a class=\"lnk\" href=\"{}\">Source</a></p></div>",
        escape(summary),
        safe_href(source),
    )
}

/// Empty, and so hidden, when the engine declares nothing.
pub fn better_section(engine: &Engine) -> String {
    let items: String = engine.improvement.iter().map(|declared| item(&declared.summary, declared.tradeoff.as_deref(), &declared.source)).collect();
    if items.is_empty() {
        return String::new();
    }
    format!("<h3 id=\"better\">What it does better</h3><div class=\"impl\">{items}</div>")
}
