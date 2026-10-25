//! The importance signals scored against the lab's ground truth. The numbers are
//! printed, not asserted: the patterns were written before this table existed, and
//! they must not be tuned to it. Run with `--nocapture` to see the table.

mod common;

use std::collections::HashMap;

use common::{fixtures, senders, truth};
use kalsa_mail::label::signals::{signals, Around, Signal};

/// The lab mailbox is addressed to this address; every mail's To header carries it.
const ACCOUNT: &str = "mariarossi@example.it";

const ALL: [Signal; 4] = [Signal::KnownSender, Signal::Direct, Signal::AsksReply, Signal::Deadline];

#[derive(Default)]
struct Count {
    true_positive: usize,
    false_positive: usize,
    false_negative: usize,
}

fn ratio(part: usize, whole: usize) -> String {
    if whole == 0 {
        "-".to_owned()
    } else {
        format!("{:.2}", part as f64 / whole as f64)
    }
}

#[test]
fn the_importance_signals_against_the_lab_truth() {
    let truth = truth();
    let fixtures = fixtures();
    assert_eq!(fixtures.len(), 48, "the lab mailbox is 48 mails");
    let history = senders(&fixtures);
    let reference_ms = fixtures.iter().map(|fixture| fixture.mail.date_ms).max().unwrap_or(0);
    let around = Around { history: &history, account: Some(ACCOUNT), reference_ms };
    let important: HashMap<&str, bool> = truth.labels.iter().map(|entry| (entry.fixture_id.as_str(), entry.important)).collect();

    let mut counts: Vec<Count> = ALL.iter().map(|_| Count::default()).collect();
    for fixture in &fixtures {
        let is_important = important[fixture.id.as_str()];
        let found = signals(fixture.uid, &fixture.mail, &around);
        for (count, signal) in counts.iter_mut().zip(ALL) {
            match (found.contains(&signal), is_important) {
                (true, true) => count.true_positive += 1,
                (true, false) => count.false_positive += 1,
                (false, true) => count.false_negative += 1,
                (false, false) => {}
            }
        }
    }

    let total_important = truth.labels.iter().filter(|entry| entry.important).count();
    println!("mails: {} (important in truth: {total_important})", fixtures.len());
    println!("{:<12} {:>4} {:>4} {:>4} {:>10} {:>8}", "signal", "tp", "fp", "fn", "precision", "recall");
    for (signal, count) in ALL.iter().zip(&counts) {
        let fired = count.true_positive + count.false_positive;
        println!(
            "{:<12} {:>4} {:>4} {:>4} {:>10} {:>8}",
            signal.code(),
            count.true_positive,
            count.false_positive,
            count.false_negative,
            ratio(count.true_positive, fired),
            ratio(count.true_positive, count.true_positive + count.false_negative),
        );
    }
}
