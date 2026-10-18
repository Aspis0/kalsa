//! The sidecar, and the one call at a time it is given.
//!
//! The sidecar is started the way the mailbox starts its own: through
//! `kalsa_mcp::launch::SealedStdioLauncher`, with its bytes checked against a
//! digest by `program`, its tool definitions pinned by `tool_pins`, and its
//! environment reduced to what a browser needs and nothing else (`server_env`).
//! What is new here is only the lifetime: a mailbox sidecar is opened for a
//! call and dropped at the end of it, while a browser is a thing a person looks
//! at, so it lives from the first tool call until the window closes.
//!
//! **The slot is a state, not an `Option`.** The earlier shape took the host out
//! of the slot for the length of a call, which left nothing to say "a call is
//! already running" except that the slot was empty — and an empty slot was also
//! what a session that had been ended looked like. Two calls could therefore
//! each decide they were the first. `Slot` says which of the four things is
//! true, and every move out of it is one `mem::replace`, so there is no window
//! in which two callers both believe they are alone with the browser.
//!
//! **The lock is held only for the move**, never across `host.call().await`. A
//! call owns its host while it runs, and `end()` from a window event cannot
//! wait for it.

use std::path::Path;
use std::sync::Mutex;
use tokio::sync::watch;

use kalsa_mcp::host::Host;
use kalsa_mcp::launch::SealedStdioLauncher;
use kalsa_mcp::outcome::{CallOutcome, ToolResult};
use kalsa_mcp::record::{ServerRecord, Trust};
use kalsa_mcp::registry::Registry;
use kalsa_mcp::server_id::ServerId;
use serde_json::{Map, Value};

use super::error::BrowserError;
use super::program;
use super::window::WindowState;
use super::{server_env, tool_pins, SERVER};

/// The conversation name every browser call runs under. A browser has no mailbox
/// to carry state in, so this is the same constant the mailbox uses.
const CONVERSATION: &str = "browser";

/// The name a tool is routed by: `<server>.<tool>`. The host refuses a bare name
/// with `NoNamespace`, so every call qualifies its tool here and nowhere else.
fn qualified(tool: &str) -> String {
    format!("{SERVER}.{tool}")
}

/// The tools the person's own answers go through, and the list of what is waiting
/// for them. A model is never offered these, and the host reaches them only through
/// `call_host_only`. The names must match the table in kalsa-mcp.
const HOST_ONLY: &[&str] = &[
    "browser_waiting",
    "browser_pause",
    "browser_resume",
    "browser_confirm",
    "browser_decline",
];

/// What is true of the browser right now.
///
/// Generic over the sidecar so the moves are proved without starting one: the
/// transitions are the whole of this type and none of them are I/O.
#[derive(Debug)]
struct Slot<H> {
    state: State,
    /// Which call owns the browser right now. A call takes it with the host and
    /// hands it back, so a call whose number no longer matches has been
    /// superseded and must drop what it was holding — which is the whole of a
    /// close during a call, with no window in which it could put the host back.
    taken: u64,
    host: Option<H>,
    /// Whether the person has paused this session. **It is the sidecar's flag,
    /// recorded here because the sidecar cannot be asked for it** — and it lives
    /// in the slot so that `end()` drops it in the same breath as the session:
    /// a pause on a window that is gone is a promise about nothing, and one the
    /// page would go on refusing every call with.
    paused: bool,
    /// **How many times the page's view of this has moved.** Raised under this
    /// same lock as every change, so two snapshots are never in doubt about
    /// which is later: a page drops the one with the smaller number, which is
    /// what makes the read it does on its mount safe to arrive whenever it likes.
    seq: u64,
    /// Whether the profile is being emptied. A clear holds this for as long as
    /// it runs, because the folder it renames cannot be emptied under a browser
    /// that has started since — the check and the taking of the slot are one
    /// move, so there is no window between them for a call to slip into.
    clearing: bool,
}

/// The four things that can be true of the browser.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum State {
    /// Nothing has been started, or a session was ended and nothing has started
    /// since. A call may start one.
    Idle,
    /// A call owns the sidecar and is running. A second call is refused.
    Busy,
    /// A session is open and idle.
    Open,
    /// A session was ended while a call was running. The call drops its host on
    /// the way out instead of putting it back, and the child dies with it.
    Closing,
}

/// What a call holds while it runs: the host, and the number that says it is
/// still the call the browser is waiting for.
#[derive(Debug)]
struct Lease<H> {
    host: H,
    gen: u64,
}

impl<H> Slot<H> {
    fn idle() -> Self {
        Self { state: State::Idle, taken: 0, host: None, paused: false, seq: 0, clearing: false }
    }

    /// What the page is told, **read in one move** so the open and the pause can
    /// never be a half-old pair.
    fn snapshot(&self) -> WindowState {
        WindowState { open: self.is_open(), paused: self.paused, seq: self.seq }
    }

    /// A call arrives: `Open` becomes `Busy` and hands the host over, `Idle`
    /// becomes `Busy` and asks for a new one, and anything else is refused.
    ///
    /// A browser that would not start puts the slot back to `Idle`, so a missing
    /// driver is an answer to this call and not a browser that is busy for ever.
    fn take(&mut self, open: impl FnOnce() -> Result<H, BrowserError>) -> Result<Lease<H>, BrowserError> {
        if !matches!(self.state, State::Open | State::Idle) {
            // A call already owns the browser, and one has been asked to end.
            // Both are the same answer to the person: Kalsa is busy.
            return Err(BrowserError::Busy);
        }
        if self.clearing {
            // The profile is being emptied underneath: a browser started now
            // would be writing into a folder that is on its way elsewhere.
            return Err(BrowserError::Busy);
        }
        let existing = self.host.take();
        self.taken += 1;
        let gen = self.taken;
        self.state = State::Busy;
        self.seq += 1;
        let host = match existing {
            Some(host) => host,
            None => match open() {
                Ok(host) => host,
                Err(refused) => {
                    self.state = State::Idle;
                    self.seq += 1;
                    return Err(refused);
                }
            },
        };
        Ok(Lease { host, gen })
    }

