//! A page that asks for a person to prove they are a person: a human check is
//! recognised, and an ordinary page with a widget on it is not.
//!
//! Proved against a real browser, because only a real page has real words on it
//! and real frames above it.

mod common;

use kalsa_browser::{robot, snapshot};

/// **The frame a reCAPTCHA is served in**, with the label it carries. The
/// label is the widget's own words, and they are on every signup form on the
/// web.
const WIDGET: &str = "<label>I'm not a robot</label>";

/// **The page a challenge serves.** The words are the ones Google's interstitial
/// says, and the frame is the one a reCAPTCHA is served in.
fn a_challenge() -> String {
    "<h1>Our systems have detected unusual traffic from your computer network</h1>\
     <p>To continue, please type the characters you see below</p>\
     <iframe src=\"/recaptcha/api2/anchor\"></iframe>"
        .to_string()
}

/// **The page an ordinary form serves, with the very same widget on it.**
fn a_form_with_a_widget() -> String {
    "<h1>Sign in</h1>\
     <p>I'm not a robot</p>\
     <label>Email</label><input type=\"email\">\
     <button>Continue</button>\
     <iframe src=\"/recaptcha/api2/anchor\"></iframe>"
        .to_string()
}

/// **An ordinary page, with nothing of a check on it.**
fn an_ordinary_page() -> String {
    "<h1>A shop</h1><p>One notebook, eleven euro</p><button>Buy</button>".to_string()
}

/// **A page that is long, as an article or a form is.** A check is a few lines:
/// a page this long is not one, whatever words or widgets it carries.
fn long_text(line: &str) -> String {
    (0..150).map(|n| format!("<p>{line} Paragraph {n}.</p>")).collect()
}

/// **The challenge is a challenge.** The words and the frame are both there, and
/// a model cannot pass one.
#[tokio::test]
async fn a_page_that_asks_for_a_person_is_a_human_check() {
    let (base, _arrived) = common::serve(&[
        common::page(&a_challenge()),
        common::page_at("/recaptcha/api2/anchor", WIDGET),
    ])
    .await;
    let (_playwright, _context, page) = common::browser_on("robot-check", &base).await;
    page.goto(&format!("{base}/"), None).await.expect("the page loads");

    let whole = snapshot::whole_of(&page).await.expect("the page reads");
    assert!(whole.contains("unusual traffic"), "the page says the words: {whole}");
    assert!(
        robot::is_robot_check(&page, &whole, &page.url()).await,
        "the words and the frame are both there: {whole}"
    );
}

/// **The widget on an ordinary form is a widget.** This is the false positive
/// the rule has to avoid: the reCAPTCHA says its own words on every signup form
/// on the web, and the page is the site's own.
#[tokio::test]
async fn a_form_with_a_recaptcha_is_not_a_human_check() {
    let (base, _arrived) = common::serve(&[
        common::page(&a_form_with_a_widget()),
        common::page_at("/recaptcha/api2/anchor", WIDGET),
    ])
    .await;
    let (_playwright, _context, page) = common::browser_on("robot-widget", &base).await;
    page.goto(&format!("{base}/"), None).await.expect("the page loads");

    let whole = snapshot::whole_of(&page).await.expect("the page reads");
    assert!(
        whole.contains("not a robot"),
        "the widget's own words are on the page, so the rule had to say no: {whole}"
    );
    assert!(
        !robot::is_robot_check(&page, &whole, &page.url()).await,
        "the widget's own words are not the page being a check: {whole}"
    );
}

/// **An ordinary page is an ordinary page.** Nothing on it says a check, and
/// nothing on it carries one.
#[tokio::test]
async fn an_ordinary_page_is_not_a_human_check() {
    let (base, _arrived) = common::serve(&[common::page(&an_ordinary_page())]).await;
    let (_playwright, _context, page) = common::browser_on("robot-plain", &base).await;
    page.goto(&format!("{base}/"), None).await.expect("the page loads");

    let whole = snapshot::whole_of(&page).await.expect("the page reads");
    assert!(
        !robot::is_robot_check(&page, &whole, &page.url()).await,
        "a shop is not a check: {whole}"
    );
}

/// **A Turnstile widget on an ordinary form is a widget.** "Verify you are
/// human" is Turnstile's own label, and its frame is served from a challenge
/// provider. The form is long, as a real signup page is, so the page is not the
/// check and the form is answered.
#[tokio::test]
async fn a_turnstile_widget_on_an_ordinary_form_is_not_a_human_check() {
    let form = format!(
        "<h1>Sign up</h1>{}<p>Verify you are human</p>\
         <label>Email</label><input type=\"email\">\
         <iframe src=\"https://challenges.cloudflare.com/turnstile/v0/api.js\"></iframe>",
        long_text("Create an account and read the terms of the service before you continue.")
    );
    let (base, _arrived) = common::serve(&[common::page(&form)]).await;
    let (_playwright, _context, page) = common::browser_on("robot-turnstile", &base).await;
    page.goto(&format!("{base}/"), None).await.expect("the page loads");

    let whole = snapshot::whole_of(&page).await.expect("the page reads");
    assert!(whole.contains("Verify you are human"), "the widget's label is on the page: {whole}");
    assert!(
        !robot::is_robot_check(&page, &whole, &page.url()).await,
        "a widget's label and its frame are not a check: {whole}"
    );
}

/// **An article about traffic, with a reCAPTCHA on the page, is an article.** It
/// says the words of a check and it has the frame of one, and it is long: the
/// words alone are not the page being a check.
#[tokio::test]
async fn a_long_article_that_says_the_words_is_not_a_human_check() {
    let article = format!(
        "<h1>Traffic</h1>{}<iframe src=\"/recaptcha/api2/anchor\"></iframe>",
        long_text("Unusual traffic is a term that analysts use for a sudden change in visits.")
    );
    let (base, _arrived) = common::serve(&[
        common::page(&article),
        common::page_at("/recaptcha/api2/anchor", WIDGET),
    ])
    .await;
    let (_playwright, _context, page) = common::browser_on("robot-article", &base).await;
    page.goto(&format!("{base}/"), None).await.expect("the page loads");

    let whole = snapshot::whole_of(&page).await.expect("the page reads");
    assert!(whole.to_lowercase().contains("unusual traffic"), "the article says the words: {whole}");
    assert!(
        !robot::is_robot_check(&page, &whole, &page.url()).await,
        "a long article is not the check: {whole}"
    );
}

/// **A short page that says the words, with no frame and no provider, is not a
/// check.** The words alone are not enough: the page has to be the check, and a
/// challenge provider has to say so too.
#[tokio::test]
async fn a_short_page_with_the_words_and_no_frame_is_not_a_human_check() {
    let (base, _arrived) = common::serve(&[common::page("<h1>Checking your browser</h1><p>Please wait.</p>")]).await;
    let (_playwright, _context, page) = common::browser_on("robot-words", &base).await;
    page.goto(&format!("{base}/"), None).await.expect("the page loads");

    let whole = snapshot::whole_of(&page).await.expect("the page reads");
    assert!(whole.contains("Checking your browser"), "the page says the words: {whole}");
    assert!(
        !robot::is_robot_check(&page, &whole, &page.url()).await,
        "the words of a check with no frame of one are not a check: {whole}"
    );
}
