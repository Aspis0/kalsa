//! The labeller on the lab's own 48 mails, scored against the ground truth it ships.
//! The numbers the plan records come from the JavaScript labeller; this is the port.

mod common;

use common::{fixtures, senders, truth};
use kalsa_mail::label::{self, Label, Reason, Sender};
use std::collections::BTreeMap;

struct Score {
    precision: f64,
    recall: f64,
    true_positive: usize,
    false_positive: Vec<String>,
    false_negative: Vec<String>,
}

fn score(predicted: &BTreeMap<String, bool>, actual: &BTreeMap<String, bool>) -> Score {
    let predicted_ids: Vec<&String> = predicted
        .iter()
        .filter(|(_, set)| **set)
        .map(|(id, _)| id)
        .collect();
    let actual_ids: Vec<&String> = actual
        .iter()
        .filter(|(_, set)| **set)
        .map(|(id, _)| id)
        .collect();
    let true_positive = predicted_ids
        .iter()
        .filter(|id| actual_ids.contains(id))
        .count();
    Score {
        precision: true_positive as f64 / predicted_ids.len().max(1) as f64,
        recall: true_positive as f64 / actual_ids.len().max(1) as f64,
        true_positive,
        false_positive: predicted_ids
            .iter()
            .filter(|id| !actual_ids.contains(id))
            .map(|id| (*id).clone())
            .collect(),
        false_negative: actual_ids
            .iter()
            .filter(|id| !predicted_ids.contains(id))
            .map(|id| (*id).clone())
            .collect(),
    }
}

fn labels_by_mail(
    fixtures: &[common::Fixture],
    history: &[Sender],
    trusted: &str,
) -> BTreeMap<String, label::Labels> {
    fixtures
        .iter()
        .map(|f| {
            (
                f.id.clone(),
                label::label(f.uid, &f.mail, history, Some(trusted)),
            )
        })
        .collect()
}

#[test]
fn the_labeller_reproduces_the_lab_numbers() {
    let truth = truth();
    let fixtures = fixtures();
    let history = senders(&fixtures);
    assert_eq!(fixtures.len(), 48, "the lab mailbox is 48 mails");

    let labels = labels_by_mail(&fixtures, &history, &truth.trusted_auth);
    let flag = |want: &dyn Fn(&label::Labels) -> bool| -> BTreeMap<String, bool> {
        truth
            .labels
            .iter()
            .map(|t| (t.fixture_id.clone(), want(&labels[&t.fixture_id])))
            .collect()
    };
    let suspicious = score(
        &flag(&|l| l.suspicious),
        &truth
            .labels
            .iter()
            .map(|t| (t.fixture_id.clone(), t.suspicious))
            .collect(),
    );
    let bulk = score(
        &flag(&|l| l.bulk),
        &truth
            .labels
            .iter()
            .map(|t| (t.fixture_id.clone(), t.bulk))
            .collect(),
    );

    println!(
        "suspicious: precision={:.3} recall={:.3} tp={} fp={} fn={} fp_ids={:?} fn_ids={:?}",
        suspicious.precision,
        suspicious.recall,
        suspicious.true_positive,
        suspicious.false_positive.len(),
        suspicious.false_negative.len(),
        suspicious.false_positive,
        suspicious.false_negative
    );
    println!(
        "bulk: precision={:.3} recall={:.3} tp={} fp={} fn={} fp_ids={:?} fn_ids={:?}",
        bulk.precision,
        bulk.recall,
        bulk.true_positive,
        bulk.false_positive.len(),
        bulk.false_negative.len(),
        bulk.false_positive,
        bulk.false_negative
    );

    assert!(
        (suspicious.precision - 0.917).abs() < 0.001,
        "suspicious precision drifted to {:.3}, false positives {:?}",
        suspicious.precision,
        suspicious.false_positive
    );
    assert!(
        (suspicious.recall - 0.846).abs() < 0.001,
        "suspicious recall drifted to {:.3}, false negatives {:?}",
        suspicious.recall,
        suspicious.false_negative
    );
    assert!(
        (bulk.precision - 1.000).abs() < 0.001,
        "bulk precision drifted to {:.3}, false positives {:?}",
        bulk.precision,
        bulk.false_positive
    );
    assert!(
        (bulk.recall - 0.926).abs() < 0.001,
        "bulk recall drifted to {:.3}, false negatives {:?}",
        bulk.recall,
        bulk.false_negative
    );
}