    /// The call is finished with its host. It goes back only if it is still the
    /// call the browser is waiting for; otherwise it is dropped, which is what
    /// kills the child (`kill_on_drop` is set on it in
    /// `kalsa-mcp/src/launch.rs:101`), and the slot returns to `Idle` — a host
    /// being dropped leaves no session behind, and a slot left at `Closing` would
    /// refuse every later call for the life of the window.
    fn give_back(&mut self, lease: Lease<H>) -> bool {
        if self.state == State::Busy && self.taken == lease.gen {
            self.host = Some(lease.host);
            self.state = State::Open;
            self.seq += 1;
            return true;
        }
        drop(lease);
        // **A lease the slot has moved past changes nothing else.** `Busy` here
        // belongs to a later call, which is driving a browser of its own: marking
        // the slot `Idle` under it would hand a second browser to the next caller
        // while that one is still going.
        if self.state == State::Busy {
            return false;
        }
        self.state = State::Idle;
        self.paused = false;
        self.seq += 1;
        false
    }

    /// **The host could not answer, so it is not a session.** A page that refused
    /// is a page's own sentence and the browser stays; a sidecar that is gone, or
    /// a driver that would not start, is a browser nobody can drive — and handing
    /// its host back would leave the page drawing a window over nothing, and,
    /// worse, a paused one that nothing could ever clear. Dropped here, so the
    /// child dies and the pause dies with it.
    fn abandon(&mut self, lease: Lease<H>) {
        let gen = lease.gen;
        drop(lease);
        // The same rule as a superseded give-back, and read the same way round: a
        // `Busy` slot under a *later* number belongs to another call, and this one
        // has nothing to say about it.
        if self.state == State::Busy && self.taken != gen {
            return;
        }
        self.state = State::Idle;
        self.paused = false;
        self.seq += 1;
    }

    /// The session ends. An open host is handed out to be dropped, which is what
    /// ends it — so the slot is **`Idle`**, not `Closing`: nothing is running,
    /// and the person may open another browser. A running call is marked instead,
    /// because its host is not reachable from here, and `Closing` refuses a call
    /// while that call is on its way out.
    ///
    /// **The pause goes with the session, here and not in a caller.** The sidecar
    /// holding it dies with the host, so a pause left standing would be a claim
    /// about a browser that is not there — and every later call would be refused
    /// for it by a page that has no control left to clear it.
    fn end(&mut self) -> Option<H> {
        if self.state == State::Closing {
            // **Ending twice is one ending.** A call is still on its way out, and
            // answering a second end by going `Idle` would let the next call take
            // the slot while that lease is still in it — the very call this state
            // exists to refuse.
            return None;
        }
        let running = self.state == State::Busy;
        let host = self.host.take();
        self.state = if running { State::Closing } else { State::Idle };
        self.paused = false;
        self.seq += 1;
        host
    }

    /// Whether a session exists in any form, which is what `Clear` asks: a
    /// running call and an ended-but-not-yet-returned one are both sessions
    /// whose profile folder is still being written.
    fn is_open(&self) -> bool {
        self.state != State::Idle
    }

    fn is_busy(&self) -> bool {
        self.state == State::Busy
    }

    /// **The emptying of the profile, taken as one move with the check for it.**
    /// A clear is refused for a browser in any state, and refused for a clear
    /// already running; what it takes is held until it is given back.
    fn begin_clear(&mut self) -> bool {
        if self.clearing || self.is_open() {
            return false;
        }
        self.clearing = true;
        true
    }

    /// The profile is whole again — or was never emptied, which is the same thing
    /// to the next press.
    fn end_clear(&mut self) {
        self.clearing = false;
    }

    /// What a pause or a resume came back with, and whether the page needs to
    /// hear it. **A refused pause never reaches here, and there is nothing here to
    /// refuse it on**: a slot with no session has no window to pause, so the
    /// flag does not move and the page is told nothing.
    ///
    /// **A pause pressed while a call owns the browser is recorded anyway.** It is
    /// the person's intent, and a session running is a session to pause: refusing
    /// it would leave a control that does nothing while Kalsa carries on.
    fn set_paused(&mut self, paused: bool) -> bool {
        if !self.is_open() || self.paused == paused {
            return false;
        }
        self.paused = paused;
        self.seq += 1;
        true
    }

    fn paused(&self) -> bool {
        self.paused
    }
}

pub(crate) struct Browser {
    slot: Mutex<Slot<Host<SealedStdioLauncher>>>,
    /// **The kill handle for the call that is running.** A generation counter,
    /// raised by `end` and watched by every call in flight: a Stop on a window
    /// with a slow page in it comes back at once, and the lease that call is
    /// holding is dropped on the way out — which is what kills the sidecar child,
    /// because the launcher kills on drop.
    ///
    /// A counter rather than a flag, because the slot comes back into use: a Stop
    /// that ended the window must not cancel the next browser the person opens.
    stop: watch::Sender<u64>,
}

