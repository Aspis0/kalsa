//! What makes an element's text invisible to the person reading the mail: the
//! declarations in a `style` attribute, the attributes that hide by themselves,
//! and the class and id rules a `<style>` block sets up for them.
//!
//! Every way a mail can hide a sentence is answered here, so no element that a
//! person cannot see is one this server failed to notice.

use crate::markup::Tag;
use std::collections::HashSet;

/// `display:none` and `visibility:hidden`, with any spacing a CSS writer likes.
fn hidden_value(value: &str) -> bool {
    let value = value.trim();
    value.eq_ignore_ascii_case("none") || value.eq_ignore_ascii_case("hidden")
}

/// `font-size: 0` hides text; `0.9em` and `02px` do not.
fn is_zero_size(value: &str) -> bool {
    let value = value.trim();
    let digits: String = value
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    let zero = matches!(digits.as_str(), "0" | "0.0" | "00" | ".0");
    zero && !value[digits.len()..].starts_with(|c: char| c.is_ascii_digit() || c == '.')
}

/// Far enough off the page that nobody scrolls to it.
fn is_off_screen(value: &str) -> bool {
    let number: String = value
        .trim()
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.' || *c == '-')
        .collect();
    number
        .parse::<f64>()
        .is_ok_and(|offset| offset.abs() >= 500.0)
}

/// The colours a mail writes by name rather than by hex. `color` and
/// `background` have to compare equal for the rule to see a letter written on
/// its own paper.
const NAMED: [(&str, &str); 17] = [
    ("white", "#ffffff"),
    ("black", "#000000"),
    ("red", "#ff0000"),
    ("green", "#008000"),
    ("lime", "#00ff00"),
    ("blue", "#0000ff"),
    ("yellow", "#ffff00"),
    ("aqua", "#00ffff"),
    ("cyan", "#00ffff"),
    ("fuchsia", "#ff00ff"),
    ("magenta", "#ff00ff"),
    ("silver", "#c0c0c0"),
    ("gray", "#808080"),
    ("grey", "#808080"),
    ("maroon", "#800000"),
    ("navy", "#000080"),
    ("purple", "#800080"),
];

/// `#abc`, `#aabbcc`, `rgb(1,2,3)` and `red` have to compare equal to their
/// twins, or a colour rule can be walked past.
fn colour(value: &str) -> Option<String> {
    let value: String = value
        .trim()
        .to_ascii_lowercase()
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect();
    if let Some(hex) = value.strip_prefix('#') {
        return match hex.len() {
            3 => Some(expand(hex)),
            6 => Some(format!("#{hex}")),
            _ => None,
        };
    }
    if let Some((_, hex)) = NAMED.iter().find(|(name, _)| *name == value) {
        return Some((*hex).to_string());
    }
    let rgb = value
        .strip_prefix("rgb(")
        .or_else(|| value.strip_prefix("rgba("))?;
    let parts: Vec<&str> = rgb.trim_end_matches(')').split(',').collect();
    let channels: Option<Vec<u8>> = parts.iter().map(|part| part.parse::<u8>().ok()).collect();
    let channels = channels?;
    (channels.len() == 3)
        .then(|| format!("#{:02x}{:02x}{:02x}", channels[0], channels[1], channels[2]))
}

fn expand(hex: &str) -> String {
    let doubled: String = hex.chars().flat_map(|c| [c, c]).collect();
    format!("#{doubled}")
}

/// The declarations of one `style` attribute, read one by one: a rule reads the
/// pair a renderer reads, and a text search for one word misses the other half.
pub(crate) fn declarations_hide(declarations: &str) -> bool {
    let mut foreground = None;
    let mut background = None;
    let mut no_height = false;
    let mut clipped = false;
    let mut absolute = false;
    let mut off_screen = false;

    for declaration in declarations.split(';') {
        let Some((property, value)) = declaration.split_once(':') else {
            continue;
        };
        match property.trim().to_ascii_lowercase().as_str() {
            "display" | "visibility" if hidden_value(value) => return true,
            "font-size" if is_zero_size(value) => return true,
            "opacity" if value.trim().parse::<f64>().is_ok_and(|o| o == 0.0) => return true,
            "color" => foreground = colour(value),
            "background" | "background-color" => background = colour(value),
            "height" => no_height = is_zero_size(value),
            "overflow" => clipped = hidden_value(value),
            "position" => absolute = value.trim().eq_ignore_ascii_case("absolute"),
            "left" | "top" | "right" | "margin-left" => off_screen = is_off_screen(value),
            _ => {}
        }
    }

    (no_height && clipped)
        || (absolute && off_screen)
        || (foreground.is_some() && foreground == background)
}

pub(crate) fn hides(tag: &Tag, rules: &Rules) -> bool {
    tag.has("hidden")
        || tag
            .get("aria-hidden")
            .is_some_and(|value| value.trim().eq_ignore_ascii_case("true"))
        || declarations_hide(tag.get("style").unwrap_or_default())
        || rules.hides(tag)
}