#[test]
fn the_phishing_mail_of_the_lab_is_flagged() {
    let truth = truth();
    let fixtures = fixtures();
    let history = senders(&fixtures);
    let phishing = fixtures
        .iter()
        .find(|f| f.id == "adv-phishing")
        .expect("the lab's phishing mail is in the fixtures");
    let labels = label::label(
        phishing.uid,
        &phishing.mail,
        &history,
        Some(&truth.trusted_auth),
    );

    assert_eq!(labels.label, Label::Suspicious);
    assert!(labels.reasons.contains(&Reason::PaymentUrgencyNewSender));
    assert!(labels.reasons.contains(&Reason::HiddenText));
}

/// The two misses the plan records. They are plain text, no rule can see them, and
/// this test is here so that staying a miss is a choice rather than an accident.
#[test]
fn the_two_plain_injections_stay_misses() {
    let truth = truth();
    let fixtures = fixtures();
    let history = senders(&fixtures);
    for id in ["adv2-inj-quoted", "adv2-inj-websearch"] {
        let entry = truth
            .labels
            .iter()
            .find(|t| t.fixture_id == id)
            .expect("the injection is in the ground truth");
        assert!(entry.suspicious, "{id} is a true positive in the lab");
        assert_eq!(entry.reasons, vec!["prompt-injection".to_string()]);

        let mail = fixtures
            .iter()
            .find(|f| f.id == id)
            .unwrap_or_else(|| panic!("{id} is in the fixtures"));
        let uid = mail.uid;
        let labels = label::label(uid, &mail.mail, &history, Some(&truth.trusted_auth));
        assert!(
            !labels.suspicious,
            "{id} is plain text: the fence covers it, not a rule"
        );
    }
}

#[test]
fn the_bulk_pre_filter_never_drops_an_important_mail() {
    let truth = truth();
    let fixtures = fixtures();
    let history = senders(&fixtures);
    let labels = labels_by_mail(&fixtures, &history, &truth.trusted_auth);
    let dropped: Vec<&str> = truth
        .labels
        .iter()
        .filter(|t| t.important)
        .filter(|t| labels[&t.fixture_id].label == Label::Bulk)
        .map(|t| t.fixture_id.as_str())
        .collect();
    assert!(dropped.is_empty(), "would drop {dropped:?}");
}

/// A forwarded mail keeps the original provider's Authentication-Results below ours.
/// Only the topmost one stamped with our own authserv-id may decide anything.
#[test]
fn a_forwarded_mail_trusts_only_the_topmost_header_of_our_own_provider() {
    let truth = truth();
    let fixtures = fixtures();
    let history = senders(&fixtures);
    let forwarded = fixtures
        .iter()
        .find(|f| f.id == "ben-forwarded-dentist")
        .expect("the forwarded mail is in the fixtures");
    let labels = label::label(
        forwarded.uid,
        &forwarded.mail,
        &history,
        Some(&truth.trusted_auth),
    );

    let auth_results: Vec<&String> = forwarded
        .mail
        .headers
        .iter()
        .filter(|(name, _)| name == "authentication-results")
        .map(|(_, value)| value)
        .collect();
    assert_eq!(auth_results.len(), 2, "the fixture carries two of them");
    assert!(auth_results[0].starts_with(&truth.trusted_auth));
    assert!(auth_results[1].contains("dmarc=fail"));
    assert!(
        !labels.suspicious,
        "the failing header is the other provider's: {:?}",
        labels.reasons
    );
}