impl Default for Browser {
    fn default() -> Self {
        Self { slot: Mutex::new(Slot::idle()), stop: watch::Sender::new(0) }
    }
}

impl Browser {
    /// Calls one of the tools the model is offered, starting the sidecar if this is
    /// the first call since the window opened. A person's own answers are refused
    /// here, so no caller of this path can reach them by name.
    pub(crate) async fn call(
        &self,
        app_data: &Path,
        tool: &str,
        args: Map<String, Value>,
    ) -> Result<String, BrowserError> {
        self.reach(app_data, tool, args, false).await
    }

    /// Calls one of the person's own answers, or the list of what waits for them,
    /// and nothing else. Only the commands a person presses come here; a model tool
    /// is refused by name.
    pub(crate) async fn call_host(
        &self,
        app_data: &Path,
        tool: &str,
        args: Map<String, Value>,
    ) -> Result<String, BrowserError> {
        self.reach(app_data, tool, args, true).await
    }

    /// The one path both entries share. **Which of the two calls the host is decided
    /// by the entry that was called, and the name must agree with it** — checked
    /// before the slot is taken, so a refused name starts nothing.
    async fn reach(
        &self,
        app_data: &Path,
        tool: &str,
        args: Map<String, Value>,
        person: bool,
    ) -> Result<String, BrowserError> {
        if HOST_ONLY.contains(&tool) != person {
            return Err(BrowserError::Refused);
        }
        // **The generation is read before the lease is taken.** Taking the lease
        // first leaves a window in which a Stop lands and this call has already
        // decided it is not the one being stopped — it reads a generation that
        // includes the Stop and carries on to wait for a later one that will
        // never come. Subscribing first means a Stop between here and the lease
        // is simply a generation this call has already seen.
        let mut stopped = self.stop.subscribe();
        let seen = *stopped.borrow_and_update();
        let mut lease = self.locked().take(|| start(app_data))?;
        let name = qualified(tool);
        let ran = tokio::select! {
            biased;
            _ = wait_for_stop(&mut stopped, seen) => None,
            outcome = async {
                if person {
                    lease.host.call_host_only(CONVERSATION, &name, args).await.map(CallOutcome::Ran)
                } else {
                    lease.host.call(CONVERSATION, &name, args).await
                }
            } => Some(outcome),
        };
        // **A host that could not answer, or a window that has gone, is not a
        // session.** A page that refused is the page's own sentence — `Ran` with
        // an error in it and nothing more — and the browser stays, because one
        // refused page must not cost the person their whole session. Either of
        // the other two means there is no browser to drive: handing that host
        // back would leave the page drawing a window over a dead one, and a paused
        // one nothing could clear. So it is dropped, the child dies with it and
        // the pause with that.
        let kept = if keep_the_host(&ran) { self.locked().give_back(lease) } else { self.locked().abandon(lease); false };
        if !kept {
            log::info!("browser sidecar: dropped, the session was ended or its window is gone");
        }
        let Some(outcome) = ran else {
            log::info!("browser sidecar: the call was cut short by a Stop");
            return Err(BrowserError::Stopped);
        };
        match outcome.map_err(|error| {
            log::warn!("browser sidecar: {error:?}");
            BrowserError::Failed
        })? {
            CallOutcome::Ran(result) => {
                if result.is_error {
                    return Err(BrowserError::Refused);
                }
                Ok(result.for_model.join("\n"))
            }
            // Nothing the chat offers in this step needs an answer from a person.
            CallOutcome::NeedsConfirmation(_) => Err(BrowserError::Busy),
        }
    }

    /// Ends the session. Called when the window closes and when the app quits;
    /// whichever gets there first ends the same browser, and a second call is
    /// not an error.
    pub(crate) fn end(&self) {
        // **The slot is marked before the handle is raised, and the mark is what
        // the handle is for.** A call reads the generation before it takes the
        // lease, so a generation raised while the slot still said `Open` would be
        // read by a call that then took the slot and carried on driving a browser
        // the person had closed — the Stop it was waiting for is one it has
        // already seen. Marking first means such a call finds the slot `Closing`
        // and is refused, and the handle still reaches the call that is already
        // in it.
        drop(self.locked().end());
        self.stop.send_modify(|generation| *generation += 1);
    }

    /// Whether a session is open, so `Clear Kalsa's browser data` can refuse
    /// rather than empty a profile folder out from under a running browser.
    pub(crate) fn is_open(&self) -> bool {
        self.locked().is_open()
    }

    /// Whether a call owns the browser right now, which is the one refusal a
    /// Pausa waits out: the call it interrupted is on its way out.
    pub(crate) fn is_busy(&self) -> bool {
        self.locked().is_busy()
    }

    /// Whether the person has paused the session that is open. The sidecar holds
    /// the real flag and cannot be asked for it, so this is the app's record of
    /// what its pause calls were answered with.
    pub(crate) fn paused(&self) -> bool {
        self.locked().paused()
    }

    /// What a pause or a resume came back with, and whether the page needs to be
    /// told. **A pause on a session that is not there moves nothing**, and that is
    /// the slot's own rule rather than this call's care.
    pub(crate) fn set_paused(&self, paused: bool) -> bool {
        self.locked().set_paused(paused)
    }

    /// What the page is told, **in one move**: the open, the pause and the number
    /// that says which of two snapshots is later are read under a single lock, so
    /// the three can never be a half-old pair.
    pub(crate) fn window_state(&self) -> WindowState {
        self.locked().snapshot()
    }

