//! The README badge for a reviewed engine: "Kalsa | reviewed a1b2c3d". No review, no badge file.

use kalsa_engines::Engine;

use crate::html::escape;

fn width(text: &str) -> usize {
    text.chars().count() * 7 + 14
}

pub fn badge_svg(engine: &Engine) -> Option<String> {
    if engine.review_declined.is_some() {
        return None;
    }
    let review = engine.reviewed.as_ref()?;
    let (left, right) = ("Kalsa".to_string(), format!("reviewed {}", &review.commit[..7]));
    let (a, b) = (width(&left), width(&right));
    Some(format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{total}\" height=\"22\" role=\"img\" aria-label=\"{label}\"><rect width=\"{a}\" height=\"22\" fill=\"#4b5560\"/>\
         <rect x=\"{a}\" width=\"{b}\" height=\"22\" fill=\"#0a8a80\"/><g fill=\"#fff\" font-family=\"-apple-system,Verdana,sans-serif\" font-size=\"12\" font-weight=\"600\" text-anchor=\"middle\">\
         <text x=\"{ax}\" y=\"15\">{left}</text><text x=\"{bx}\" y=\"15\">{right}</text></g></svg>\n",
        total = a + b,
        label = escape(&format!("{left} {right}")),
        ax = a / 2,
        bx = a + b / 2,
        left = escape(&left),
        right = escape(&right),
    ))
}
