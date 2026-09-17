//! One job: an answer being produced, or kept after its end. Its log
//! accumulates numbered events whether or not anybody is attached, hands
//! them out in order without duplicates or holes, and refuses honestly when
//! the answer stopped early.
//!
//! Exactly one thread ever appends to a job: the request that created it,
//! whose token is handed to nobody else. Resuming clients only read, so the
//! index can be minted before the append without a race.

use std::sync::Condvar;
use std::sync::Mutex;
use std::sync::Arc;
use std::time::Instant;

use crate::devices::DeviceId;
use crate::token::Token;
use crate::MAX_JOB_BYTES;

/// How a generation stopped before its last event. The words go to the
/// resuming client verbatim; they must stay truthful and carry no secrets.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Failure {
    Overflow,
    Upstream,
    Shutdown,
}

impl Failure {
    pub(super) fn words(self) -> &'static str {
        match self {
            Self::Overflow => "The answer outgrew the door before it finished.",
            Self::Upstream => "The model server stopped producing this answer.",
            Self::Shutdown => "The door was closed while this answer was being made.",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Status {
    Running,
    Done,
    Failed(Failure),
}

struct Log {
    events: Vec<Arc<[u8]>>,
    bytes: usize,
    status: Status,
    finished_at: Option<Instant>,
}

/// One answer being produced, or kept after its end.
pub(super) struct Job {
    token: Token,
    /// The device that started the answer. An id, not a secret: the
    /// credential that named the device was already checked by the bearer
    /// scan before the job was started, and again before any resume.
    owner: DeviceId,
    /// The response head exactly as the live client received it; a resuming
    /// client gets the same head, so both see one answer, not two.
    head: Vec<u8>,
    log: Mutex<Log>,
    signal: Condvar,
}

pub(super) enum Appended {
    Yes,
    /// The job no longer accepts events. The reason was already recorded in
    /// its status (the roof is one way in); the producer must stop.
    Stopped,
}

/// What a serving loop gets from the log each time it asks.
pub(super) enum Take {
    /// `out` holds new events and `cursor` moved past them.
    Events,
    /// Everything was delivered and the answer ended well.
    Drained,
    /// The answer stopped before the end.
    Failed,
    /// The connection's lifetime ran out while following.
    Deadline,
}

/// The verdict on a `Last-Event-ID`.
pub(super) enum ResumeDecision {
    /// Stream again from the index after the one the client last saw.
    Serve,
    /// The answer cannot be resumed; the sentence goes to the client
    /// verbatim with a 410.
    Refused(&'static str),
}

impl Job {
    pub(super) fn new(token: Token, owner: DeviceId, head: Vec<u8>) -> Self {
        Self {
            token,
            owner,
            head,
            log: Mutex::new(Log {
                events: Vec::new(),
                bytes: 0,
                status: Status::Running,
                finished_at: None,
            }),
            signal: Condvar::new(),
        }
    }

    pub(super) fn token(&self) -> &Token {
        &self.token
    }

    pub(super) fn head(&self) -> &[u8] {
        &self.head
    }

    /// The next index the log will hand out.
    pub(super) fn next_index(&self) -> usize {
        self.lock().events.len()
    }

    pub(super) fn append(&self, event: Arc<[u8]>) -> Appended {
        let mut log = self.lock();
        if log.status != Status::Running {
            return Appended::Stopped;
        }
        if log.bytes + event.len() > MAX_JOB_BYTES {
            log.status = Status::Failed(Failure::Overflow);
            log.finished_at = Some(Instant::now());
            drop(log);
            self.signal.notify_all();
            return Appended::Stopped;
        }
        log.bytes += event.len();
        log.events.push(event);
        drop(log);
        self.signal.notify_all();
        Appended::Yes
    }

    /// Records the end of the answer, whichever comes first. A failure is
    /// never overwritten by a later clean end.
    pub(super) fn close(&self, status: Status) {
        let mut log = self.lock();
        if log.status != Status::Running {
            return;
        }
        log.status = status;
        log.finished_at = Some(Instant::now());
        drop(log);
        self.signal.notify_all();
    }

    /// Blocks until events after `cursor` exist, the answer ends, or the
    /// deadline passes. Called with the current time as deadline, it is the
    /// non-blocking form the producer uses between upstream reads. The
    /// events are handed out by reference-count and served outside the
    /// lock, so a slow client never pins the log.
    pub(super) fn take(
        &self,
        cursor: &mut usize,
        deadline: Instant,
        out: &mut Vec<Arc<[u8]>>,
    ) -> Take {
        let mut log = self.lock();
        loop {
            if *cursor < log.events.len() {
                out.extend(log.events[*cursor..].iter().cloned());
                *cursor = log.events.len();
                return Take::Events;
            }
            match log.status {
                Status::Done => return Take::Drained,
                Status::Failed(_) => return Take::Failed,
                Status::Running => {}
            }
            let Some(wait) = deadline.checked_duration_since(Instant::now()) else {
                return Take::Deadline;
            };
            let (next, timed_out) = self
                .signal
                .wait_timeout(log, wait)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            log = next;
            if timed_out.timed_out() && Instant::now() >= deadline {
                return Take::Deadline;
            }
        }
    }

    /// Whether a client that last saw `seen` may resume this answer, and if
    /// not, the honest sentence it gets instead. The asking device is
    /// compared against the device that started the answer: another
    /// device's credential may be perfectly valid, but this job answers to
    /// the device that created it and nobody else. The log never truncates
    /// while it exists — overflowing fails the job instead — so anything
    /// past the end claims events the door never sent. A failed answer
    /// already fully seen is refused rather than re-served as an empty
    /// stream: an empty 200 promises an end that never comes.
    pub(super) fn resume_decision(&self, seen: usize, owner: DeviceId) -> ResumeDecision {
        let log = self.lock();
        if self.owner != owner {
            // The same words as a lost job: who may not resume it learns
            // nothing about whether it exists.
            return ResumeDecision::Refused("That answer is no longer kept here.");
        }
        if seen > log.events.len() {
            return ResumeDecision::Refused("The door does not hold that part of the answer.");
        }
        if seen == log.events.len() {
            return match log.status {
                Status::Failed(failure) => ResumeDecision::Refused(failure.words()),
                Status::Running | Status::Done => ResumeDecision::Serve,
            };
        }
        ResumeDecision::Serve
    }

    pub(super) fn finished(&self) -> Option<Instant> {
        self.lock().finished_at
    }

    pub(super) fn expired(&self, now: Instant) -> bool {
        match self.finished() {
            Some(at) => now.duration_since(at) > crate::JOB_RETENTION,
            None => false,
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Log> {
        self.log
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Test support: the registry's reaper test needs a kept answer whose
    /// retention ran out, without waiting real minutes for it.
    #[cfg(test)]
    pub(super) fn age_finished_to(&self, at: Instant) {
        self.lock().finished_at = Some(at);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn owner() -> DeviceId {
        DeviceId::new(7)
    }

    fn head() -> Vec<u8> {
        b"HTTP/1.1 200 OK\r\n\r\n".to_vec()
    }

    fn event(text: &str) -> Arc<[u8]> {
        format!("id: x\ndata: {text}\n\n").into_bytes().into()
    }

    #[test]
    fn take_hands_out_events_in_order_and_blocks_for_the_rest() {
        let job = Arc::new(Job::new(Token::mint().unwrap(), owner(), head()));
        job.append(event("one"));
        let mut cursor = 0;
        let mut out = Vec::new();
        assert!(matches!(job.take(&mut cursor, Instant::now(), &mut out), Take::Events));
        assert_eq!(cursor, 1);
        assert_eq!(&*out[0], event("one").as_ref());

        let writer = std::thread::spawn({
            let job = Arc::clone(&job);
            move || {
                std::thread::sleep(Duration::from_millis(30));
                job.append(event("two"));
                job.close(Status::Done);
            }
        });
        let deadline = Instant::now() + Duration::from_secs(2);
        out.clear();
        assert!(matches!(job.take(&mut cursor, deadline, &mut out), Take::Events));
        assert!(matches!(job.take(&mut cursor, deadline, &mut out), Take::Drained));
        assert_eq!(cursor, 2);
        writer.join().unwrap();
    }

    /// One megabyte in absolute bytes: the roof is a number with a
    /// guarantee, so its tests anchor to sizes that do not follow the
    /// constant around.
    const ONE_MIB: usize = 1024 * 1024;

    #[test]
    fn an_overflow_fails_the_job_and_stops_appends() {
        // Two megabytes of roof: one big event fits, a second one does not.
        let job = Job::new(Token::mint().unwrap(), owner(), head());
        assert!(matches!(
            job.append(vec![b'x'; ONE_MIB].into()),
            Appended::Yes
        ));
        let second: Arc<[u8]> = vec![b'x'; ONE_MIB + 1].into();
        assert!(matches!(job.append(second), Appended::Stopped));
        let mut cursor = 0;
        let mut out = Vec::new();
        assert!(matches!(
            job.take(&mut cursor, Instant::now(), &mut out),
            Take::Events
        ));
        assert!(matches!(job.take(&mut cursor, Instant::now(), &mut out), Take::Failed));
        // A clean end arriving after a failure changes nothing.
        job.close(Status::Done);
        assert!(matches!(job.take(&mut cursor, Instant::now(), &mut out), Take::Failed));
    }

    #[test]
    fn a_resume_beyond_the_log_names_events_the_door_never_sent() {
        let job = Job::new(Token::mint().unwrap(), owner(), head());
        job.append(event("one"));
        assert!(matches!(
            job.resume_decision(0, owner()),
            ResumeDecision::Serve
        ));
        assert!(
            matches!(job.resume_decision(1, owner()), ResumeDecision::Serve),
            "running: the client may wait at the end"
        );
        assert!(matches!(
            job.resume_decision(2, owner()),
            ResumeDecision::Refused(_)
        ));
    }

    #[test]
    fn a_fully_seen_failed_answer_is_refused_with_its_reason() {
        // Overflow by absolute size: one megabyte fits, one more does not.
        let job = Job::new(Token::mint().unwrap(), owner(), head());
        job.append(vec![b'x'; ONE_MIB].into());
        job.append(vec![b'x'; ONE_MIB + 1].into());
        let refused = match job.resume_decision(1, owner()) {
            ResumeDecision::Refused(words) => words,
            ResumeDecision::Serve => panic!("a failed answer cannot promise more"),
        };
        assert_eq!(refused, Failure::Overflow.words());
        // A clean end arriving after a failure changes nothing.
        job.close(Status::Done);
        assert_eq!(
            match job.resume_decision(1, owner()) {
                ResumeDecision::Refused(words) => words,
                ResumeDecision::Serve => panic!("a failed answer cannot promise more"),
            },
            Failure::Overflow.words()
        );
    }

    #[test]
    fn a_job_answers_only_to_its_owner() {
        let job = Job::new(Token::mint().unwrap(), owner(), head());
        job.append(event("one"));
        let refused = match job.resume_decision(0, DeviceId::new(8)) {
            ResumeDecision::Refused(words) => words,
            ResumeDecision::Serve => panic!("another owner must not resume the job"),
        };
        assert_eq!(refused, "That answer is no longer kept here.");
        assert!(matches!(
            job.resume_decision(0, owner()),
            ResumeDecision::Serve
        ));
    }
}