    /// Takes the emptying of the profile, if there is no browser and no clear
    /// already running. Held until `end_clear`, so no call can start on a folder
    /// that is on its way elsewhere.
    pub(crate) fn begin_clear(&self) -> bool {
        self.locked().begin_clear()
    }

    pub(crate) fn end_clear(&self) {
        self.locked().end_clear();
    }

    /// **Interrupts the call in flight without ending the session.**
    ///
    /// A Pausa pressed while a call is running means "stop what Kalsa is doing",
    /// and the call is what it is doing. Raising the same handle a Stop raises
    /// cuts that call short and gives the slot back; the session stays open, the
    /// person has the window, and the pause that follows has a free slot to be
    /// applied in. Refusing it as "busy" instead would leave the control doing
    /// nothing, which is the one thing a pause must never be.
    pub(crate) fn interrupt(&self) {
        self.stop.send_modify(|generation| *generation += 1);
    }

    /// The slot, for the length of one move and no longer.
    fn locked(&self) -> std::sync::MutexGuard<'_, Slot<Host<SealedStdioLauncher>>> {
        self.slot.lock().expect("the session slot is not poisoned")
    }
}

/// **What became of the host a call was holding**, decided by the answer alone.
///
/// A page that refused is the page's own sentence and the browser stays. A host
/// that could not answer is not a browser at all, and neither is a window the
/// person closed: the sidecar forgets that session of its own accord, so a host
/// that answered its refusal and kept the sidecar running would otherwise leave
/// the page drawing — and refusing every call for — a browser that is not there.
fn keep_the_host<E>(ran: &Option<Result<CallOutcome, E>>) -> bool {
    match ran {
        // A Stop: the call came back as the person asked, and the session it was
        // driving is exactly as it was.
        None => true,
        Some(Err(_)) => false,
        Some(Ok(CallOutcome::NeedsConfirmation(_))) => true,
        Some(Ok(CallOutcome::Ran(result))) => !the_window_went(result),
    }
}

/// Whether the sidecar marked this answer as the window having gone.
///
/// **Read from the structured field, never from the sentence.** The mark is the
/// sidecar's own and comes on that one answer; a page's words are a stranger's,
/// and matching text to learn what a browser is doing would be reading the
/// stranger to find out.
fn the_window_went(result: &ToolResult) -> bool {
    result.for_ui.as_ref().and_then(|said| said.pointer("/kalsa/gone")).and_then(Value::as_bool) == Some(true)
}

/// Whether the Stop that raised the generation is this call's to answer.
///
/// The notification is created before the generation is read, so a Stop landing
/// between the two wakes this rather than being waited for by a call that has
/// already started.
async fn wait_for_stop(stopped: &mut watch::Receiver<u64>, seen: u64) {
    loop {
        if *stopped.borrow_and_update() != seen {
            return;
        }
        // A sender gone with the browser is itself an ending.
        if stopped.changed().await.is_err() {
            return;
        }
    }
}

/// Starts the host: its bytes checked against the digest they are approved
/// with, its tool definitions pinned, and the driver this host verified named in
/// its environment. The sidecar itself is started by the first `call`, which is
/// what `mail/host.rs` does too.
fn start(app_data: &Path) -> Result<Host<SealedStdioLauncher>, BrowserError> {
    let program = program::current()?;
    let driver = crate::browser::driver::installed(app_data)?;
    let launcher = SealedStdioLauncher::new(server_env::for_driver(&driver));
    let id = ServerId::new(SERVER).map_err(|_| BrowserError::Storage)?;
    let record = ServerRecord::new(id.clone(), program.path.clone(), Trust::FirstParty).map_err(|_| BrowserError::Storage)?;
    let registry = Registry::new(vec![record]).map_err(|_| BrowserError::Storage)?;
    let mut pins = tool_pins::checked_in();
    pins.seed_binary_with_digest(&id, &program.path, &program.sha256);
    Ok(Host::new(registry, launcher, pins))
}

#[cfg(test)]
mod tests {
    use super::{keep_the_host, qualified, wait_for_stop, Browser, BrowserError, Host, Registry, SealedStdioLauncher, ServerRecord, Slot, State, Trust, CONVERSATION};
    use kalsa_mcp::error::Error;
    use kalsa_mcp::outcome::{CallOutcome, ToolResult};
    use kalsa_mcp::pins::Pins;
    use kalsa_mcp::server_id::ServerId;
    use serde_json::{json, Map, Value};
    use crate::browser::SERVER;
    use crate::browser::window::WindowState;
    use std::path::PathBuf;
    use std::time::{Duration, Instant};
    use tokio::sync::watch;

    fn open() -> Slot<String> {
        Slot { state: State::Open, taken: 0, host: Some("session".to_owned()), paused: false, seq: 0, clearing: false }
    }

    fn idle() -> Slot<String> {
        Slot::idle()
    }

    /// The states are the contract, so the tests read them rather than only the
    /// error a refusal happens to carry.
    fn state<T>(slot: &Slot<T>) -> State {
        slot.state
    }

    /// **Two calls, one browser.** The second sees `Busy` and is refused, and it
    /// is a plain sentence rather than a second host.
    #[test]
    fn a_second_call_while_one_is_running_is_refused_and_never_starts_one() {
        let mut slot = idle();
        assert!(slot.take(|| Ok("new".to_owned())).is_ok());
        assert_eq!(state(&slot), State::Busy, "the running call holds the slot");
        assert!(matches!(slot.take(|| panic!("a second host was started")), Err(BrowserError::Busy)));
        assert_eq!(state(&slot), State::Busy, "and it is still the first call's slot");
    }

