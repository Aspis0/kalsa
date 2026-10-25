//! The line of accepted connections waiting for a worker: bounded in size, and
//! — because an answer can hold a worker for half an hour — in waiting time.
//! The sweeper waits on this queue itself (`server::sweeper`), so a client
//! that has waited too long is answered "busy" at the bound even while every
//! worker is busy, and no thread polls the line to notice.

use std::collections::VecDeque;
use std::sync::{Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

pub(super) struct Queue<T> {
    line: Mutex<Line<T>>,
    ready: Condvar,
}

struct Line<T> {
    items: VecDeque<(Instant, T)>,
    capacity: usize,
    /// Set under this lock when the door stops, and the first thing every
    /// waiter re-checks after waking: a waiter can see a closed line and a
    /// later `close` can never be missed, because both take this lock.
    closed: bool,
}

impl<T> Queue<T> {
    pub(super) fn new(capacity: usize) -> Self {
        Self {
            line: Mutex::new(Line {
                items: VecDeque::new(),
                capacity,
                closed: false,
            }),
            ready: Condvar::new(),
        }
    }

    fn lock(&self) -> MutexGuard<'_, Line<T>> {
        self.line
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Joins the line, or comes back when the line is full. A closed line
    /// takes nobody: the door is stopping.
    pub(super) fn push(&self, item: T) -> Result<(), T> {
        let mut line = self.lock();
        if line.closed || line.items.len() >= line.capacity {
            return Err(item);
        }
        line.items.push_back((Instant::now(), item));
        drop(line);
        // Everyone waiting is woken, not one: the sweeper waits here too, and
        // waking it instead of a worker would leave the item unserved until
        // its bound. Four workers and one sweeper wake per push at most.
        self.ready.notify_all();
        Ok(())
    }

    /// The oldest waiting item, however long the wait takes. `None` is the
    /// door stopping: [`close`](Self::close) is the only thing that ends a
    /// worker's wait.
    pub(super) fn pop(&self) -> Option<T> {
        let mut line = self.lock();
        loop {
            if let Some((_, item)) = line.items.pop_front() {
                return Some(item);
            }
            if line.closed {
                return None;
            }
            line = self.wait(line);
        }
    }

    /// Waits on the line until the item at its head has waited `bound`, then
    /// takes out everything that has, oldest first. `None` when the door stops
    /// first: a stopping door's queued clients are left to the close, not
    /// answered busy.
    pub(super) fn take_expired(&self, bound: Duration) -> Option<Vec<T>> {
        let mut line = self.lock();
        loop {
            if line.closed {
                return None;
            }
            let Some((since, _)) = line.items.front() else {
                line = self.wait(line);
                continue;
            };
            let waited = since.elapsed();
            if waited < bound {
                line = self.wait_timeout(line, bound - waited);
                continue;
            }
            let mut out = Vec::new();
            while line
                .items
                .front()
                .is_some_and(|(since, _)| since.elapsed() >= bound)
            {
                if let Some((_, item)) = line.items.pop_front() {
                    out.push(item);
                }
            }
            return Some(out);
        }
    }

    /// Ends every wait on this line. The door calls it on its way down, and
    /// only after its stop flag is set: an item already on the line is left
    /// for its worker, which drops it against that same flag.
    pub(super) fn close(&self) {
        let mut line = self.lock();
        line.closed = true;
        // Notified under the lock: a waiter that saw `closed == false` and has
        // not slept yet still wakes here.
        self.ready.notify_all();
    }

    fn wait<'a>(&self, line: MutexGuard<'a, Line<T>>) -> MutexGuard<'a, Line<T>> {
        self.ready
            .wait(line)
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn wait_timeout<'a>(
        &self,
        line: MutexGuard<'a, Line<T>>,
        wait: Duration,
    ) -> MutexGuard<'a, Line<T>> {
        self.ready
            .wait_timeout(line, wait)
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn the_line_is_bounded_and_first_in_first_out() {
        let queue = Queue::new(2);
        assert!(queue.push(1).is_ok() && queue.push(2).is_ok());
        assert_eq!(queue.push(3), Err(3), "a full line sends the newcomer back");
        assert_eq!(queue.pop(), Some(1));
        assert_eq!(queue.pop(), Some(2));
        queue.close();
        assert_eq!(queue.pop(), None, "a closed line is the door stopping");
    }

    #[test]
    fn only_those_who_waited_too_long_come_out() {
        let queue = Queue::new(4);
        queue.push("old").unwrap();
        std::thread::sleep(Duration::from_millis(60));
        queue.push("new").unwrap();
        assert_eq!(queue.take_expired(Duration::from_millis(40)), Some(vec!["old"]));
        assert_eq!(queue.pop(), Some("new"));
    }

    /// The bound is kept with nothing pushing after the item went in: the
    /// sweep sleeps on the line's own clock and comes back at the bound, not
    /// when a worker frees.
    #[test]
    fn an_expiry_wakes_the_sweep_with_no_push_after_it() {
        let queue = Arc::new(Queue::new(4));
        queue.push("old").unwrap();
        let (done, finished) = std::sync::mpsc::channel();
        let sweeping = {
            let queue = Arc::clone(&queue);
            std::thread::spawn(move || {
                let begun = Instant::now();
                let expired = queue.take_expired(Duration::from_millis(300));
                let _ = done.send((expired, begun.elapsed()));
            })
        };
        let (expired, took) = finished
            .recv_timeout(Duration::from_secs(3))
            .expect("the sweep never returned: nothing wakes it at the bound");
        sweeping.join().unwrap();
        assert_eq!(expired, Some(vec!["old"]));
        assert!(
            took >= Duration::from_millis(250) && took < Duration::from_secs(2),
            "the sweep returned at its bound: {took:?}"
        );
    }

    /// `close` is the only thing that ends a wait on an empty line: a stop flag
    /// alone would leave every worker asleep for good.
    #[test]
    fn a_close_ends_a_waiting_pop() {
        let queue: Arc<Queue<u8>> = Arc::new(Queue::new(1));
        let (done, finished) = std::sync::mpsc::channel();
        let waiting = {
            let queue = Arc::clone(&queue);
            std::thread::spawn(move || {
                let _ = done.send(queue.pop());
            })
        };
        std::thread::sleep(Duration::from_millis(30));
        queue.close();
        assert_eq!(
            finished.recv_timeout(Duration::from_secs(1)).ok(),
            Some(None),
            "a closed line wakes its waiters with nothing"
        );
        waiting.join().unwrap();
    }
}
