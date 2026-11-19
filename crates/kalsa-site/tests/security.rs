mod common;

use std::path::{Path, PathBuf};

use kalsa_site::{render, write_site, Facts, ORIGIN};

use common::{body, generated, html, HOSTILE};

#[test]
fn hostile_catalog_text_is_escaped_in_text_and_attributes() {
    let catalog = kalsa_engines::parse(HOSTILE).expect("the fixture is valid");
    let files = render(&catalog, &Facts::none());
    for (page, text) in html(&files) {
        assert!(!text.contains("<script>alert"), "{page:?} has a live script");
        assert!(!text.contains("<img src=x"), "{page:?} has a live image");
        assert!(!text.contains("<b>machine</b>") && !text.contains("<i>b</i>"), "{page:?}");
        assert!(!text.contains("onmouseover=\"alert"), "{page:?} has an injected attribute");
    }
    assert!(body(&files, "engines/hostile/index.html").contains("&lt;script&gt;alert(1)&lt;/script&gt;"));
    assert!(files.iter().any(|(path, text)| path == Path::new("badge/hostile.svg") && text.contains("reviewed a1b2c3d")));
}

#[test]
fn hostile_sources_and_ids_are_rejected_at_validation() {
    let source = HOSTILE.replace("https://example.invalid/a", "javascript:alert(1)");
    assert!(kalsa_engines::parse(&source).unwrap_err().contains("benchmark source must be an https URL"));
    let id = HOSTILE.replace("id = \"hostile\"", "id = \"../evil\"");
    assert!(kalsa_engines::parse(&id).unwrap_err().contains("id must be"));
}