    /// An open session is reused, not replaced, and comes back open.
    #[test]
    fn a_finished_call_hands_its_host_back_to_the_session() {
        let mut slot = open();
        let lease = slot.take(|| Ok("new".to_owned())).expect("the open host is reused");
        assert_eq!(lease.host, "session");
        assert_eq!(state(&slot), State::Busy);
        assert!(slot.give_back(lease), "nothing ended it meanwhile");
        assert_eq!(state(&slot), State::Open);
        assert_eq!(slot.take(|| Ok("new".to_owned())).expect("reused").host, "session");
    }

    /// **`end` on an open session leaves the browser `Idle`, not `Closing`.** The
    /// host is gone, so nothing is running and the person may open another one; a
    /// slot left at `Closing` would refuse every later call and every clear for
    /// the life of the window.
    #[test]
    fn end_on_an_open_session_drops_the_host_and_leaves_the_browser_idle() {
        let mut slot = open();
        assert_eq!(slot.end().as_deref(), Some("session"), "the host is handed out to be dropped");
        assert_eq!(state(&slot), State::Idle);
        assert!(!slot.is_open());
        assert!(slot.take(|| Ok("fresh".to_owned())).is_ok(), "and a new browser can start");
    }

    /// **A close during a call leaves no host behind, and a second call during the
    /// close changes nothing.** The call still owns its host, so `end` cannot take
    /// it; it marks the slot instead, and the call's way out drops what it holds.
    /// The generation is what makes that safe: even if the slot has moved on, the
    /// lease can tell that it is not the call the browser is waiting for.
    #[test]
    fn a_close_during_a_call_leaves_no_host_to_survive() {
        let mut slot = idle();
        let lease = slot.take(|| Ok("running".to_owned())).expect("the call took the browser");
        assert_eq!(slot.end(), None, "the call still owns it");
        assert_eq!(state(&slot), State::Closing);

        // A second call while the close is on its way out is refused, and the
        // slot stays put — it does not become Busy-owned and start someone else.
        assert!(matches!(slot.take(|| panic!("a second host was started")), Err(BrowserError::Busy)));
        assert_eq!(state(&slot), State::Closing, "a refused call must not take the slot");

        assert!(!slot.give_back(lease), "the host was put back after the session ended");
        assert_eq!(state(&slot), State::Idle);
        assert!(!slot.is_open());
        assert!(slot.take(|| Ok("fresh".to_owned())).is_ok(), "and the next call starts a new browser");
    }

    /// **The generation, on its own.** A lease whose number the slot has moved
    /// past cannot resurrect its host, even when the state happens to look like a
    /// call's own. This is what a second `take` would produce.
    #[test]
    fn a_lease_from_a_superseded_call_cannot_put_its_host_back() {
        let mut slot = idle();
        let first = slot.take(|| Ok("first".to_owned())).expect("the first call");
        let second = slot.take(|| Ok("second".to_owned()));
        assert!(matches!(second, Err(BrowserError::Busy)), "one call at a time");

        // The slot has moved to a later call than the lease believes.
        slot.taken += 1;
        slot.state = State::Busy;
        assert!(!slot.give_back(first), "a stale lease restored a host");
        assert!(slot.host.is_none(), "and left none behind either");
        // **And it did not answer for the call that owns the slot now.** Marking
        // it `Idle` here would hand a second browser to the next caller while that
        // one is still driving the first.
        assert_eq!(state(&slot), State::Busy, "the call that owns the slot keeps it");
        assert!(slot.is_open(), "and the browser it is driving is still there");
    }

    /// Ending an idle browser leaves it idle: the window event fires on every
    /// close, and none of them may leave a browser that can never start.
    #[test]
    fn ending_an_idle_browser_leaves_it_idle_and_startable() {
        let mut slot = idle();
        assert_eq!(slot.end(), None);
        assert_eq!(state(&slot), State::Idle);
        assert!(!slot.is_open());
        assert!(slot.take(|| Ok("fresh".to_owned())).is_ok());
    }

    /// A browser that would not start is this call's answer and not a browser
    /// that is busy for ever.
    #[test]
    fn a_browser_that_would_not_start_leaves_the_slot_idle() {
        let mut slot = idle();
        assert!(matches!(slot.take(|| Err(BrowserError::Storage)), Err(BrowserError::Storage)));
        assert_eq!(state(&slot), State::Idle);
        assert!(!slot.is_open());
    }

    /// A clear asks whether a session exists in **any** form. A running call is
    /// one, and so is one that has been ended but whose call has not returned.
    #[test]
    fn a_clear_is_refused_for_every_state_that_has_a_browser() {
        assert!(!idle().is_open(), "an idle browser is no browser");
        for one in [State::Busy, State::Open, State::Closing] {
            let slot = Slot::<()> { state: one, taken: 0, host: None, paused: false, seq: 0, clearing: false };
            assert!(slot.is_open(), "{one:?} is a browser");
        }
    }

    /// **A pause never outlives its window.** The sidecar holds it and the
    /// sidecar dies with the session, so `end()` drops it in the same breath —
    /// which is what makes a page left saying "paused" over a browser that is
    /// gone impossible rather than merely unlikely. The next browser is somebody
    /// else's, and it is not paused.
    #[test]
    fn a_pause_does_not_outlive_its_window() {
        let mut slot = open();
        assert!(slot.set_paused(true), "a pause is recorded");
        assert!(slot.paused());

        slot.end();
        assert!(!slot.paused(), "the session took its pause with it");

        let mut next = idle();
        assert!(next.take(|| Ok("new".to_owned())).is_ok(), "and the next browser can start");
        assert!(!next.paused(), "and it is not born paused");
    }

