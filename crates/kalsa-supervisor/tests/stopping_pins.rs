//! The `Stopping` state's two source pins, each with a replayed mutation,
//! because they cover exactly what no interleaving can reach: who writes
//! `Stopped` (the drain's own end, nowhere else), and which of the two
//! statements in `Supervisor::stop`/`shutdown` comes first — a worker busy in
//! a handshake hides that ordering from every reading. The behaviour these
//! pins guard is driven in the sibling `stopping.rs`.
//!
//! The inspection pattern is the app shell's (`src-tauri/src/tests.rs`,
//! `every_non_running_arm_of_brain_state_stops_the_door` and its replay):
//! read the real file, classify every occurrence, and prove the check can go
//! red by replaying the edit it exists for on a COPY — green on the original
//! is only evidence next to red on the mutation.

/// The pin's source: the file every write it classifies lives in.
fn supervisor_source() -> String {
    std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/src/supervisor.rs"
    ))
    .expect("supervisor.rs is readable")
}

/// The brace-matched block whose opening `{` sits at or after `from`: the
/// whole of an `fn`, as source. Copied from the app shell's pins — the two
/// are different crates, and a pin reads its own file.
fn brace_block(source: &str, from: usize) -> &str {
    let open = from + source[from..].find('{').expect("a block opens");
    let mut depth = 0usize;
    for i in open..source.len() {
        match source.as_bytes()[i] {
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return &source[open..=i];
                }
            }
            _ => {}
        }
    }
    panic!("unbalanced braces in the block at byte {from}");
}

/// I3, as source: `Stopped` is written by the worker's `stop` — the drain's
/// own end, after the teardown — and constructed exactly once as the
/// supervisor's initial value in `Supervisor::new`. Every other occurrence
/// of the literal in production code is a READ (`unwrap_or`: a poisoned lock
/// answers `Stopped` to the reader and writes nothing). The region read as
/// production ends at the tests module's OWN marker — the exact two-line
/// text `#[cfg(test)]` on the line before `mod tests` — and that region is
/// read in full: a cfg'd item inside it (the test-only `Command::Plant` is
/// one) is still source this pin classifies, because the invariant is about
/// where the source writes, not about what a build compiles. The tests below
/// the module marker are out of scope on purpose: they build states to
/// assert against, they never write into a live supervisor.
///
/// The stop picks its end into a local (there are two: `Stopped`, or the
/// failed-to-stop state `presence` decides) and writes it through ONE
/// `set(state, end)` — so the literal may appear more than once INSIDE that
/// fn, choosing the end; what this pin forbids is it appearing anywhere
/// else. The invariant is the WHERE, not the count.
fn only_the_drain_ends_writes_stopped(source: &str) -> Result<(), String> {
    let production_end = source
        .find("#[cfg(test)]\nmod tests")
        .ok_or_else(|| {
            "supervisor.rs lost the tests module's own two-line marker (the cfg-test \
             attribute on the line before `mod tests`): this pin cannot tell production \
             from tests and must not guess"
                .to_string()
        })?;
    let production = &source[..production_end];
    let new_at = production
        .find("pub fn new()")
        .ok_or_else(|| "Supervisor::new is the construction the pin allows".to_string())?;
    let stop_at = production
        .find("fn stop(\n")
        .ok_or_else(|| "the worker's stop is where a drain ends".to_string())?;
    let stop_end = stop_at
        + production[stop_at..]
            .find("\nfn ")
            .ok_or_else(|| "the worker's stop is never followed by another fn".to_string())?;

    let mut constructions = 0usize;
    let mut ends = 0usize;
    let mut offset = 0usize;
    for line in production.split_inclusive('\n') {
        let here = offset;
        offset += line.len();
        let text = line.trim();
        if text.starts_with("//") || text.starts_with('*') {
            continue;
        }
        if !line.contains("ServerState::Stopped") {
            continue;
        }
        if line.contains("Mutex::new(ServerState::Stopped)") {
            // Allowed once, and only as the supervisor's own initial value:
            // a construction is not a write into a running state.
            constructions += 1;
            if here < new_at {
                return Err(format!(
                    "a Stopped was constructed outside Supervisor::new: {text}"
                ));
            }
            continue;
        }
        if line.contains("unwrap_or(ServerState::Stopped)") {
            continue; // a read, no write
        }
        if here >= stop_at && here < stop_end {
            // Inside the worker's stop the literal is the drain choosing or
            // naming its own end; the single write point below carries it
            // out (`set(state, end)`).
            ends += 1;
            continue;
        }
        return Err(format!(
            "ServerState::Stopped is written outside the worker's stop: {text}"
        ));
    }
    if constructions != 1 {
        return Err(format!(
            "the construction in Supervisor::new appeared {constructions} times, expected 1"
        ));
    }
    if ends < 1 {
        return Err(format!(
            "the worker's stop never names the drain's end ({ends} times)"
        ));
    }
    let stop_body = &production[stop_at..stop_end];
    let entry = stop_body
        .find("set(state, ServerState::Stopping)")
        .ok_or_else(|| "the worker's stop no longer declares the drain on entry".to_string())?;
    let end = stop_body
        .find("ServerState::Stopped")
        .ok_or_else(|| "the worker's stop no longer names the drain's end".to_string())?;
    if entry > end {
        return Err("the worker's stop declares the drain after it ends it".to_string());
    }
    Ok(())
}

