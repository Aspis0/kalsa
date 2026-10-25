//! What makes an element's text invisible to the person reading the mail: the
//! declarations in its own `style` attribute, the attributes that hide by
//! themselves, and the class and id names a `<style>` element in the same mail
//! hides.
//!
//! CSS is not evaluated here. No cascade, no specificity, no inheritance, no
//! `!important`: a declaration is read as it was written. That is the floor
//! this server stands on, not a bug to be climbed — the boundary that holds is
//! the fence around every line handed to a model, and a style sheet no engine
//! here understands cannot reach past it.

use crate::css_value::{
    clips_to_nothing, colour, declaration_value, decode_escapes, hidden_value, is_off_screen,
    is_zero, scaled_to_nothing, strip_comments,
};
use ego_tree::NodeRef;
use scraper::node::{Element, Node};
use std::collections::HashSet;

/// A stylesheet long enough to hide things with, in one element. The body is
/// already capped at the fetch limit, so this only bounds one hostile rule.
const MAX_CSS_BYTES: usize = 64 * 1024;

/// Class and id names kept out of one mail's stylesheets. Past this the sender
/// is trying to make the matching cost, not to hide a sentence.
const MAX_CSS_NAMES: usize = 4096;

/// The declarations of one `style` value, read one pair at a time: a renderer
/// reads the pair, and a text search for one word misses the other half.
pub(crate) fn declarations_hide(declarations: &str) -> bool {
    let mut foreground = None;
    let mut background = None;
    let mut no_height = false;
    let mut clipped = false;
    let mut absolute = false;
    let mut off_screen = false;
    let mut pushed_away = false;
    let mut no_room = false;

    for declaration in strip_comments(declarations).split(';') {
        let Some((property, value)) = declaration.split_once(':') else {
            continue;
        };
        let value = &declaration_value(value);
        let property = decode_escapes(property).trim().to_ascii_lowercase();
        match property.as_str() {
            "display" | "visibility" if hidden_value(value) => return true,
            "font-size" if is_zero(value) => return true,
            "opacity" if is_zero(value) => return true,
            "color" => foreground = colour(value),
            "background" | "background-color" => background = colour(value),
            "height" => no_height = is_zero(value),
            "max-height" | "max-width" if is_zero(value) => return true,
            "overflow" => clipped = hidden_value(value),
            "position" => absolute = value.trim().eq_ignore_ascii_case("absolute"),
            "left" | "top" | "right" | "margin-left" => off_screen = is_off_screen(value),
            "text-indent" => pushed_away = is_off_screen(value),
            "clip" | "clip-path" => no_room = clips_to_nothing(value),
            "transform" => no_room = scaled_to_nothing(value),
            _ => {}
        }
    }

    no_room
        || pushed_away
        || (no_height && clipped)
        || (absolute && off_screen)
        || foreground.as_deref() == Some("transparent")
        || (foreground.is_some() && foreground == background)
}

pub(crate) fn hides(element: &Element, rules: &Rules) -> bool {
    element.attr("hidden").is_some()
        || element
            .attr("aria-hidden")
            .is_some_and(|value| value.trim().eq_ignore_ascii_case("true"))
        || element.attr("style").is_some_and(declarations_hide)
        || rules.hides(element)
}

/// The class and id names the stylesheets of one mail hide. Read before the
/// text walk, because an element can be hidden by a rule that appears later in
/// the source than the element itself.
#[derive(Default)]
pub(crate) struct Rules {
    classes: HashSet<String>,
    ids: HashSet<String>,
    /// A rule this server could not attribute to a name, carrying a property
    /// that hides. The mail is not taken on trust: the rule is assumed to hide.
    everything: bool,
}

impl Rules {
    pub(crate) fn from_node(root: NodeRef<'_, Node>) -> Rules {
        let mut rules = Rules::default();
        let mut stack = vec![root];
        while let Some(node) = stack.pop() {
            match node.value() {
                Node::Element(element) if element.name() == "style" => {
                    collect(&style_text(&node), &mut rules);
                }
                Node::Element(_) => stack.extend(node.children()),
                Node::Fragment | Node::Document => stack.extend(node.children()),
                _ => {}
            }
        }
        rules
    }

    fn hides(&self, element: &Element) -> bool {
        self.everything
            || element.classes().any(|class| self.classes.contains(class))
            || element.id().is_some_and(|id| self.ids.contains(id))
    }

    fn is_full(&self) -> bool {
        self.everything || self.classes.len() + self.ids.len() >= MAX_CSS_NAMES
    }
}

fn style_text(node: &NodeRef<'_, Node>) -> String {
    let text = node
        .children()
        .filter_map(|child| child.value().as_text().map(|t| t.text.to_string()))
        .collect::<Vec<_>>()
        .join("");
    text.chars().take(MAX_CSS_BYTES).collect()
}

fn collect(css: &str, rules: &mut Rules) {
    for rule in css.split('}') {
        if rules.is_full() {
            return;
        }
        let Some((selector, declarations)) = rule.split_once('{') else {
            continue;
        };
        if !declarations_hide(declarations) {
            continue;
        }
        for simple in selector.split(',') {
            match name_of(simple) {
                Some(Name::Class(name)) => {
                    rules.classes.insert(name);
                }
                Some(Name::Id(name)) => {
                    rules.ids.insert(name);
                }
                // A type, a `*`, an attribute, a pseudo-class, a combinator:
                // this rule could hide anything, and a rule that could hide
                // anything is treated as if it does.
                None => {
                    rules.everything = true;
                    return;
                }
            }
        }
    }
}