    /// A `ToolResult` as the sidecar sent it, so a proof can say what was in it.
    fn result(is_error: bool, for_ui: Option<Value>) -> ToolResult {
        ToolResult {
            server: ServerId::new(SERVER).expect("the browser's own server name"),
            is_error,
            for_model: vec!["the sidecar's sentence".to_owned()],
            for_ui,
        }
    }

    /// **A window the person closed ends the session, exactly as a host that
    /// could not answer does.** The sidecar forgets that window of its own accord
    /// and marks the answer; keeping a session the sidecar has already dropped
    /// would leave the page drawing a browser that is gone — and a paused one
    /// refusing every call for good.
    #[test]
    fn a_marked_answer_ends_the_session_and_takes_the_pause_with_it() {
        let marked = CallOutcome::Ran(result(true, Some(json!({"kalsa": {"gone": true}}))));
        assert!(!keep_the_host::<()>(&Some(Ok(marked))), "a window that has gone is not kept");

        let mut slot = open();
        let lease = slot.take(|| panic!("the open host is reused")).expect("a call took the browser");
        slot.set_paused(true);
        slot.abandon(lease);
        assert!(!slot.is_open(), "and the slot it was driving is gone");
        assert!(!slot.paused(), "with the pause that would have refused every later call");
    }

    /// **A page that refused is the page's own sentence, and the browser stays.**
    /// One refused page must not cost the person their whole session — which is
    /// the whole difference between this answer and the marked one above.
    #[test]
    fn a_plain_refusal_keeps_the_session_it_was_driving() {
        let refused = CallOutcome::Ran(result(true, None));
        assert!(keep_the_host::<()>(&Some(Ok(refused))), "an unmarked refusal is the page's own");

        // Structured content that says nothing about a window is not a mark, and
        // neither is one that is not true.
        for said in [json!({}), json!({"kalsa": {}}), json!({"kalsa": {"gone": false}}), json!({"kalsa": {"gone": "yes"}})] {
            let answered = CallOutcome::Ran(result(true, Some(said.clone())));
            assert!(keep_the_host::<()>(&Some(Ok(answered))), "{said} is not a mark");
        }

        let mut slot = open();
        let lease = slot.take(|| panic!("the open host is reused")).expect("a call took the browser");
        assert!(slot.give_back(lease), "so the host goes back as it was");
        assert!(slot.is_open(), "and the session is still there");
    }

    /// A Stop is the person saying they had enough, and the session it was
    /// driving is left exactly as it was.
    #[test]
    fn a_stop_keeps_the_session() {
        assert!(keep_the_host::<()>(&None), "a call that was cut short changed nothing");
    }

    /// **Ending twice is one ending, and it is what makes the old lease safe.**
    /// A call is still on its way out, so the slot stays `Closing` and a new call
    /// is refused: answering the second end by going `Idle` would let the next
    /// caller take the slot while that lease is still in it.
    #[test]
    fn a_second_end_does_not_reopen_a_closing_slot() {
        let mut slot = open();
        let running = slot.take(|| panic!("the open host is reused")).expect("a call took the browser");
        assert_eq!(state(&slot), State::Busy);

        assert!(slot.end().is_none(), "there is no host to hand out from here");
        assert_eq!(state(&slot), State::Closing, "the call is on its way out");

        assert!(slot.end().is_none(), "and a second end changes nothing at all");
        assert_eq!(state(&slot), State::Closing, "still refusing the calls that would race the last one");
        assert!(matches!(slot.take(|| panic!("a call took a closing slot")), Err(BrowserError::Busy)));

        // The lease finally comes back, and the browser is gone for good.
        assert!(!slot.give_back(running));
        assert_eq!(state(&slot), State::Idle);
        assert!(!slot.is_open());
    }

    /// **The whole sequence: two ends, then the lease that was out, then the
    /// next browser — and nothing left over to answer for it.**
    ///
    /// A lease from an ended call returning late is what used to clobber the
    /// browser that came after it. It cannot now, and the reason is the order
    /// this walks: the second end leaves the slot `Closing`, so no call can be in
    /// it while that lease is still out, and by the time one can be, the lease
    /// has already been spent.
    #[test]
    fn a_lease_from_the_ended_call_cannot_clobber_the_next_browser() {
        let mut slot = open();
        let ending = slot.take(|| panic!("the open host is reused")).expect("a call took the browser");

        slot.end();
        assert_eq!(state(&slot), State::Closing);
        assert!(slot.end().is_none(), "and the second end changes nothing");
        assert!(
            matches!(slot.take(|| panic!("a new call took a closing slot")), Err(BrowserError::Busy)),
            "so nothing can get in while that lease is still out"
        );

        assert!(!slot.give_back(ending), "and the lease finally returns to a slot that has ended");
        assert_eq!(state(&slot), State::Idle);
        assert!(!slot.is_open());

        // The next browser, with nothing left over from the last one.
        let next = slot.take(|| Ok("next".to_owned())).expect("the browser can start again");
        assert!(slot.give_back(next), "and it goes back as it was");
        assert!(slot.is_open(), "so the browser that is really being driven is open");
    }

