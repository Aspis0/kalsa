//! A short series of measurements of the same thing.
//!
//! The spread is part of the result, not a detail: a metric that swings between
//! repetitions is not a baseline, and whoever reads the numbers has to see that
//! instead of trusting a mean that hides it.

#[derive(Clone, Debug)]
pub struct Series {
    samples: Vec<f64>,
}

impl Series {
    pub fn new(samples: Vec<f64>) -> Self {
        Self { samples }
    }

    pub fn samples(&self) -> &[f64] {
        &self.samples
    }

    pub fn mean(&self) -> f64 {
        if self.samples.is_empty() {
            return 0.0;
        }
        self.samples.iter().sum::<f64>() / self.samples.len() as f64
    }

    /// The best repetition: **the estimator for a capability measurement**.
    /// Competition can only make a sample slower, never faster, so the fastest
    /// one is the closest we get to what the machine can do; the median would
    /// instead answer "how was the machine's afternoon".
    pub fn max(&self) -> f64 {
        self.samples.iter().copied().fold(0.0, f64::max)
    }

    /// The typical sample. Reported next to the mean because on a busy machine
    /// one descheduled repetition drags the mean down and hides what the
    /// hardware actually does.
    pub fn median(&self) -> f64 {
        if self.samples.is_empty() {
            return 0.0;
        }
        let mut sorted = self.samples.clone();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let middle = sorted.len() / 2;
        if sorted.len().is_multiple_of(2) {
            (sorted[middle - 1] + sorted[middle]) / 2.0
        } else {
            sorted[middle]
        }
    }

    pub fn min(&self) -> f64 {
        self.samples.iter().copied().fold(f64::INFINITY, f64::min)
    }

    /// Population standard deviation, in the same unit as the samples.
    pub fn std_dev(&self) -> f64 {
        if self.samples.len() < 2 {
            return 0.0;
        }
        let mean = self.mean();
        let variance = self
            .samples
            .iter()
            .map(|sample| (sample - mean).powi(2))
            .sum::<f64>()
            / self.samples.len() as f64;
        variance.sqrt()
    }

    /// Standard deviation over the mean: the number that decides whether this is
    /// a baseline (a few percent) or a coin toss (tens of percent).
    pub fn relative_spread(&self) -> f64 {
        let mean = self.mean();
        if mean == 0.0 {
            return 0.0;
        }
        self.std_dev() / mean
    }
}

#[cfg(test)]
mod tests {
    use super::Series;

    #[test]
    fn mean_and_spread_of_a_flat_series() {
        let series = Series::new(vec![10.0, 10.0, 10.0]);
        assert_eq!(series.mean(), 10.0);
        assert_eq!(series.std_dev(), 0.0);
        assert_eq!(series.relative_spread(), 0.0);
        assert_eq!((series.min(), series.max()), (10.0, 10.0));
    }

    #[test]
    fn spread_is_in_the_unit_of_the_samples() {
        let series = Series::new(vec![9.0, 11.0]);
        assert_eq!(series.mean(), 10.0);
        assert!((series.std_dev() - 1.0).abs() < 1e-9);
        assert!((series.relative_spread() - 0.1).abs() < 1e-9);
    }

    #[test]
    fn the_median_ignores_one_bad_sample() {
        let series = Series::new(vec![10.0, 10.0, 10.0, 1.0]);
        assert_eq!(series.median(), 10.0);
        assert!(series.mean() < series.median());
    }

    #[test]
    fn an_empty_series_answers_zero_instead_of_nan() {
        let series = Series::new(vec![]);
        assert_eq!(series.mean(), 0.0);
        assert_eq!(series.std_dev(), 0.0);
        assert_eq!(series.max(), 0.0);
        assert_eq!(series.median(), 0.0);
    }
}