enum Name {
    Class(String),
    Id(String),
}

/// The name a simple selector hangs on: `.classe`, `#id`, or `p.classe`.
fn name_of(selector: &str) -> Option<Name> {
    let selector = selector.trim();
    let (marker, name) = match selector.as_bytes().first()? {
        b'.' => (b'.', selector.get(1..)?),
        b'#' => (b'#', selector.get(1..)?),
        _ => return None,
    };
    if name.is_empty() || name.contains([' ', ':', '>', '+', ',', '.', '#', '[', '*']) {
        return None;
    }
    Some(match marker {
        b'.' => Name::Class(name.to_ascii_lowercase()),
        _ => Name::Id(name.to_ascii_lowercase()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use scraper::Html;

    fn hides_html(html: &str) -> bool {
        let document = Html::parse_document(html);
        let rules = Rules::from_node(document.tree.root());
        let mut found = false;
        let mut stack = vec![document.tree.root()];
        while let Some(node) = stack.pop() {
            match node.value() {
                Node::Element(element) => {
                    found |= hides(element, &rules);
                    stack.extend(node.children());
                }
                Node::Document | Node::Fragment => stack.extend(node.children()),
                _ => {}
            }
        }
        found
    }

    /// Everything a `style` attribute can say to take a sentence off the page.
    #[test]
    fn every_way_of_hiding_a_style_attribute_is_answered() {
        for style in [
            "display:none",
            "DISPLAY : NONE ;",
            "visibility:hidden",
            "font-size:0",
            "font-size:0px",
            "opacity:0",
            "height:0;overflow:hidden",
            "position:absolute;left:-9999px",
            "color:#fff;background:#ffffff",
            "color:red;background:red",
            "color:white;background:#fff",
            "color:rgb(255,0,0);background:#ff0000",
            "color:transparent",
            "max-height:0",
            "max-width:0px",
            "text-indent:-9999px",
            "clip:rect(0,0,0,0)",
            "clip-path:inset(100%)",
            "transform:scale(0)",
        ] {
            assert!(declarations_hide(style), "{style}");
        }
        assert!(hides_html(r#"<div style="&#100;isplay:none">"#));
    }

    /// The attributes that hide with no CSS at all.
    #[test]
    fn the_attributes_that_hide_by_themselves_are_answered() {
        for element in [
            r#"<div hidden>"#,
            r#"<div aria-hidden="true">"#,
            r#"<div aria-hidden="TRUE">"#,
            r#"<div style="display:none">"#,
        ] {
            assert!(hides_html(element), "{element}");
        }
    }

    /// A sender writes the escape because a reader that does not decode it will
    /// not see `display:none`. This one does.
    #[test]
    fn a_value_written_as_an_escape_or_a_comment_is_still_read() {
        for style in [
            r"\64 isplay:none",
            "display:none /* and again */",
            "/* lead */ display : none",
            "display:none !important",
            "DISPLAY:none",
            r"\64\69\73\70\6c\61\79:none",
            "font-size:0rem",
            "opacity:0.0",
        ] {
            assert!(declarations_hide(&format!("color:red;{style}")), "{style}");
        }
    }

    #[test]
    fn a_value_that_is_not_hidden_is_left_alone() {
        for style in [
            "display:block",
            "display:0",
            "display:",
            "opacity:1",
            "max-height:100px",
            "text-indent:2em",
            "clip:auto",
            "clip-path:none",
            "transform:scale(1)",
            "transform:rotate(45deg)",
            "color:#fff;background:#000",
            "font-size:0.9em",
        ] {
            assert!(!declarations_hide(style), "{style}");
        }
    }

    #[test]
    fn a_selector_is_a_name_or_it_is_not_attributable() {
        assert!(name_of(".classe").is_some());
        assert!(name_of("#id").is_some());
        assert!(name_of("div > p").is_none());
        assert!(name_of("a:hover").is_none());
        assert!(name_of("").is_none());
        assert!(name_of(".").is_none());
        assert!(name_of("*").is_none());
        assert!(name_of("[hidden]").is_none());
        assert!(name_of("p.classe").is_none());
        assert!(name_of(".a.b").is_none());
        assert!(name_of(".a b").is_none());
        assert!(name_of("#").is_none());
    }

    /// The mail body is capped below the stylesheet bound, so this one cannot be
    /// reached through a parsed mail: it is a bound on the reader, and it is
    /// read here.
    #[test]
    fn a_stylesheet_longer_than_the_bound_still_parses_and_stops() {
        let css = format!(".a{{display:none}}{}", "/*x*/".repeat(MAX_CSS_BYTES));
        assert!(hides_html(&format!(
            "<style>{css}</style><span class=a>Ciao</span>"
        )));
        assert!(!hides_html(&format!(
            "<style>{css}</style><span class=b>Ciao</span>"
        )));
    }
}