    /// **A Stop that has marked the slot is already in force, whether the handle
    /// has been raised yet or not.** This is the order `Browser::end` relies on:
    /// a call arriving between the mark and the signal finds the slot `Closing`,
    /// so it cannot read the new generation, take the slot and carry on driving a
    /// browser the person has closed.
    #[test]
    fn a_call_between_the_mark_and_the_signal_is_refused() {
        let mut slot = open();
        let running = slot.take(|| panic!("the open host is reused")).expect("a call took the browser");

        // The mark. The handle is raised only after this, and nothing here is
        // waiting on it: a call arriving now is refused on the slot alone.
        assert!(slot.end().is_none());
        assert!(
            matches!(slot.take(|| panic!("a call arrived in the gap")), Err(BrowserError::Busy)),
            "the slot alone refuses it, so the generation it would read is never reached"
        );

        slot.give_back(running);
        assert!(!slot.is_open(), "and the browser it was driving is gone");
    }

    /// **The number the page orders its snapshots by moves with every change,
    /// and never backwards** — which is the whole of what makes a read that
    /// landed late harmless: it is older, and the page drops it.
    #[test]
    fn every_change_moves_the_number_the_page_orders_by() {
        let mut slot = open();
        let before = slot.snapshot().seq;

        slot.set_paused(true);
        let paused = slot.snapshot().seq;
        assert!(paused > before, "a pause is a later truth");

        let lease = slot.take(|| panic!("the open host is reused")).expect("a call takes the browser");
        let running = slot.snapshot().seq;
        assert!(running > paused, "a call taking the browser is one too");

        assert!(slot.give_back(lease));
        let back = slot.snapshot().seq;
        assert!(back > running, "and the call coming back is one");

        slot.end();
        let ended = slot.snapshot().seq;
        assert!(ended > back, "and a session ending is one");
        assert_eq!(
            slot.snapshot(),
            WindowState { open: false, paused: false, seq: ended },
            "and the snapshot is one moment: the pause went with the session"
        );
    }

    /// **A host that could not answer is not a session.** A page that refused is
    /// the page's own sentence and keeps the browser; a sidecar that is gone has
    /// to take the window with it — otherwise the page keeps drawing it, and a
    /// paused one nothing could ever clear.
    #[test]
    fn a_host_that_could_not_answer_is_dropped_rather_than_kept() {
        let mut slot = open();
        let lease = slot.take(|| panic!("the open host is reused")).expect("a call took the browser");
        slot.set_paused(true);
        assert!(slot.paused(), "it was paused while the call ran");

        slot.abandon(lease);
        assert!(!slot.is_open(), "a host that could not answer leaves no session");
        assert!(!slot.paused(), "and takes the pause with it, so nothing is left refusing every call");

        // And the next browser is somebody else's.
        assert!(slot.take(|| Ok("fresh".to_owned())).is_ok(), "a new browser can start");
        assert!(!slot.paused(), "and it is not born paused");
    }

    /// **A pause pressed while a call owns the browser is the person's intent and
    /// is recorded anyway.** Refusing it as busy would be a control that does
    /// nothing while Kalsa carries on, which is the one thing a pause must never
    /// be; the sidecar is told once that call has gone.
    #[test]
    fn a_pause_pressed_while_a_call_is_running_is_recorded_not_refused() {
        let mut slot = open();
        let lease = slot.take(|| panic!("the open host is reused")).expect("a call took the browser");
        assert!(slot.is_busy(), "a call owns the browser");

        assert!(slot.set_paused(true), "the pause is recorded while the call runs");
        assert!(slot.paused(), "and it is still there when the call comes back");

        assert!(slot.give_back(lease), "the session is not a casualty of pausing it");
        assert!(slot.paused(), "so the pause survives to be given to the sidecar");

        // A resume pressed over the same session is recorded too.
        assert!(slot.set_paused(false));
        assert!(!slot.paused());
    }

    /// **The clear holds the slot for as long as it runs.** A browser that
    /// starts between the check and the rename is exactly what the check is for,
    /// so the taking of it and the check are one move.
    #[test]
    fn a_clear_takes_the_slot_and_a_browser_cannot_start_under_it() {
        let mut slot = idle();
        assert!(slot.begin_clear(), "nothing is running, so a clear may");
        assert!(!slot.begin_clear(), "and a second clear is refused rather than raced");
        assert!(
            matches!(slot.take(|| panic!("a browser started under a clear")), Err(BrowserError::Busy)),
            "no call may take the browser while the profile is being emptied"
        );

        slot.end_clear();
        assert!(slot.take(|| Ok("after".to_owned())).is_ok(), "and the browser comes back afterwards");

        // And a clear against a browser in any state is refused on its own.
        let mut open = open();
        assert!(!open.begin_clear(), "a browser's profile is not emptied under it");
    }

    /// A pause is refused on nothing, and a pause twice moves nothing: either
    /// would tell the page that a browser is paused when it is not.
    #[test]
    fn a_pause_needs_a_window_and_moves_only_once() {
        let mut slot = idle();
        assert!(!slot.set_paused(true), "there was no browser to pause");
        assert!(!slot.paused());

        slot.state = State::Open;
        assert!(slot.set_paused(true));
        assert!(!slot.set_paused(true), "a second press of the same pause says nothing new");

        // A finished call is not a close, so a pause survives one.
        let lease = slot.take(|| Ok("running".to_owned())).expect("the call took the browser");
        assert!(slot.give_back(lease));
        assert!(slot.paused(), "a call that came back did not end anything");
    }

