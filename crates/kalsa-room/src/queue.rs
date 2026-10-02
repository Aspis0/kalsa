//! The room's call queue: who has called the AI, whose turn is running,
//! and who is next — HOUSEHOLD-RULES §5.2–5.3 as state, with the owner's
//! decision on order: ARRIVAL ORDER WINS. Calls are served first-come,
//! first-served by the door's own monotonic arrival stamp; "When two arrive in
//! the same instant, the tie-break is whoever was served least recently.
//! Not the device id — that is a permanent rank… Not the phone's clock
//! either: household phones disagree by seconds and the value arrives
//! from the client. The stamp is the door's own monotonic clock, taken on
//! arrival." Recency never reorders calls with different stamps — it only
//! breaks an exact tie.
//!
//! Exactly one turn runs at a time, always. Each member may hold at most
//! one pending call; a second is refused, not silently accepted.
//!
//! The queue is memory and nothing else: it does not survive a restart,
//! and a restart therefore clears every pending call with nothing owed —
//! the calls were spoken to a computer that no longer exists.

use crate::events::AiEvent;
use crate::{MemberId, Room};
use std::time::Instant;

/// Why a call was not taken.
#[derive(Debug, PartialEq, Eq)]
pub enum CallRefused {
    /// The member already has one call waiting or running — the honest
    /// refusal §5.3 owes them.
    AlreadyPending,
}

/// What the room did with a call.
#[derive(Debug, PartialEq, Eq)]
pub enum CallTaken {
    /// The call entered the queue behind others.
    Queued,
    /// No turn was running and the queue was empty: this call's turn
    /// begins now, under the given id.
    Starts(u64),
}

/// What a withdrawal took.
#[derive(Debug, PartialEq, Eq)]
pub enum Withdrawn {
    /// There was nothing of this member's to withdraw.
    Nothing,
    /// A pending call came out of the queue.
    Pending,
    /// The member's own running turn was stopped; its id names the turn
    /// the driver must abandon.
    Running(u64),
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Phase {
    Thinking,
    Answering,
}

/// The queue a whole room shares. Guarded by the room's state lock; every
/// change the room publishes an [`AiEvent::Status`] for.
pub(crate) struct Queue {
    /// The running turn: who called, its id, and how far it has come.
    running: Option<Running>,
    /// Calls waiting, in arrival order.
    pending: Vec<(Instant, MemberId, String)>,
    /// Who has been served, oldest first — the least recently served is
    /// the front. Never-served members are the least recent of all.
    served: Vec<MemberId>,
    next_turn: u64,
}

struct Running {
    member: MemberId,
    turn: u64,
    phase: Phase,
    /// The `client_msg_id` the running turn was called with, so a retry of
    /// that same call is recognized while its turn is being served.
    origin: String,
}

/// The queue as the door frames it: ids only, names are the door's to
/// resolve, and the words of the state are shared with the protocol.
pub struct TurnState {
    /// The word for the queue as it stands: thinking, answering, queued,
    /// idle. A transition's own word arrives on its event and is used for
    /// that one frame instead.
    pub state: &'static str,
    pub running: Option<MemberId>,
    pub pending: Vec<MemberId>,
}

impl Queue {
    pub(crate) fn new() -> Self {
        Self {
            running: None,
            pending: Vec::new(),
            served: Vec::new(),
            next_turn: 1,
        }
    }

    fn holds_call_of(&self, member: MemberId) -> bool {
        self.pending.iter().any(|(_, who, _)| *who == member)
            || self
                .running
                .as_ref()
                .is_some_and(|turn| turn.member == member)
    }

    /// Takes a call. A retry of the same `client_msg_id` — held or being
    /// served — is idempotent: the call is already the room's, and saying
    /// so again is the answer, not a refusal.
    fn submit_at(
        &mut self,
        member: MemberId,
        client_msg_id: &str,
        arrival: Instant,
    ) -> Result<CallTaken, CallRefused> {
        let held = self
            .pending
            .iter()
            .any(|(_, who, id)| *who == member && id == client_msg_id)
            || self
                .running
                .as_ref()
                .is_some_and(|turn| turn.member == member && turn.origin == client_msg_id);
        if held {
            return Ok(CallTaken::Queued);
        }
        if self.holds_call_of(member) {
            return Err(CallRefused::AlreadyPending);
        }
        if self.running.is_some() || !self.pending.is_empty() {
            self.pending
                .push((arrival, member, client_msg_id.to_string()));
            return Ok(CallTaken::Queued);
        }
        let turn = self.next_turn;
        self.next_turn += 1;
        self.running = Some(Running {
            member,
            turn,
            phase: Phase::Thinking,
            origin: client_msg_id.to_string(),
        });
        Ok(CallTaken::Starts(turn))
    }

