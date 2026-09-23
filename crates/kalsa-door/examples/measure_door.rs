//! The door for `dev/measure-concurrency.py`: the same `Door` the app runs,
//! as a standalone child process, so a measurement can go THROUGH the door
//! instead of direct to the engine.
//!
//! stdin carries exactly `--capacity` credentials, one 64-hex line each —
//! none of them is ever printed, however it was wrong. stdout carries
//! exactly one line, `listening 127.0.0.1:<port>`, which the harness reads
//! before it sends anything; the pipe then stays open and stdin blocking is
//! the harness saying "done": EOF shuts the worker pool down and exits 0.
//!
//! The engine's header support is asserted by the harness that launches
//! this runner, not by this runner.

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
    let engine_port: u16 = arg("--engine-port")?.parse()?;
    let capacity: u32 = arg("--capacity")?.parse()?;

    let stdin = io::stdin();
    let mut lines = stdin.lock().lines();
    let mut entries = Vec::new();
    for k in 0..capacity {
        let Some(line) = lines.next().transpose()? else {
            return Err(format!("stdin ended after {k} of {capacity} credentials").into());
        };
        if line.len() != 64 || !line.bytes().all(|b| b.is_ascii_hexdigit()) {
            // the credential itself is never echoed, however it was wrong
            return Err(format!("line {}: expected 64 hex characters", k + 1).into());
        }
        entries.push(DeviceEntry::new(DeviceId::new(k), format!("device-{k}"), line)?);
    }
    let devices = Devices::new(entries)?;

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

    // EOF on stdin: the harness has every credential it needs and is done —
    // stop accepting, join the workers, exit 0.
    for line in lines {
        line?;
    }
    running.shutdown();
    Ok(())
}
