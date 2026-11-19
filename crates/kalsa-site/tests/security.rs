mod common;

use std::path::{Path, PathBuf};

use kalsa_site::{render, write_site, Facts};

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
        assert!(page.contains("href=\"mailto:help@kalsa.io\">help@kalsa.io") && page.contains("issues/new?title=Removal%20request%3A%20"), "{path}");
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
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self' https:",
        "frame-ancestors 'none'",
        "object-src 'none'",
    ] {
        assert!(headers.contains(expected), "_headers lacks {expected}");
    }
    assert!(!headers.contains("unsafe-inline"), "the CSP must not be loosened to fit the pages");
    assert!(!headers.contains("unsafe-eval"), "the CSP must not be loosened to fit the pages");
    assert!(files.iter().any(|(path, _)| path == Path::new("static/chevron.svg")), "the select arrow is a file, not a data: URI");
    assert!(!body(&files, "static/base.css").contains("data:image"), "a data: URI would need img-src data:");
}

#[test]
fn every_benchmark_bar_width_is_a_class_the_stylesheet_defines() {
    let files = generated();
    let css = body(&files, "static/base.css");
    let mut bars = 0;
    for (page, text) in html(&files) {
        for rest in text.split("<i class=\"w").skip(1) {
            let width: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
            assert!(!width.is_empty(), "{page:?} has a bar with no width");
            assert!(css.contains(&format!(".w{width}{{width:{width}%}}")), "{page:?} uses .w{width}, which base.css does not define");
            bars += 1;
        }
    }
    assert!(bars > 0, "the catalogue has benchmark bars");
}