    /// The driver's tick at a turn's end: `member`'s serve is recorded,
    /// their turn is cleared if it is still the running one, and the next
    /// waiting call is picked by least-recently-served. The bool says the
    /// queue EMPTIED — the room publishes its own idle frame then, because
    /// every watcher's `running` is derived from the state at frame time
    /// and a turn that ended in silence would leave the last frame carrying
    /// it as still running, the Room's answering line and Stop button with
    /// it. One driver thread owns succession — a withdrawal or the owner's
    /// stop clears the running turn and publishes, and THIS call is what
    /// starts whatever waits, so a stopped turn's successor is never
    /// started twice.
    pub(crate) fn end_turn(&mut self, member: MemberId) -> (Option<(MemberId, u64)>, bool) {
        self.served.retain(|who| *who != member);
        self.served.push(member);
        if self
            .running
            .as_ref()
            .is_some_and(|running| running.member == member)
        {
            self.running = None;
        }
        if self.running.is_some() {
            return (None, false);
        }
        let next = self.pick_next();
        (next, next.is_none())
    }

    /// Arrival stamp wins; recency only breaks an exact tie.
    fn pick_next(&mut self) -> Option<(MemberId, u64)> {
        if self.pending.is_empty() {
            return None;
        }
        let pick = self
            .pending
            .iter()
            .enumerate()
            .min_by_key(|(_, (arrival, who, _))| {
                let recency = self
                    .served
                    .iter()
                    .position(|served| *served == *who)
                    .map_or(0, |position| position + 1);
                (*arrival, recency)
            })
            .map(|(index, _)| index)
            .expect("the queue is not empty");
        let (_, member, origin) = self.pending.remove(pick);
        let turn = self.next_turn;
        self.next_turn += 1;
        self.running = Some(Running {
            member,
            turn,
            phase: Phase::Thinking,
            origin,
        });
        Some((member, turn))
    }

    /// Withdraws what is the member's own: a pending call, or the turn it
    /// started if it is running (§5.5 — "You may withdraw your own pending
    /// prompt, and you may stop an answer being generated for you"). A
    /// withdrawn running turn is cleared without picking a successor — the
    /// driver's `end_turn` does that when it notices.
    pub(crate) fn withdraw(&mut self, member: MemberId) -> Withdrawn {
        if let Some(index) = self.pending.iter().position(|(_, who, _)| *who == member) {
            self.pending.remove(index);
            return Withdrawn::Pending;
        }
        // Checked before taken: a member withdrawing nothing must leave
        // the running turn exactly where it is.
        if !self
            .running
            .as_ref()
            .is_some_and(|running| running.member == member)
        {
            return Withdrawn::Nothing;
        }
        let running = self.running.take().expect("checked just above");
        self.served.retain(|who| *who != member);
        self.served.push(member);
        Withdrawn::Running(running.turn)
    }

    /// The owner's stop (§5.5 — "the machine's owner can always stop the
    /// machine"): the running turn ends, whoever called it. No successor
    /// is picked here — the driver's `end_turn` starts what waits.
    pub(crate) fn host_stop(&mut self) -> Option<u64> {
        let stopped = self.running.take()?;
        self.served.retain(|who| *who != stopped.member);
        self.served.push(stopped.member);
        Some(stopped.turn)
    }

    /// The driver's phase marks, so a status framed later tells the truth
    /// about a turn that has begun reading or begun writing.
    pub(crate) fn mark(&mut self, turn: u64, phase: Phase) {
        if let Some(running) = self.running.as_mut() {
            if running.turn == turn {
                running.phase = phase;
            }
        }
    }

    /// Whether the named turn is still the one running — the driver's
    /// liveness check between engine reads.
    pub(crate) fn turn_alive(&self, turn: u64) -> bool {
        self.running
            .as_ref()
            .is_some_and(|running| running.turn == turn)
    }

    pub(crate) fn state(&self) -> TurnState {
        match &self.running {
            Some(running) => TurnState {
                state: match running.phase {
                    Phase::Thinking => "thinking",
                    Phase::Answering => "answering",
                },
                running: Some(running.member),
                pending: self.pending.iter().map(|(_, who, _)| *who).collect(),
            },
            None if !self.pending.is_empty() => TurnState {
                state: "queued",
                running: None,
                pending: self.pending.iter().map(|(_, who, _)| *who).collect(),
            },
            None => TurnState {
                state: "idle",
                running: None,
                pending: Vec::new(),
            },
        }
    }
}

impl Room {
    /// Takes a call for the AI guest and publishes the status the change
    /// owes everyone. The caller keeps the message it rode on either way.
    pub fn submit_call(
        &self,
        member: MemberId,
        client_msg_id: &str,
    ) -> Result<CallTaken, CallRefused> {
        self.submit_call_at(member, client_msg_id, Instant::now())
    }

