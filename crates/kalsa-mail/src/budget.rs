//! How much work one mail may ask for before it is no longer parsed.
//!
//! html5ever rebuilds depth a byte scan cannot see: formatting elements reopened
//! per paragraph, an anchor that is never closed, text pushed out of a table. The
//! cost of a parse grows with the square of the input for those, and the sender
//! picks the input. So the bound is on bytes and on elapsed time, not on a model
//! of what the parser will do.

use std::time::{Duration, Instant};

/// The HTML this server will parse. Measured on this Mac against six generators
/// (`what_a_mail_can_spend`): 16 KB of the worst of them costs 64 ms, 32 KB
/// costs 215 ms and 64 KB costs 879 ms. 16 KB keeps the worst case inside the
/// 100 ms a single mail is worth.
pub(crate) const MAX_HTML_BYTES: usize = 16 * 1024;

/// What one call may spend parsing, across every mail it looks at. A `list` of
/// fifty mails each near the cap would otherwise be seconds of somebody's
/// morning.
pub(crate) const CALL_LIMIT: Duration = Duration::from_secs(2);

/// What a call has spent so far. Charged after each parse, because a parse's
/// cost is only known once it is over.
#[derive(Default)]
pub(crate) struct Budget {
    spent: Duration,
}

impl Budget {
    pub(crate) fn new() -> Budget {
        Budget::default()
    }

    pub(crate) fn charge(&mut self, cost: Duration) {
        self.spent += cost;
    }

    pub(crate) fn exhausted(&self) -> bool {
        self.spent >= CALL_LIMIT
    }
}

/// Whether this mail's HTML is worth parsing at all: not too big, and the call
/// has not already spent its allowance.
pub(crate) fn permits(bytes: usize, budget: &Budget) -> bool {
    bytes <= MAX_HTML_BYTES && !budget.exhausted()
}

/// The clock the budget is measured against. Behind a function so a test can ask
/// what the budget does without waiting two seconds for it.
pub(crate) fn now() -> Instant {
    Instant::now()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The cap is the thing that stops the quadratic parse, so it is checked
    /// against the generators that made it necessary rather than against a
    /// comment.
    #[test]
    fn a_mail_too_big_to_parse_is_not_parsed() {
        let budget = Budget::new();
        assert!(
            permits(MAX_HTML_BYTES, &budget),
            "the cap itself is allowed"
        );
        assert!(!permits(MAX_HTML_BYTES + 1, &budget));
        assert!(!permits(64 * 1024, &budget));
    }

    /// A call that has spent its allowance stops parsing, whatever the size.
    #[test]
    fn a_call_that_has_spent_its_allowance_stops_parsing() {
        let mut budget = Budget::new();
        assert!(permits(1024, &budget));
        budget.charge(CALL_LIMIT);
        assert!(budget.exhausted());
        assert!(
            !permits(1, &budget),
            "a mail of one byte still costs a parse"
        );
    }

    #[test]
    fn a_call_that_has_not_spent_it_carries_on() {
        let mut budget = Budget::new();
        budget.charge(CALL_LIMIT - Duration::from_millis(1));
        assert!(!budget.exhausted());
        assert!(permits(1024, &budget));
    }

    #[test]
    fn the_clock_is_the_one_the_budget_is_charged_against() {
        let mut budget = Budget::new();
        budget.charge(now().elapsed());
        assert!(!budget.exhausted());
    }
}