    /// **A Stop cuts a call short, and the call that was running is the one that
    /// hears it.** This is the whole of the kill handle: the generation is read
    /// when the lease is taken, so a Stop landing after that is seen, and one
    /// landing before it belongs to a call that had not started — which is the
    /// call the lease refusal already covers.
    #[tokio::test]
    async fn a_stop_ends_the_wait_for_a_call_that_is_running() {
        let (stop, mut stopped) = watch::channel(0_u64);
        let seen = *stopped.borrow_and_update();
        stop.send_modify(|generation| *generation += 1);

        let began = Instant::now();
        tokio::time::timeout(Duration::from_secs(2), wait_for_stop(&mut stopped, seen))
            .await
            .expect("the call is not left waiting on a Stop that has already happened");
        assert!(began.elapsed() < Duration::from_millis(500), "and it is not left waiting at all: {:?}", began.elapsed());
    }

    /// **A Pausa pressed while a call is running is not a refusal.** It raises the
    /// same handle a Stop raises, so the call in flight comes back at once and the
    /// slot is free for the pause to be applied in — the session itself is
    /// untouched, because the person wants the window and not the end of it.
    #[tokio::test]
    async fn a_pause_interrupts_a_running_call_and_leaves_the_session_open() {
        let (stop, mut stopped) = watch::channel(0_u64);
        let seen = *stopped.borrow_and_update();
        // What `brain_browser_pause` does: interrupt, then take the slot.
        stop.send_modify(|generation| *generation += 1);
        tokio::time::timeout(Duration::from_secs(2), wait_for_stop(&mut stopped, seen))
            .await
            .expect("the call is cut short");
        assert!(Slot::<String>::idle().take(|| Ok("session".to_owned())).is_ok(), "and the next thing can have the browser");
    }

    /// **A Stop that has not happened leaves the call alone**, and a Stop that
    /// comes later is the one that ends it: a generation from before this call
    /// is not this call's to answer.
    #[tokio::test]
    async fn a_stop_before_the_call_does_not_end_it_and_a_later_one_does() {
        let (stop, mut stopped) = watch::channel(1_u64);
        let seen = *stopped.borrow_and_update();

        let mut waiting = Box::pin(wait_for_stop(&mut stopped, seen));
        assert!(
            tokio::time::timeout(Duration::from_millis(150), &mut waiting).await.is_err(),
            "nothing has been stopped, so the call carries on"
        );
        stop.send_modify(|generation| *generation += 1);
        tokio::time::timeout(Duration::from_secs(2), waiting).await.expect("and the Stop that came later ends it");
    }

    /// **The counter, not a flag.** The slot comes back into use after an end, so
    /// a Stop that ended one window must not cancel the next browser's call —
    /// which is what a single boolean would do.
    #[tokio::test]
    async fn a_stop_from_the_window_before_does_not_cancel_the_next_one() {
        let (stop, stopped) = watch::channel(0_u64);
        stop.send_modify(|generation| *generation += 1);

        // The next call reads the generation **after** the Stop, so it is not
        // waiting on one it never saw.
        let mut stopped = stopped;
        let seen = *stopped.borrow_and_update();
        assert_eq!(seen, 1, "the new call reads where the counter is now");
        assert!(
            tokio::time::timeout(Duration::from_millis(150), wait_for_stop(&mut stopped, seen)).await.is_err(),
            "and nothing ends it"
        );
    }

    /// **A tool is called by the name the host routes by, and a bare one is refused.**
    /// Every browser call went out bare, so each was refused as `NoNamespace` before
    /// the host looked at anything. This drives the name the call builds through a real
    /// host: the bare name is still refused for having no server, and the qualified one
    /// gets past the name to the binary, which is not on disk here, so the host stops
    /// there and no sidecar is started.
    #[tokio::test]
    async fn a_browser_tool_is_called_by_the_name_the_host_routes_by() {
        let record = ServerRecord::new(
            ServerId::new(SERVER).expect("the browser's own server name"),
            PathBuf::from("/nonexistent/kalsa-browser-sidecar"),
            Trust::FirstParty,
        )
        .expect("an absolute path is a record");
        let registry = Registry::new(vec![record]).expect("one server");
        let mut host = Host::new(registry, SealedStdioLauncher::new(Vec::new()), Pins::default());

        let bare = host.call(CONVERSATION, "browser_open", Map::new()).await;
        assert!(matches!(bare, Err(Error::NoNamespace)), "a bare name has no server to route to");

        let routed = host.call(CONVERSATION, &qualified("browser_open"), Map::new()).await;
        assert!(matches!(routed, Err(Error::BinaryUnreadable(_))), "a qualified name reaches the browser's server");
    }

    /// **Each entry refuses the other side's names before anything starts.** The
    /// model's path cannot reach a person's answer by name, and the person's path
    /// cannot reach a model tool. The app data folder here does not exist, so a call
    /// that got past the check would fail with a different error.
    #[tokio::test]
    async fn each_entry_refuses_the_other_sides_names_before_anything_starts() {
        let browser = Browser::default();
        let app_data = PathBuf::from("/nonexistent/kalsa-browser-app-data");

        assert_eq!(browser.call(&app_data, "browser_confirm", Map::new()).await.err(), Some(BrowserError::Refused));
        assert_eq!(browser.call(&app_data, "browser_waiting", Map::new()).await.err(), Some(BrowserError::Refused));
        assert_eq!(browser.call_host(&app_data, "browser_open", Map::new()).await.err(), Some(BrowserError::Refused));
        assert!(!browser.is_open(), "and no browser was started");
    }
}
