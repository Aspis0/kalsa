//! The door for `dev/measure-concurrency.py` as a standalone child
//! process, so a measurement can go THROUGH the door instead of direct.
//!
//! stdin carries exactly `--capacity` credentials, one 64-hex line each —
//! none is ever printed, however it was wrong. stdout carries exactly one
//! line, `listening 127.0.0.1:<port>`; stdin then blocking is the harness
//! saying "done": EOF shuts the worker pool down and exits 0.
//!
//! The engine's header support is asserted by the harness, not here.

use std::io::{self, BufRead, Write};
use std::net::TcpListener;

use kalsa_door::{DeviceEntry, DeviceId, Devices, Door, EnginePrivateHeaders};

fn arg(flag: &str) -> Result<String, String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    args.iter()
        .position(|a| a == flag)
        .and_then(|i| args.get(i + 1))
        .cloned()
        .ok_or_else(|| format!("missing value for {flag}"))
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Every error below is a FIXED string: the runtime prints `main`'s Err
    // with Debug, and the three operations that touch a credential (line
    // read, DeviceEntry::new, Devices::new) are mapped to text and line
    // numbers only - no error type's Debug or Display can echo one.
    let engine_port: u16 = arg("--engine-port")?
        .parse()
        .map_err(|_| "--engine-port must be a number")?;
    let capacity: u32 = arg("--capacity")?
        .parse()
        .map_err(|_| "--capacity must be a number")?;

    let stdin = io::stdin();
    let mut lines = stdin.lock().lines();
    let mut entries = Vec::new();
    for k in 0..capacity {
        let line = match lines.next().transpose() {
            Ok(Some(line)) => line,
            Ok(None) => {
                return Err(format!("stdin ended after {k} of {capacity} credentials").into())
            }
            // an io error may quote the bytes it choked on; those bytes
            // may be a credential - the line number is all that is kept
            Err(_) => return Err(format!("line {}: could not be read", k + 1).into()),
        };
        if line.len() != 64 || !line.bytes().all(|b| b.is_ascii_hexdigit()) {
            // the credential itself is never echoed, however it was wrong
            return Err(format!("line {}: expected 64 hex characters", k + 1).into());
        }
        let entry = DeviceEntry::new(DeviceId::new(k), format!("device-{k}"), line)
            // InvalidCredential is a unit variant today and cannot carry
            // the credential; mapped anyway - this file's guarantee, not
            // the enum's mood.
            .map_err(|_| format!("line {}: invalid credential", k + 1))?;
        entries.push(entry);
    }
    let devices = Devices::new(entries)
        .map_err(|_| "the credential set is invalid (empty or duplicated)")?;

    let listener = TcpListener::bind("127.0.0.1:0")?;
    let running = Door::new_with_engine(
        listener,
        engine_port,
        devices,
        capacity,
        EnginePrivateHeaders::Consumed,
    )?
    .start()?;
    let mut stdout = io::stdout();
    writeln!(stdout, "listening {}", running.address())?;
    stdout.flush()?;

    // EOF on stdin: the harness is done - stop accepting, join, exit 0.
    for line in lines {
        line?;
    }
    running.shutdown();
    Ok(())
}
