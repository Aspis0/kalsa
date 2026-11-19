mod common;

use std::path::Path;

use common::{banned, body, generated, html, visible};

const NAME: &str = "Marco Gualtieri";

fn worker_file(path: &str) -> String {
    std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../worker").join(path)).unwrap_or_else(|error| panic!("worker/{path}: {error}"))
}

#[test]
fn the_privacy_page_exists_and_is_in_the_sitemap() {
    let files = generated();
    let page = body(&files, "privacy/index.html");
    assert!(page.contains("<title>Privacy notice | Kalsa</title>") && page.contains("Dated 2026-11-18."));
    assert!(body(&files, "sitemap.xml").contains("<loc>https://kalsa.io/privacy</loc>"));
}

#[test]
fn every_page_links_the_notice_from_its_footer_next_to_contact() {
    for (page, text) in html(&generated()) {
        let footer = text.split("<footer").nth(1).unwrap_or_else(|| panic!("{page:?} has a footer"));
        assert!(footer.contains("privacy/index.html\">Privacy</a>"), "{page:?} footer link");
        assert!(footer.contains("Contact</a> · <a href=\""), "{page:?} Privacy follows Contact");
        let nav = text.split("<nav class=\"nav\"").nth(1).and_then(|rest| rest.split("</nav>").next()).unwrap_or_default();
        assert!(!nav.contains("privacy/"), "{page:?} keeps the notice out of the nav");
    }
}

#[test]
fn the_sign_in_page_asks_for_agreement_to_the_notice() {
    let files = generated();
    let page = body(&files, "signin/index.html");
    assert!(visible(page).contains("By signing in you agree to the privacy notice."));
    assert!(page.contains("href=\"../privacy/index.html\">privacy notice</a>"));
}

#[test]
fn the_controller_is_named_on_the_privacy_page_and_nowhere_else() {
    let files = generated();
    assert!(visible(body(&files, "privacy/index.html")).contains(&format!("Kalsa is run by {NAME}, a private individual, not a company, on a non-profit basis. He is the data controller. Contact: main@kalsa.io")));
    for (path, text) in &files {
        if path == Path::new("privacy/index.html") {
            continue;
        }
        assert!(!text.contains("Gualtieri") && !text.contains("Marco"), "{path:?} names the controller");
    }
}

#[test]
fn the_notice_has_no_safety_claims_and_no_emoji() {
    let files = generated();
    let page = body(&files, "privacy/index.html");
    assert!(banned(&visible(page)).is_empty(), "{:?}", banned(&visible(page)));
    assert!(!page.chars().any(|character| (character as u32) >= 0x1F000));
}

#[test]
fn the_notice_states_each_claim_in_its_own_words() {
    let files = generated();
    let text = visible(body(&files, "privacy/index.html"));
    for claim in [
        "your account id there, your username, your avatar URL and the time you first signed in",
        "holds only a hash of your session cookie",
        "30 days after you sign in",
        "kept for 10 minutes",
        "We do not store your email address, a password or the provider’s access token",
        "used once to read your username and then discarded",
        "There are no tracking cookies.",
        "__Host-kalsa_session",
        "__Host-kalsa_oauth",
        "there is no cookie banner",
        "We do not run analytics today.",
        "invocation logs, which would hold the full request URL, are switched off",
        "Cloudflare",
        "legitimate interest",
        "complain to your data protection authority",
        "write to help@kalsa.io with your provider and username",
        "We cannot verify who owns an email address",
        "a short code to your provider profile",
        "Account data is kept until you ask for deletion.",
        "deleted the next time anyone signs in",
        "2026-11-18: first version.",
    ] {
        assert!(text.contains(claim), "{claim}");
    }
}

#[test]
fn the_notice_matches_what_the_worker_does() {
    assert!(worker_file("src/session.ts").contains("SESSION_COOKIE = \"__Host-kalsa_session\"") && worker_file("src/session.ts").contains("SESSION_TTL_SECONDS = 30 * 24 * 60 * 60"));
    let state = worker_file("src/state.ts");
    assert!(state.contains("STATE_COOKIE = \"__Host-kalsa_oauth\"") && state.contains("STATE_TTL_SECONDS = 600"));
    let config = worker_file("wrangler.jsonc");
    assert!(config.contains("\"invocation_logs\": false") && config.contains("\"head_sampling_rate\": 0.01"));
    let schema = worker_file("migrations/0001_accounts.sql") + &worker_file("migrations/0002_single_use_state.sql");
    for column in ["provider TEXT", "provider_user_id TEXT", "username TEXT", "avatar_url TEXT", "created_at INTEGER", "hash TEXT PRIMARY KEY", "expires_at INTEGER"] {
        assert!(schema.contains(column), "{column}");
    }
    for stored in ["email", "password", "access_token", "token"] {
        assert!(!schema.to_ascii_lowercase().replace("provider access tokens are never written here", "").contains(stored), "the schema has a {stored} column");
    }
    assert!(!std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../site/static/account.js")).unwrap().contains("localStorage"));
}