#[test]
fn the_writer_refuses_paths_that_leave_the_output_directory() {
    let out = std::env::temp_dir().join(format!("kalsa-site-writer-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&out);
    for bad in ["../escape.html", "/etc/escape.html", "a/../../escape.html"] {
        let files = vec![(PathBuf::from(bad), "x".to_string())];
        assert!(write_site(&files, &out).is_err(), "{bad} must be refused");
    }
    assert!(!out.parent().unwrap().join("escape.html").exists());
    let fine = vec![(PathBuf::from("a/b/index.html"), "ok".to_string())];
    assert_eq!(write_site(&fine, &out), Ok(1));
    assert_eq!(std::fs::read_to_string(out.join("a/b/index.html")).unwrap(), "ok");
    let _ = std::fs::remove_dir_all(&out);
}

fn mailtos(text: &str) -> Vec<&str> {
    text.split("href=\"mailto:").skip(1).map(|rest| rest.split('"').next().unwrap_or_default()).collect()
}

#[test]
fn mailto_links_are_only_ever_our_two_addresses_and_never_catalog_data() {
    let files = generated();
    for (page, text) in html(&files) {
        for address in mailtos(text) {
            assert!(["help@kalsa.io", "main@kalsa.io"].contains(&address), "{page:?} has mailto:{address}");
        }
    }
    let hostile = HOSTILE.replace("summary = \"<script>alert(1)</script>\"", "summary = \"mailto:evil@example.invalid\"").replace("name = \"x\\\" onmouseover=\\\"alert(1)\"", "name = \"mailto:evil@example.invalid\"");
    let catalog = kalsa_engines::parse(&hostile).expect("the fixture is valid");
    for (page, text) in html(&render(&catalog, &Facts::none())) {
        assert!(!text.contains("href=\"mailto:evil"), "{page:?} turned catalog text into a mailto link");
    }
}

#[test]
fn the_contact_addresses_sit_where_they_belong() {
    let files = generated();
    for (page, text) in html(&files) {
        assert!(text.contains("href=\"mailto:main@kalsa.io\">Contact</a>"), "{page:?} footer contact");
    }
    for path in ["engines/frink/index.html", "dev/antonellof/index.html"] {
        let page = body(&files, path);
        assert!(page.contains("href=\"mailto:help@kalsa.io\">help@kalsa.io"), "{path}");
        assert!(page.contains("remove/index.html?kind="), "{path} links the removal page");
        assert!(!page.contains("issues/new"), "{path} no longer asks for a removal by issue");
    }
    assert!(body(&files, "listed-and-community/index.html").contains("mailto:help@kalsa.io"));
    assert!(body(&files, "submit/index.html").contains("mailto:help@kalsa.io"));
    assert!(html(&files).all(|(_, text)| !text.contains("support@kalsa.io")), "support@ is gone from the site");
}

#[test]
fn no_page_carries_an_inline_style_or_script_the_csp_would_block() {
    for (page, text) in html(&generated()) {
        assert!(!text.contains("style=\""), "{page:?} has an inline style attribute");
        assert!(!text.contains("style='"), "{page:?} has an inline style attribute");
        assert!(!text.contains("<script>"), "{page:?} has an inline script");
        assert!(!text.contains("javascript:"), "{page:?} has a javascript: URL");
    }
}

#[test]
fn the_assets_headers_file_hardens_every_static_page() {
    let files = generated();
    let headers = body(&files, "_headers");
    assert!(headers.contains("/*"), "_headers must apply to every path");
    assert!(headers.contains("X-Robots-Tag: noindex, nofollow"), "the site stays out of search engines until it is announced");
    for expected in [
        "X-Content-Type-Options: nosniff",
        "Referrer-Policy: strict-origin-when-cross-origin",
        "Strict-Transport-Security: max-age=31536000; includeSubDomains",
        "Cross-Origin-Opener-Policy: same-origin",
        "Cross-Origin-Resource-Policy: same-origin",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self' https:",
        "frame-ancestors 'none'",
        "object-src 'none'",
    ] {
        assert!(headers.contains(expected), "_headers lacks {expected}");
    }
    let permissions = headers.split("Permissions-Policy: ").nth(1).and_then(|rest| rest.lines().next()).unwrap_or_default();
    for feature in ["camera=()", "microphone=()", "geolocation=()", "display-capture=()", "payment=()", "usb=()"] {
        assert!(permissions.contains(feature), "Permissions-Policy does not deny {feature}");
    }
    assert!(!headers.contains("unsafe-inline"), "the CSP must not be loosened to fit the pages");
    assert!(!headers.contains("unsafe-eval"), "the CSP must not be loosened to fit the pages");
    assert!(files.iter().any(|(path, _)| path == Path::new("static/chevron.svg")), "the select arrow is a file, not a data: URI");
    assert!(!body(&files, "static/base.css").contains("data:image"), "a data: URI would need img-src data:");
}

/// Cloudflare joins duplicate `_headers` values with a comma; a `! Name` line detaches what earlier
/// rules set. This models those semantics, so the test asserts the header a visitor actually receives
/// rather than the presence of a line in the file.
fn effective_header(headers: &str, path: &str, name: &str) -> String {
    let mut values: Vec<String> = Vec::new();
    let mut applies = false;
    for line in headers.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if !line.starts_with([' ', '\t']) {
            applies = match trimmed.strip_suffix('*') {
                Some(prefix) => path.starts_with(prefix),
                None => trimmed == path,
            };
            continue;
        }
        if !applies {
            continue;
        }
        if let Some(detached) = trimmed.strip_prefix('!') {
            if detached.trim().eq_ignore_ascii_case(name) {
                values.clear();
            }
            continue;
        }
        if let Some((key, value)) = trimmed.split_once(':') {
            if key.trim().eq_ignore_ascii_case(name) {
                values.push(value.trim().to_string());
            }
        }
    }
    values.join(", ")
}

#[test]
fn a_badge_is_readable_from_any_host_and_everything_else_is_not() {
    let files = generated();
    let headers = body(&files, "_headers");
    assert_eq!(
        effective_header(headers, "/badge/frink.svg", "Cross-Origin-Resource-Policy"),
        "cross-origin",
        "the badge rule must detach the global value, not be joined to it"
    );
    for path in ["/", "/engines/frink/", "/hardware/apple-m1/", "/static/base.css", "/pages.json", "/sitemap.xml"] {
        assert_eq!(effective_header(headers, path, "Cross-Origin-Resource-Policy"), "same-origin", "{path}");
    }
    assert!(headers.contains("! Cross-Origin-Resource-Policy"), "the detach directive is what makes the override work");
    for name in ["Content-Security-Policy", "X-Robots-Tag", "Strict-Transport-Security", "Cross-Origin-Opener-Policy"] {
        assert_eq!(effective_header(headers, "/badge/frink.svg", name), effective_header(headers, "/", name), "{name} must survive the badge rule");
    }
}

#[test]
fn every_public_url_is_built_from_the_one_origin_constant() {
    let files = generated();
    assert_eq!(ORIGIN, "https://preview.kalsa.io", "the origin the Worker's SITE_ORIGIN must match");
    assert!(body(&files, "sitemap.xml").contains(&format!("<loc>{ORIGIN}/engines/frink</loc>")));
    assert!(body(&files, "index.html").contains(&format!("<link rel=\"canonical\" href=\"{ORIGIN}/\">")));
    assert!(body(&files, "llms.txt").contains(&format!("{ORIGIN}/engines/engines.json")));
    for (path, text) in html(&files) {
        assert!(!text.contains("https://kalsa.io/"), "{path:?} still links the old origin");
    }
    assert!(!body(&files, "llms.txt").contains("https://kalsa.io/"), "llms.txt still links the old origin");
}

#[test]
fn every_reader_is_allowed_and_the_site_stays_out_of_search_indexes() {
    let files = generated();
    let robots = body(&files, "robots.txt");
    assert!(robots.contains("User-agent: *") && robots.contains("Allow: /"), "robots.txt allows every agent");
    assert!(!robots.contains("Disallow"), "no agent is refused, AI bots included");
    for bot in ["GPTBot", "ClaudeBot", "CCBot", "Google-Extended", "PerplexityBot"] {
        assert!(!robots.contains(bot), "robots.txt singles out {bot}");
    }
    assert!(body(&files, "_headers").contains("X-Robots-Tag: noindex, nofollow"), "search indexing is still refused by the header");
}

#[test]
fn llms_txt_describes_the_site_and_links_its_main_pages_and_data() {
    let files = generated();
    let llms = body(&files, "llms.txt");
    assert!(llms.starts_with("# Kalsa"), "a plain description first");
    for link in [
        format!("{ORIGIN}/engines)"), format!("{ORIGIN}/hardware)"), format!("{ORIGIN}/listed-and-community)"),
        format!("{ORIGIN}/submit)"), format!("{ORIGIN}/privacy)"), format!("{ORIGIN}/engines/engines.json)"), format!("{ORIGIN}/sitemap.xml)"),
    ] {
        assert!(llms.contains(&link), "llms.txt lacks {link}");
    }
    assert!(llms.contains("noindex"), "it says why search engines do not index the site");
    assert!(common::banned(llms).is_empty(), "{:?}", common::banned(llms));
    assert!(!llms.chars().any(|character| (character as u32) >= 0x1F000), "no emoji");
}

