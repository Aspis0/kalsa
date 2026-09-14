//! Releasing the model: idle is the normal state.
//!
//! The server does nothing almost all the time — the model loads on demand
//! when a turn arrives and is released after inactivity. The only rung below
//! doing less work per unit time is doing none at all, and a machine that is
//! idle is a machine that is not being destroyed. How long is inactivity is a
//! policy decision, and it is made here, once, with the reasoning next to it.

/// Seconds of idle after which the loaded model is released.
///
/// Ten minutes, on purpose. Shorter would fight the conversation's own
/// rhythm: a turn's answer is read and a reply composed over one to five
/// minutes, and reloading is a burst of work — gigabytes paged back through
/// disk and RAM, fans up, a latency wall in front of the next message.
/// Unloading after every pause would spend the thermal budget to save it.
/// Longer wastes it: an old machine holding gigabytes of model nobody will
/// ask about tonight cannot idle as deeply as it should — RAM stays claimed,
/// the package never reaches its rest states. Ten minutes comfortably spans
/// reading, thinking and typing a reply, and past it the conversation has
/// almost certainly ended. The next turn simply loads again, on demand, and
/// the reload burst lands on a machine that has had ten minutes to cool.
pub const UNLOAD_AFTER_SECONDS: f64 = 600.0;

/// Whether the model has idled past its release time. `now` comes from the
/// caller, like every other clock reading in this crate.
pub(crate) fn unload_due(last_activity: f64, now: f64) -> bool {
    now - last_activity >= UNLOAD_AFTER_SECONDS
}

#[cfg(test)]
mod tests {
    use super::unload_due;

    #[test]
    fn a_reading_break_does_not_release_the_model() {
        assert!(!unload_due(1000.0, 1599.0));
    }

    #[test]
    fn the_budget_itself_is_enough() {
        assert!(unload_due(1000.0, 1600.0));
    }
}
