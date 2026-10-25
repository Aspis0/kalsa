//! The two axes, as two types.
//!
//! Total weights decide whether a model **fits**; active weights decide how fast
//! a token comes out. On a mixture of experts they differ by up to ten, and
//! swapping them produces a confident, wrong recommendation — so they are not
//! the same number and are not interchangeable. The compiler enforces it.

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct TotalParameters(u64);

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct ActiveParameters(u64);

impl TotalParameters {
    pub const fn count(self) -> u64 {
        self.0
    }
}

impl ActiveParameters {
    pub const fn count(self) -> u64 {
        self.0
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Parameters {
    total: TotalParameters,
    active: ActiveParameters,
}

impl Parameters {
    /// Every weight is read for every token.
    pub const fn dense(count: u64) -> Self {
        Self {
            total: TotalParameters(count),
            active: ActiveParameters(count),
        }
    }

    /// Only the routed experts are read for each token.
    pub const fn mixture(total: u64, active: u64) -> Self {
        // A bad row fails the build, not the user: this is a const fn.
        assert!(
            active > 0 && active <= total,
            "mixture: active must be 1..=total"
        );
        Self {
            total: TotalParameters(total),
            active: ActiveParameters(active),
        }
    }

    pub const fn total(&self) -> TotalParameters {
        self.total
    }

    pub const fn active(&self) -> ActiveParameters {
        self.active
    }

    pub const fn is_mixture(&self) -> bool {
        self.active.count() != self.total.count()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_dense_model_reads_all_of_itself() {
        let dense = Parameters::dense(8_000_000_000);
        assert_eq!(dense.total().count(), 8_000_000_000);
        assert_eq!(dense.active().count(), 8_000_000_000);
        assert!(!dense.is_mixture());
    }

    #[test]
    fn a_mixture_keeps_the_two_numbers_apart() {
        let moe = Parameters::mixture(35_000_000_000, 3_000_000_000);
        assert_eq!(moe.total().count(), 35_000_000_000);
        assert_eq!(moe.active().count(), 3_000_000_000);
        assert!(moe.is_mixture());
    }

    #[test]
    #[should_panic(expected = "active")]
    fn active_cannot_exceed_total() {
        Parameters::mixture(3_000_000_000, 35_000_000_000);
    }
}
