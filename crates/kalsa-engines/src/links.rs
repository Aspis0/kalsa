//! The links an entry carries: its upstream and its website.

use crate::{valid_source, Catalog, Engine};

/// Every project another entry builds on is itself listed, so an `upstream` always has a page to link to.
pub(crate) fn validate_upstreams(catalog: &Catalog) -> Result<(), String> {
    for engine in &catalog.engine {
        let Some(upstream) = engine.upstream.as_deref().filter(|upstream| !upstream.is_empty()) else { continue };
        if !catalog.engine.iter().any(|other| other.repo.eq_ignore_ascii_case(upstream)) {
            return Err(format!("{}: upstream {upstream} is not a catalog entry; list it as a reference", engine.id));
        }
    }
    Ok(())
}

/// The website is shown as a link, so it is a plain https URL; a label only makes sense with one.
pub(crate) fn validate_website(engine: &Engine) -> Result<(), String> {
    match (&engine.website, &engine.website_label) {
        (Some(site), _) if !valid_source(site) => Err(format!("{}: website must be an https URL without credentials", engine.id)),
        (None, Some(_)) => Err(format!("{}: website_label needs a website", engine.id)),
        (_, Some(label)) if label.trim().is_empty() => Err(format!("{}: website_label is empty", engine.id)),
        _ => Ok(()),
    }
}
