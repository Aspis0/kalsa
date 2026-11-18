//! The review badge as the engine page shows it: Listing and Badge are two separate things.

use kalsa_engines::{Engine, Kind};

use crate::facts::Facts;
use crate::html::escape;
use crate::model::recheck_pending;

const LOWER_THE_RISK: &str = "A review lowers the risk, it cannot remove it.";

fn listing_panel(engine: &Engine) -> String {
    if engine.kind == Kind::Reference {
        return "<div class=\"lvl on\"><b>Listed</b><span class=\"st\">In the catalog</span><p>Passes the catalog rules: licence, stars and signs of life. A reference engine is the baseline others are measured against, so it has no comparison of its own.</p></div>".to_string();
    }
    let extra = if engine.recommendable { " A listed engine can be recommended.".to_string() } else { format!(" Kalsa does not recommend it: {}", engine.note.as_deref().map(escape).unwrap_or_default()) };
    format!("<div class=\"lvl on\"><b>Listed</b><span class=\"st\">In the catalog</span><p>Passes the catalog rules: licence, stars, signs of life and a published same-machine benchmark.{extra}</p></div>")
}

fn badge_panel(engine: &Engine, facts: &Facts) -> String {
    let Some(review) = &engine.reviewed else {
        let how = match engine.kind {
            Kind::Reference => "Reference projects such as llama.cpp and mlx-lm are the baseline others are compared against. They are not diff-reviewed. That is a note, not a badge.".to_string(),
            Kind::Fork => "A review would check the fork's diff against its upstream.".to_string(),
            Kind::Engine => "This is an engine, not a fork, so a review would cover the whole repository.".to_string(),
        };
        return format!("<div class=\"lvl\"><b>No badge</b><span class=\"st\">Not reviewed</span><p>Kalsa has not checked this code yet, so there is no badge. {how}</p></div>");
    };
    if recheck_pending(engine, facts) {
        return format!(
            "<div class=\"lvl on\"><b>Reviewed, re-check pending</b><span class=\"st\">Badge</span><p>A newer commit has landed since the review at <code>{}</code>. It is waiting to be looked at again.</p></div>",
            escape(&review.commit)
        );
    }
    let what = if engine.kind == Kind::Fork { format!("the diff against {}", escape(&review.upstream)) } else { "the whole repository".to_string() };
    format!(
        "<div class=\"lvl on\"><b>Reviewed</b><span class=\"st\">Badge</span><p>Reviewed: no suspicious changes found in {what} at <code>{commit}</code>. Checked on {date}.</p></div>",
        commit = escape(&review.commit),
        date = escape(&review.date),
    )
}

pub fn review_section(engine: &Engine, facts: &Facts) -> String {
    format!(
        "<h3 id=\"review\">Kalsa review</h3><p class=\"sm\">Listing and badge are separate. The badge is \"Reviewed\" or nothing. {LOWER_THE_RISK} \
         <a class=\"lnk\" href=\"../../how-we-choose/index.html#what-the-badge-means\">What the badge means</a></p><div class=\"lvls two\">{}{}</div>",
        listing_panel(engine),
        badge_panel(engine, facts)
    )
}

/// The author's README badge. Only a reviewed entry has one, in either listing tier.
pub fn badge_box(engine: &Engine) -> String {
    let Some(review) = &engine.reviewed else {
        return format!("<div class=\"box badgebox\"><h5>Are you the author?</h5><p class=\"sm\">No badge yet. A badge appears once Kalsa has reviewed the code at a commit. {LOWER_THE_RISK}</p></div>");
    };
    let short: String = review.commit.chars().take(7).collect();
    let markdown = format!("[![Kalsa reviewed {short}](https://kalsa.io/badge/{id}.svg)](https://kalsa.io/engines/{id})", id = engine.id);
    format!(
        "<div class=\"box badgebox\"><h5>Are you the author?</h5><p><span class=\"bdg\"><i>Kalsa</i><b>reviewed {short}</b></span></p><pre>{md}</pre>\
         <button class=\"cp\" data-copy=\"{md}\">Copy badge</button><p class=\"sm\">The badge is \"Reviewed\" or nothing. {LOWER_THE_RISK}</p></div>",
        short = escape(&short),
        md = escape(&markdown),
    )
}
