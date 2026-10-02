//! The line of accepted connections waiting for a worker: bounded in size, and
//! — because an answer can hold a worker for half an hour — in waiting time.
//! The accept loop sweeps it, so a client that has waited too long is answered
//! "busy" at the bound instead of when a worker finally frees.

use std::collections::VecDeque;
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

pub(super) struct Queue<T> {
    items: Mutex<VecDeque<(Instant, T)>>,
    ready: Condvar,
    capacity: usize,
}

impl<T> Queue<T> {
    pub(super) fn new(capacity: usize) -> Self {
        Self {
            items: Mutex::new(VecDeque::new()),
            ready: Condvar::new(),
            capacity,
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, VecDeque<(Instant, T)>> {
        self.items.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Joins the line, or comes back when the line is full.
    pub(super) fn push(&self, item: T) -> Result<(), T> {
        let mut items = self.lock();
        if items.len() >= self.capacity {
            return Err(item);
        }
        items.push_back((Instant::now(), item));
        drop(items);
        self.ready.notify_one();
        Ok(())
    }

    /// The oldest waiting item, waiting up to `wait` for one to arrive.
    pub(super) fn pop(&self, wait: Duration) -> Option<T> {
        let mut items = self.lock();
        if items.is_empty() {
            items = self
                .ready
                .wait_timeout(items, wait)
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .0;
        }
        items.pop_front().map(|(_, item)| item)
    }

    /// Takes out, oldest first, everything that has waited `bound` or longer.
    pub(super) fn expired(&self, bound: Duration) -> Vec<T> {
        let mut items = self.lock();
        let mut out = Vec::new();
        while items.front().is_some_and(|(since, _)| since.elapsed() >= bound) {
            if let Some((_, item)) = items.pop_front() {
                out.push(item);
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_line_is_bounded_and_first_in_first_out() {
        let queue = Queue::new(2);
        assert!(queue.push(1).is_ok() && queue.push(2).is_ok());
        assert_eq!(queue.push(3), Err(3), "a full line sends the newcomer back");
        assert_eq!(queue.pop(Duration::ZERO), Some(1));
        assert_eq!(queue.pop(Duration::ZERO), Some(2));
        assert_eq!(queue.pop(Duration::from_millis(5)), None);
    }

    #[test]
    fn only_those_who_waited_too_long_come_out() {
        let queue = Queue::new(4);
        queue.push("old").unwrap();
        std::thread::sleep(Duration::from_millis(60));
        queue.push("new").unwrap();
        assert_eq!(queue.expired(Duration::from_millis(40)), vec!["old"]);
        assert_eq!(queue.pop(Duration::ZERO), Some("new"));
    }
}
