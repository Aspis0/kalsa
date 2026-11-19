//! The listing line, the security review line and the README badge box on an engine page.

use kalsa_engines::{Engine, Review};

use crate::facts::Facts;
use crate::html::{escape, safe_href};
use crate::model::recheck_pending;
use crate::paths;

/// Where the review pipeline's report for a reviewed commit lives in the public repository.
const REPORTS: &str = "https://github.com/Aspis0/kalsa/blob/main/reviews";

fn short(commit: &str) -> String {
    commit.chars().take(7).collect()
}

/// The report file is named with the full commit, so a record that only carries a short one has nothing to link.
fn report_link(engine: &Engine, commit: &str) -> String {
    if commit.len() != 40 {
        return String::new();
    }
    format!(" <a class=\"lnk\" href=\"{}\">Read the report</a>.", safe_href(&format!("{REPORTS}/{}-{commit}.json", engine.id)))
}

fn reviewed_line(engine: &Engine, review: &Review) -> String {
    let checked = if review.approval.is_some() { ", after a person checked the flagged lines" } else { "" };
    let report = report_link(engine, &review.commit);
    let end = if report.is_empty() { "." } else { "" };
    format!("Reviewed at commit {}{checked}{end}{report}", escape(&short(&review.commit)))
}

fn review_line(engine: &Engine, facts: &Facts) -> String {
    if let Some(declined) = &engine.review_declined {
        return format!("Review not granted for commit {}: {}.", escape(&short(&declined.commit)), escape(&declined.reason));
    }
    match &engine.reviewed {
        None => "Not reviewed yet.".to_string(),
        Some(review) if recheck_pending(engine, facts) => {
            format!("New commits since the review at {}. A new review is on the way.", escape(&short(&review.commit)))
        }
        Some(review) => reviewed_line(engine, review),
    }
}

/// A listed engine passed the seven checks. A flagged one is still listed, and says why in the catalog's own words.
fn listing_line(engine: &Engine) -> String {
    let link = format!("<a class=\"lnk\" href=\"../../{}\">Listed</a>", paths::section("listed-and-community"));
    if engine.recommendable {
        return format!("{link}: Passed all seven checks.");
    }
    format!("{link}. Warning: {}.", escape(&crate::model::warning_reason(engine)))
}

pub fn review_section(engine: &Engine, facts: &Facts) -> String {
    format!(
        "<h3 id=\"listing\">Listing</h3><p>{}</p><h3 id=\"review\">Security review</h3><p>{}</p>",
        listing_line(engine),
        review_line(engine, facts),
    )
}

/// The README badge. Only a reviewed entry has one.
pub fn badge_box(engine: &Engine) -> String {
    let (Some(review), None) = (&engine.reviewed, &engine.review_declined) else { return String::new() };
    let short = short(&review.commit);
    let markdown = format!("[![Kalsa reviewed {short}]({origin}/badge/{id}.svg)]({origin}/engines/{id})", origin = paths::ORIGIN, id = engine.id);
    format!(
        "<div class=\"box badgebox\"><h5>README badge</h5><p><span class=\"bdg\"><i>Kalsa</i><b>reviewed {short}</b></span></p><pre>{md}</pre>\
         <button class=\"cp\" data-copy=\"{md}\">Copy badge</button></div>",
        short = escape(&short),
        md = escape(&markdown),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const DECLINED: &str = r#"
[[engine]]
id = "fork-x"
name = "fork x"
repo = "owner/fork-x"
author = "owner"
license = "MIT"
kind = "engine"
hardware = ["apple-m1"]
summary = "A fork"

[[engine.improvement]]
kind = "new-hardware"
summary = "Longer context in the README"
machine = "Apple M1 Max"
source = "https://example.com/readme"

[engine.review_declined]
commit = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
date = "2026-11-18"
reason = "the README asks users to run an install script from another repository"
"#;

    #[test]
    fn declined_review_shows_only_the_short_notice() {
        let catalog = kalsa_engines::parse(DECLINED).expect("valid catalog");
        let engine = &catalog.engine[0];
        let section = review_section(engine, &Facts::none());
        assert!(section.contains(
            "Review not granted for commit aaaaaaa: the README asks users to run an install script from another repository."
        ));
        assert!(!section.contains("Reviewed"));
        assert!(!crate::cards::badge_pill(engine, &Facts::none()).contains("Reviewed"));
        assert!(crate::badge::badge_svg(engine).is_none());
        assert!(!crate::engines::engines_json(&catalog).contains("\"badge\""), "the review filter is gone, so its field is too");
    }
}
