use super::*;

#[test]
fn a_drafter_that_does_not_fit_is_skipped_and_the_weights_place() {
    // The weights alone fit this disk, the drafter beside them does not:
    // the weights place, the drafter is skipped, and the start proceeds
    // without MTP — the drafter is retried on the next start. The bar the
    // page shows is sized by what will place, so it runs to its end over
    // the weights alone.
    let (url, requests) = serve(PLAN_BODY, "weights.gguf");
    let root = scratch("space-skip");
    let plan = DownloadPlan {
        url,
        bytes: PLAN_BODY.len() as u64,
        sha256: PLAN_SHA256,
        drafter: Some(DownloadFile {
            url: "https://unused.invalid/mtp-gemma-4-12B-it-Q8_0.gguf".to_string(),
            bytes: u64::MAX / 2,
            sha256: "0000000000000000000000000000000000000000000000000000000000000000",
        }),
    };
    let mut seen: Vec<(u64, u64)> = Vec::new();
    let placed = place_model(&plan, &root, true, &mut |step| {
        if let Progress::ModelBytes { done, total } = step {
            seen.push((done, total));
        }
    })
    .expect("the weights are the model, and they fit");
    assert_eq!(
        std::fs::read(&placed.weights).expect("read"),
        PLAN_BODY,
        "the weights landed"
    );
    assert!(
        placed.drafter.is_none(),
        "a drafter with no room is skipped, not the model"
    );
    assert_eq!(requests_of(&requests), 1, "only the weights were fetched");
    let weights = PLAN_BODY.len() as u64;
    assert!(
        seen.iter().all(|(_, reported)| *reported == weights),
        "a skipped drafter never enters the total: {seen:?}"
    );
    assert_eq!(
        seen.last(),
        Some(&(weights, weights)),
        "the bar closes over the weights alone: {seen:?}"
    );
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn a_drafter_that_fails_its_digest_is_skipped_without_a_part() {
    // The owner's rule: a drafter that cannot be placed never fails the
    // start. Here the wire serves the wrong bytes — the weights verify, the
    // drafter does not, nothing of it survives, and the answer is a start
    // without MTP whose bar closes at what did place.
    let (url, _requests) = serve(PLAN_BODY, "weights.gguf");
    let (wrong_drafter, _ignored) = serve(b"not the drafter the pin promised", "mtp.gguf");
    let root = scratch("drafter-corrupt");
    let plan = DownloadPlan {
        url,
        bytes: PLAN_BODY.len() as u64,
        sha256: PLAN_SHA256,
        drafter: Some(DownloadFile {
            url: wrong_drafter,
            bytes: b"not the drafter the pin promised".len() as u64,
            sha256: DRAFTER_SHA256,
        }),
    };
    let mut seen: Vec<(u64, u64)> = Vec::new();
    let placed = place_model(&plan, &root, true, &mut |step| {
        if let Progress::ModelBytes { done, total } = step {
            seen.push((done, total));
        }
    })
    .expect("the weights are placed; the drafter is not the model");
    assert!(placed.weights.is_file());
    assert!(placed.drafter.is_none(), "the failed drafter is skipped");
    assert!(
        !root.join("models").join("mtp.gguf").exists(),
        "a failed drafter must not become a file"
    );
    assert!(
        !root.join("models").join("mtp.gguf.part").exists(),
        "and its mismatched part is thrown away, not kept"
    );
    // The stream promised both files, then lost the drafter: its last
    // reading is a complete one over what placed.
    let weights = PLAN_BODY.len() as u64;
    let both = weights + b"not the drafter the pin promised".len() as u64;
    assert_eq!(
        seen.first(),
        Some(&(0, both)),
        "the zero-fire promised both"
    );
    assert_eq!(
        seen.last(),
        Some(&(weights, weights)),
        "the bar closes at what placed: {seen:?}"
    );
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn a_failed_digest_is_not_retried_for_a_day() {
    // A permanently wrong drafter pin would re-download its bytes on every
    // start, because a digest mismatch discards the part. The marker beside
    // the would-be file holds when it failed and the pin it failed against:
    // the same pin inside a day is skipped, a different pin or a day gone
    // by fetches again, and a placement that succeeds removes it.
    let root = scratch("drafter-marker");
    let models = root.join("models");
    std::fs::create_dir_all(&models).expect("mkdir");
    let (url, _requests) = serve(PLAN_BODY, "weights.gguf");
    let (wrong_drafter, wrong_requests) = serve(b"not the drafter the pin promised", "mtp.gguf");
    // A different pin from the good one below, so the marker's "this pin
    // failed" never answers for another.
    const WRONG_SHA256: &str = "1111111111111111111111111111111111111111111111111111111111111111";
    let failing = |drafter_url: String| DownloadPlan {
        url: url.clone(),
        bytes: PLAN_BODY.len() as u64,
        sha256: PLAN_SHA256,
        drafter: Some(DownloadFile {
            url: drafter_url,
            bytes: b"not the drafter the pin promised".len() as u64,
            sha256: WRONG_SHA256,
        }),
    };
    // A marker naming a different pin is not this pin's failure.
    std::fs::write(models.join("mtp.gguf.failed"), "0 0000").expect("a stranger's marker");
    let placed = place_model(&failing(wrong_drafter.clone()), &root, true, &mut |_| {})
        .expect("the weights place either way");
    assert!(placed.drafter.is_none(), "the digest still fails");
    assert_eq!(requests_of(&wrong_requests), 1, "a changed pin is fetched");
    let marker = models.join("mtp.gguf.failed");
    let written = std::fs::read_to_string(&marker).expect("the failure is remembered");
    let (at, pinned) = written.split_once(' ').expect("time and pin");
    assert_eq!(
        pinned, WRONG_SHA256,
        "the marker names the pin it failed against"
    );
    let at: u64 = at.parse().expect("a unix time");

    // The same pin inside a day: skipped, no request.
    let again = place_model(&failing(wrong_drafter.clone()), &root, true, &mut |_| {})
        .expect("still places");
    assert!(again.drafter.is_none());
    assert_eq!(
        requests_of(&wrong_requests),
        1,
        "the failed pin is not retried within a day"
    );

    // A day gone by (the marker's own time says so): fetched again.
    std::fs::write(
        &marker,
        format!(
            "{} {WRONG_SHA256}",
            at.saturating_sub(DRAFTER_RETRY_SECONDS + 1)
        ),
    )
    .expect("an aged marker");
    let retried = place_model(&failing(wrong_drafter.clone()), &root, true, &mut |_| {})
        .expect("still places");
    assert!(retried.drafter.is_none(), "the pin is still wrong");
    assert_eq!(requests_of(&wrong_requests), 2, "a day later it retries");

    // The pin that succeeds removes the marker.
    std::fs::write(models.join("weights.gguf"), PLAN_BODY).expect("weights proven");
    let (good_drafter, good_requests) = serve(DRAFTER_BODY, "mtp.gguf");
    let good = DownloadPlan {
        url,
        bytes: PLAN_BODY.len() as u64,
        sha256: PLAN_SHA256,
        drafter: Some(DownloadFile {
            url: good_drafter,
            bytes: DRAFTER_BODY.len() as u64,
            sha256: DRAFTER_SHA256,
        }),
    };
    let fixed = place_model(&good, &root, true, &mut |_| {}).expect("places");
    assert!(fixed.drafter.is_some(), "the good pin places");
    assert_eq!(requests_of(&good_requests), 1);
    assert!(
        !marker.exists(),
        "a successful placement clears the failure"
    );
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn a_missing_drafter_beside_present_weights_is_fetched_alone() {
    // The weights proven on disk and the drafter not: only the drafter is
    // fetched, after the weights, into the same models directory — and once
    // both are proven, neither is asked for again.
    let root = scratch("drafter-only");
    let models = root.join("models");
    std::fs::create_dir_all(&models).expect("mkdir");
    std::fs::write(models.join("weights.gguf"), PLAN_BODY).expect("the weights are here");
    let (drafter_url, drafter_requests) = serve(DRAFTER_BODY, "mtp-weights.gguf");
    let plan = DownloadPlan {
        url: "https://unused.invalid/weights.gguf".to_string(),
        bytes: PLAN_BODY.len() as u64,
        sha256: PLAN_SHA256,
        drafter: Some(DownloadFile {
            url: drafter_url,
            bytes: DRAFTER_BODY.len() as u64,
            sha256: DRAFTER_SHA256,
        }),
    };
    let placed = place_model(&plan, &root, true, &mut |_| {}).expect("only the drafter moves");
    assert_eq!(placed.weights, models.join("weights.gguf"));
    assert_eq!(
        placed.drafter.as_ref().expect("the drafter is placed"),
        &models.join("mtp-weights.gguf")
    );
    assert_eq!(
        std::fs::read(models.join("mtp-weights.gguf")).expect("read"),
        DRAFTER_BODY
    );
    assert_eq!(
        requests_of(&drafter_requests),
        1,
        "one fetch for the drafter, none for the weights"
    );
    let again = place_model(&plan, &root, true, &mut |_| {}).expect("both proven");
    assert_eq!(again.weights, placed.weights);
    assert_eq!(again.drafter, placed.drafter);
    assert_eq!(
        requests_of(&drafter_requests),
        1,
        "a proven drafter is never re-fetched"
    );
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn a_fully_proven_plan_reports_no_bytes() {
    // The old contract, restored: nothing moves, nothing is announced. A
    // progress line for an already-placed plan reads on the page as a model
    // re-downloading its own bytes, resumed or complete.
    let root = scratch("silent");
    let models = root.join("models");
    std::fs::create_dir_all(&models).expect("mkdir");
    std::fs::write(models.join("weights.gguf"), PLAN_BODY).expect("weights");
    std::fs::write(models.join("mtp.gguf"), DRAFTER_BODY).expect("drafter");
    let (url, requests) = serve(PLAN_BODY, "weights.gguf");
    let (drafter_url, drafter_requests) = serve(DRAFTER_BODY, "mtp.gguf");
    let plan = DownloadPlan {
        url,
        bytes: PLAN_BODY.len() as u64,
        sha256: PLAN_SHA256,
        drafter: Some(DownloadFile {
            url: drafter_url,
            bytes: DRAFTER_BODY.len() as u64,
            sha256: DRAFTER_SHA256,
        }),
    };
    let mut readings = 0u32;
    let placed = place_model(&plan, &root, true, &mut |_| readings += 1)
        .expect("both files answer from disk");
    assert_eq!(readings, 0, "a fully proven plan says nothing at all");
    assert!(placed.drafter.is_some());
    assert_eq!(requests_of(&requests), 0);
    assert_eq!(requests_of(&drafter_requests), 0);
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn the_plan_reports_one_total_for_both_files() {
    // One number for the whole plan: every reading the page sees carries
    // the weights-plus-drafter total, starting at the zero-fire and closing
    // at the full plan.
    let (url, _requests) = serve(PLAN_BODY, "weights.gguf");
    let (drafter_url, _drafter_requests) = serve(DRAFTER_BODY, "mtp-weights.gguf");
    let root = scratch("one-total");
    let plan = DownloadPlan {
        url,
        bytes: PLAN_BODY.len() as u64,
        sha256: PLAN_SHA256,
        drafter: Some(DownloadFile {
            url: drafter_url,
            bytes: DRAFTER_BODY.len() as u64,
            sha256: DRAFTER_SHA256,
        }),
    };
    let mut seen: Vec<(u64, u64)> = Vec::new();
    place_model(&plan, &root, true, &mut |step| {
        if let Progress::ModelBytes { done, total } = step {
            seen.push((done, total));
        }
    })
    .expect("both files place");
    let total = (PLAN_BODY.len() + DRAFTER_BODY.len()) as u64;
    assert_eq!(seen.first(), Some(&(0, total)), "the zero-fire opens it");
    assert!(
        seen.iter().all(|(_, reported)| *reported == total),
        "every reading carries the one total: {seen:?}"
    );
    assert_eq!(seen.last(), Some(&(total, total)), "{seen:?}");
    let _ = std::fs::remove_dir_all(&root);
}