/// The class and id names a `<style>` block in this mail hides. Read once, up
/// front: a rule in a stylesheet hides its element the same as a style
/// attribute does, and only the sender's own CSS says which elements those are.
#[derive(Default)]
pub(crate) struct Rules {
    classes: HashSet<String>,
    ids: HashSet<String>,
}

impl Rules {
    pub(crate) fn from_source(src: &str) -> Rules {
        let mut rules = Rules::default();
        let mut rest = src;
        while let Some(open) = rest.find("<style") {
            let after = &rest[open..];
            let Some(close) = after.to_ascii_lowercase().find("</style") else {
                break;
            };
            let from = after.find('>').map_or(0, |at| at + 1);
            for (selector, declarations) in blocks(&after[from..close]) {
                if !declarations_hide(declarations) {
                    continue;
                }
                for simple in selector.split(',') {
                    match name_of(simple.trim()) {
                        Some(Name::Class(name)) => rules.classes.insert(name),
                        Some(Name::Id(name)) => rules.ids.insert(name),
                        None => false,
                    };
                }
            }
            rest = &after[close..];
        }
        rules
    }

    fn hides(&self, tag: &Tag) -> bool {
        tag.classes().any(|class| self.classes.contains(class))
            || tag.get("id").is_some_and(|id| self.ids.contains(id))
    }
}

enum Name {
    Class(String),
    Id(String),
}

/// The name a simple selector hangs on: `.classe`, `#id`, or `p.classe`.
fn name_of(selector: &str) -> Option<Name> {
    let (marker, name) = match selector.rfind(['.', '#']) {
        Some(at) => (selector.as_bytes()[at], &selector[at + 1..]),
        None => return None,
    };
    let name = name.trim();
    if name.is_empty() || name.contains([' ', ':', '>', '+', ',']) {
        return None;
    }
    Some(match marker {
        b'.' => Name::Class(name.to_ascii_lowercase()),
        _ => Name::Id(name.to_ascii_lowercase()),
    })
}

/// `selector { declarations }`, one rule at a time.
fn blocks(css: &str) -> impl Iterator<Item = (&str, &str)> {
    css.split('}').filter_map(|rule| {
        let (selector, declarations) = rule.split_once('{')?;
        Some((selector.trim(), declarations.trim()))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::markup;

    fn hides_html(html: &str) -> bool {
        let rules = Rules::from_source(html);
        let mut found = false;
        let mut rest = html;
        while let Some(tag) = markup::first(rest) {
            if !tag.closing && hides(&tag, &rules) {
                found = true;
            }
            rest = &rest[tag.end..];
        }
        found
    }

    #[test]
    fn every_way_of_hiding_an_element_is_answered() {
        for html in [
            r#"<div style="display:none">"#,
            r#"<div style="DISPLAY : NONE ;">"#,
            r#"<div style="visibility:hidden">"#,
            r#"<div style="font-size:0">"#,
            r#"<div style="font-size:0px">"#,
            r#"<div style="opacity:0">"#,
            r#"<div style="height:0;overflow:hidden">"#,
            r#"<div style="position:absolute;left:-9999px">"#,
            r#"<div style="color:#fff;background:#ffffff">"#,
            r#"<div style="color:red;background:red">"#,
            r#"<div style="color:white;background:#fff">"#,
            r#"<div style="color:rgb(255,0,0);background:#ff0000">"#,
            r#"<div style=display:none>"#,
            r#"<div style="&#100;isplay:none">"#,
            r#"<div hidden>"#,
            r#"<div aria-hidden="TRUE">"#,
        ] {
            assert!(hides_html(html), "{html}");
        }
    }

    #[test]
    fn a_visible_element_is_left_visible() {
        let sheet = "<style>.visibile{color:red}</style>";
        for html in [
            r#"<div style="display:block">"#,
            r#"<div style="font-size:0.9em">"#,
            r#"<div style="color:red;background:#fff">"#,
            r#"<div style="position:absolute;left:0">"#,
            r#"<div style="height:0">"#,
            r#"<div aria-hidden="false">"#,
            r#"<p>"#,
        ] {
            assert!(!hides_html(html), "{html}");
        }
        assert!(!hides_html(&format!(r#"<div class="visibile">{sheet}"#)));
    }

    #[test]
    fn a_class_rule_hides_the_elements_it_names() {
        let css = "<style>.segreto{display:none} #anche { visibility:hidden } .visibile{color:red}</style>";
        assert!(hides_html(&format!(r#"<span class="segreto">{css}"#)));
        assert!(hides_html(&format!(r#"<span id="anche">{css}"#)));
        assert!(!hides_html(&format!(r#"<span class="visibile">{css}"#)));
    }
}