#[test]
fn stopped_is_written_only_where_the_drain_ends() {
    let source = supervisor_source();
    if let Err(error) = only_the_drain_ends_writes_stopped(&source) {
        panic!("{error} — Stopped is the drain's own end, not a general tool");
    }
}

#[test]
fn the_stopped_pin_bites_on_a_second_writer() {
    // The edit a future cleanup makes, replayed on a COPY of the source: the
    // worker's watch arm tidies up with the very write the drain owns. The
    // pin must go red on that copy...
    let source = supervisor_source();
    let mutated = source.replacen(
        "    let mut owned: Option<Owned> = None;",
        "    let mut owned: Option<Owned> = None;\n    set(&state, ServerState::Stopped);",
        1,
    );
    assert!(
        only_the_drain_ends_writes_stopped(&mutated).is_err(),
        "the pin passed on a supervisor whose work() writes the drain's end too"
    );
    // ...and stay green on the untouched source, so the red above is the
    // mutation's doing and not a checker that fails both ways.
    assert_eq!(only_the_drain_ends_writes_stopped(&source), Ok(()));
}

/// I2, as source: in BOTH callers the declaration precedes the queueing, and
/// both take their declaration back when the command never left. The
/// behavioural tests above prove the declaration is synchronous; only source
/// can prove which of the two statements comes first, because a worker busy
/// in a handshake hides the ordering from every reading.
fn declared_before_queued(source: &str) -> Result<(), String> {
    for (signature, command) in [
        ("pub fn stop(&self)", "Command::Stop"),
        ("pub fn shutdown(&self)", "Command::Shutdown"),
    ] {
        let at = source
            .find(signature)
            .ok_or_else(|| format!("{signature} is where a caller declares its drain"))?;
        let body = brace_block(source, at);
        let declared = body
            .find("drain::declare(")
            .ok_or_else(|| format!("{signature} no longer declares the drain"))?;
        let queued = body
            .find(command)
            .ok_or_else(|| format!("{signature} no longer queues {command}"))?;
        if declared > queued {
            return Err(format!(
                "{signature} queues {command} before declaring: a poll between them still reads Running"
            ));
        }
        if !body.contains("drain::restore(") {
            return Err(format!(
                "{signature} declares a drain it never takes back when the command cannot be queued"
            ));
        }
    }
    Ok(())
}

#[test]
fn the_drain_is_declared_before_the_command_is_queued() {
    let source = supervisor_source();
    if let Err(error) = declared_before_queued(&source) {
        panic!("{error} — that ordering is the window the state closes");
    }
}

#[test]
fn the_order_pin_bites_when_the_command_is_queued_first() {
    // The replay: the declaration moved below the send, the way a cleanup
    // that "reads better" writes it. The worker can win that race by
    // finishing the whole drain before the caller's write lands...
    let source = supervisor_source();
    let mutated = source
        .replacen(
            "let declared = drain::declare(&self.state);",
            "let declared = ();",
            1,
        )
        .replacen(
            "if self.commands.send(Command::Stop).is_err() {",
            "if self.commands.send(Command::Stop).is_err() {\n            let declared = drain::declare(&self.state);",
            1,
        );
    assert!(
        declared_before_queued(&mutated).is_err(),
        "the pin passed on a stop that queues before it declares"
    );
    assert_eq!(declared_before_queued(&source), Ok(()));
}
