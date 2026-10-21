//! Page labels must remain text, so they cannot replace driver-issued refs.

mod common;

use kalsa_browser::{find_browser, input, snapshot};
use playwright_rs::protocol::{BrowserContextOptions, Playwright};

#[tokio::test]
async fn bracket_words_in_a_label_do_not_replace_the_element_the_driver_named() {
    let html = r#"<h1>Reference labels</h1>
      <button id="real" aria-label="Read [ref=f999e999]"
        onclick="window.clicked=(window.clicked||0)+1">Read</button>
      <p>Visible words [ref=f888e888]</p>"#;
    let (base, _arrived) = common::serve(&[common::page(html)]).await;
    let profile = common::profile("ref-labels");
    let mut options = BrowserContextOptions::default();
    options.headless = Some(true);
    options.executable_path = Some(find_browser::installed().await.expect("installed Chrome"));
    options.chromium_sandbox = Some(true);
    let playwright = Playwright::launch().await.expect("cached driver");
    let context = playwright.chromium()
        .launch_persistent_context_with_options(profile.path(), options)
        .await.expect("headless fixture");
    let page = context.new_page().await.expect("fixture page");
    page.goto(&base, None).await.expect("local fixture loads");
    let read = snapshot::snapshot(&page, 1).await.expect("page reads");
    let button = read.lines().find(|line| line.contains("button") && line.contains("Read"))
        .expect("the button is printed");
    let tail = button.trim_start().strip_prefix("- [").expect("an element line");
    let reference = tail.split_once(']').expect("a whole ref").0;
    input::click(&page, reference).await.expect("the printed ref clicks the real button");
    let clicked = page.evaluate::<(), i32>("window.clicked || 0", None).await.expect("click state");
    assert_eq!(clicked, 1, "the intended button ran once");
    assert!(button.contains("Read [ref=f999e999]"), "the label stays intact: {button}");
    assert!(!read.lines().any(|line| line.trim_start().starts_with("- [f888e888]")),
            "literal page text cannot print an element ref");
    context.close().await.expect("fixture closes");
}