    /// Takes a call using the door's monotonic stamp from when its request
    /// reached the room route, before the body is read or the message saved.
    pub fn submit_call_at(
        &self,
        member: MemberId,
        client_msg_id: &str,
        arrival: Instant,
    ) -> Result<CallTaken, CallRefused> {
        let (taken, waiting) = {
            let mut state = self.lock_state();
            let taken = state.queue.submit_at(member, client_msg_id, arrival);
            let waiting = taken == Ok(CallTaken::Queued)
                && state.queue.pending.iter().any(|(_, who, _)| *who == member);
            (taken, waiting)
        };
        // The word matches what just became true: a queued call queued; a
        // turn that starts at once is announced by its driver, whose
        // thinking frame is the running state.
        if waiting {
            self.publish_ai(AiEvent::Status {
                state: "queued",
                note_code: None,
                note: None,
            });
        }
        taken
    }

    /// The driver's end of a turn: the member is served, the next waiting
    /// call comes back for the same driver to run, and a queue left empty
    /// says so on the room's own news (see [`Queue::end_turn`]).
    pub fn end_turn(&self, member: MemberId) -> Option<(MemberId, u64)> {
        let (next, emptied) = {
            let mut state = self.lock_state();
            state.queue.end_turn(member)
        };
        if emptied {
            self.publish_ai(AiEvent::Status {
                state: "idle",
                note_code: None,
                note: None,
            });
        }
        next
    }

    /// Withdraws the member's own call — pending or running — publishing
    /// the cancelled status either way.
    pub fn withdraw_call(&self, member: MemberId) -> Withdrawn {
        let withdrawn = {
            let mut state = self.lock_state();
            state.queue.withdraw(member)
        };
        if withdrawn != Withdrawn::Nothing {
            self.publish_ai(AiEvent::Status {
                state: "cancelled",
                note_code: None,
                note: None,
            });
        }
        withdrawn
    }

    /// The owner's stop of the running turn. The driver that was serving
    /// it notices, and starts whatever waits. `false` — nothing was
    /// running — changes nothing and publishes nothing: there was no
    /// state to tell the room about.
    pub fn host_stop_turn(&self) -> bool {
        let stopped = {
            let mut state = self.lock_state();
            state.queue.host_stop().is_some()
        };
        if stopped {
            self.publish_ai(AiEvent::Status {
                state: "stopped",
                note_code: None,
                note: None,
            });
        }
        stopped
    }

    /// The driver's marks and checks.
    pub fn mark_turn(&self, turn: u64, answering: bool) {
        {
            let mut state = self.lock_state();
            state.queue.mark(
                turn,
                if answering {
                    Phase::Answering
                } else {
                    Phase::Thinking
                },
            );
        }
        self.publish_ai(AiEvent::Status {
            state: if answering { "answering" } else { "thinking" },
            note_code: None,
            note: None,
        });
    }

    pub fn turn_alive(&self, turn: u64) -> bool {
        self.lock_state().queue.turn_alive(turn)
    }

    /// The turn queue as ids, for the door to frame with names.
    pub fn turn_state(&self) -> TurnState {
        self.lock_state().queue.state()
    }
}

#[cfg(test)]
mod order_tests {
    use super::{CallTaken, Queue};
    use crate::MemberId;
    use std::time::{Duration, Instant};

    #[test]
    fn recency_breaks_only_calls_with_the_same_arrival_stamp() {
        let a = MemberId::Member(1);
        let b = MemberId::Member(2);
        let c = MemberId::Member(3);
        let start = Instant::now();
        let mut queue = Queue::new();

        assert_eq!(queue.submit_at(a, "a1", start), Ok(CallTaken::Starts(1)));
        assert_eq!(queue.end_turn(a), (None, true));
        assert_eq!(
            queue.submit_at(b, "b1", start + Duration::from_secs(1)),
            Ok(CallTaken::Starts(2))
        );
        assert_eq!(queue.end_turn(b), (None, true));
        assert_eq!(
            queue.submit_at(c, "c1", start + Duration::from_secs(2)),
            Ok(CallTaken::Starts(3))
        );
        let tie = start + Duration::from_secs(3);
        assert_eq!(queue.submit_at(a, "a2", tie), Ok(CallTaken::Queued));
        assert_eq!(queue.submit_at(b, "b2", tie), Ok(CallTaken::Queued));
        assert_eq!(queue.end_turn(c), (Some((a, 4)), false));
    }
}
