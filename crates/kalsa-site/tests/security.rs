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
fn the_contact_addresses_sit_where_the_owner_put_them() {
    let files = generated();
    for (page, text) in html(&files) {
        assert!(text.contains("href=\"mailto:main@kalsa.io\">Contact: main@kalsa.io"), "{page:?} footer contact");
    }
    for path in ["engines/frink/index.html", "dev/antonellof/index.html"] {
        let page = body(&files, path);
        assert!(page.contains("href=\"mailto:help@kalsa.io\">help@kalsa.io") && page.contains("issues/new?title=Removal%20request%3A%20"), "{path}");
    }
    assert!(body(&files, "how-we-choose/index.html").contains("mailto:help@kalsa.io"));
    assert!(body(&files, "submit/index.html").contains("mailto:help@kalsa.io"));
    assert!(html(&files).all(|(_, text)| !text.contains("support@kalsa.io")), "support@ is gone from the site");
}
