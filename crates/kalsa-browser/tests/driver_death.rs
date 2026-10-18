//! The driver killed outright, which is what a crash looks like from here.
//!
//! This lives in its own test binary on purpose. Every test in a binary shares
//! one process, and the driver is a child of that process — so a test that kills
//! its driver kills the drivers of the tests running beside it, and the failure
//! would look like the whole suite hanging. A binary of its own has a process of
//! its own, and the children it finds are its own.

mod common;

use kalsa_browser::{input, session};
use std::process::Command;
use std::time::Duration;

#[tokio::test]
async fn a_driver_killed_outright_is_one_clean_line_and_the_session_recovers() {
    let (base, _arrived) = common::serve(&[common::page(r#"<h1>here</h1><a id="go" href="/">Home</a>"#)]).await;
    let (sessions, page) = common::sessions_on("driver-killed", &base).await;
    page.goto(&base, None).await.expect("the page loads");

    let children = common::driver_children();
    assert!(!children.is_empty(), "no child process to kill");
    for pid in &children {
        Command::new("kill").args(["-9", &pid.to_string()]).status().ok();
    }
    tokio::time::sleep(Duration::from_millis(400)).await;

    // Whatever the driver says on its way out, the model reads one of our
    // sentences and not a stack trace or a raw net error.
    let spoken = match input::click(&page, "e2").await {
        Ok(()) => panic!("a click on a dead driver must not be reported as done"),
        Err(refused) => refused.reason().to_string(),
    };
    let ours = [
        session::Reason::Closed.reason(),
        session::Reason::DriverGone.reason(),
        "the page did not answer that call; try again",
        "the element is not on the page any more: read the page again",
    ];
    assert!(ours.contains(&spoken.as_str()), "not one of our lines: {spoken}");

    // The session comes back **without being told to**. The rule is the product's
    // own — the same call the server makes when a tool call fails — so the test
    // hands it the driver's error and lets it decide.
    sessions
        .forget_if_gone(
            &playwright_rs::Error::ProtocolError("Target page, context or browser has been closed".to_string()),
            &page,
        )
        .await;
    let (fresh, _landings, _holds) = sessions.page().await.expect("the session comes back with a new driver");
    let origin = base.clone();
    fresh
        .route("**/*", move |route| {
            let origin = origin.clone();
            async move {
                if route.request().url().starts_with(&origin) {
                    route.continue_(None).await
                } else {
                    route.fallback(None).await
                }
            }
        })
        .await
        .ok();
    fresh.goto(&base, None).await.expect("and the page loads in it");
}