//! Choose and remember the local port for the authenticated door.
//!
//! The door crate receives the listener after this module binds it. Keeping
//! port selection here makes the caller responsible for persistence while the
//! door remains responsible for validating the address it was handed.

use std::fs;
use std::io;
use std::net::{Ipv4Addr, TcpListener};
use std::path::{Path, PathBuf};

use kalsa_door::EnginePrivateHeaders;
use kalsa_runtime::engine_consumes_private_headers;

const DEFAULT_PORT: u16 = 8131;

/// The door's declaration for the engine mounted at `exe`, read from the
/// bytes on disk rather than declared for the life of this binary.
///
/// A capability check, not a version check: the version is the archive's
/// sha256 in `kalsa-runtime`'s asset table, and an archive can gain or lose
/// the inlet without that changing. The engine is a download, so a constant
/// claiming it consumes the door's headers would be a claim about bytes
/// nobody had fetched. On Intel Macs, on upstream archives and on any future
/// archive that drops the inlet, the honest answer is `NotConsumed` and the
/// door serves exactly one device.
pub(crate) fn engine_declaration(exe: &Path) -> EnginePrivateHeaders {
    if engine_consumes_private_headers(exe) {
        return EnginePrivateHeaders::Consumed;
    }
    // Loud on purpose: a silent downgrade to one device reads as a bug in
    // the door, and this line is the only trace of what the engine actually
    // was.
    eprintln!(
        "kalsa-brain: the engine at {} carries no x-kalsa-slot inlet; \
         the door will serve one device",
        exe.display()
    );
    EnginePrivateHeaders::NotConsumed
}

pub(crate) fn bind(pairing_file: &Path) -> io::Result<TcpListener> {
    let preferred = preferred_port(pairing_file)?;
    let listener = match TcpListener::bind((Ipv4Addr::LOCALHOST, preferred)) {
        Ok(listener) => listener,
        Err(error) if error.kind() == io::ErrorKind::AddrInUse => {
            TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?
        }
        Err(error) => return Err(error),
    };
    let actual = listener.local_addr()?.port();
    fs::write(port_file(pairing_file), format!("{actual}\n"))?;
    Ok(listener)
}

fn preferred_port(pairing_file: &Path) -> io::Result<u16> {
    match fs::read_to_string(port_file(pairing_file)) {
        Ok(contents) => Ok(contents
            .trim()
            .parse::<u16>()
            .ok()
            .filter(|port| *port != 0)
            .unwrap_or(DEFAULT_PORT)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(DEFAULT_PORT),
        Err(error) => Err(error),
    }
}

fn port_file(pairing_file: &Path) -> PathBuf {
    pairing_file.with_file_name("door.port")
}

#[cfg(test)]
mod tests {
    use super::{bind, engine_declaration, port_file, EnginePrivateHeaders};
    use std::fs;
    use std::net::{Ipv4Addr, TcpListener};
    use std::path::{Path, PathBuf};

    fn scratch(name: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!(
            "kalsa-brain-door-port-{}-{name}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).unwrap();
        directory.join("pairing.json")
    }

    /// A directory holding a launcher, and optionally the module file the
    /// inlet lives in. Returns the launcher's path.
    fn engine(name: &str, module: Option<&[u8]>) -> PathBuf {
        let directory = std::env::temp_dir().join(format!(
            "kalsa-brain-engine-{}-{name}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).unwrap();
        let exe = directory.join("kalsa-server");
        fs::write(&exe, b"a thin launcher").unwrap();
        if let Some(bytes) = module {
            fs::write(directory.join(kalsa_runtime::ENGINE_MODULE_FILE), bytes).unwrap();
        }
        exe
    }

    fn clean(exe: &Path) {
        if let Some(directory) = exe.parent() {
            let _ = fs::remove_dir_all(directory);
        }
    }

    #[test]
    fn the_declaration_is_read_from_the_mounted_bytes_not_declared_for_this_binary() {
        // No module beside the launcher at all: an upstream archive, a
        // Windows archive, an Intel machine. Nothing may claim a capability
        // the bytes do not carry.
        let exe = engine("no-module", None);
        assert_eq!(engine_declaration(&exe), EnginePrivateHeaders::NotConsumed);
        clean(&exe);

        // A module that carries no inlet is the same answer.
        let exe = engine("no-inlet", Some(b"a module that never heard of the door"));
        assert_eq!(engine_declaration(&exe), EnginePrivateHeaders::NotConsumed);
        clean(&exe);

        // The capitalised spelling is not the inlet: the engine lowercases
        // the header name before matching.
        let exe = engine("capitalised", Some(b"a module naming X-Kalsa-Slot only"));
        assert_eq!(engine_declaration(&exe), EnginePrivateHeaders::NotConsumed);
        clean(&exe);

        // Only the lowercase literal earns the declaration.
        let exe = engine("inlet", Some(b"a module carrying x-kalsa-slot inside"));
        assert_eq!(engine_declaration(&exe), EnginePrivateHeaders::Consumed);
        clean(&exe);
    }

    #[test]
    fn reuses_the_recorded_port_and_reports_the_bound_port() {
        let pairing_file = scratch("reuse");
        // The recorded port is one this test found free and let go, never
        // DEFAULT_PORT: on a developer's machine 8131 belongs to the running
        // app, and a test that asks for it contends with the product it is
        // testing. That is what failed here — first bind 8131, second bind
        // 51990, nothing wrong with the code.
        //
        // The gap between letting a port go and asking for it back is still
        // a gap, so a lost race retries on another port rather than being
        // reported as a defect. Three tries: a machine that loses all three
        // has something else wrong with it.
        let mut bound = None;
        for _ in 0..3 {
            let scout = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
            let wanted = scout.local_addr().unwrap().port();
            drop(scout);
            fs::write(port_file(&pairing_file), format!("{wanted}\n")).unwrap();

            let listener = bind(&pairing_file).unwrap();
            let got = listener.local_addr().unwrap().port();
            // Whether or not the preference was honoured, the file follows
            // the listener: a stale file is what sends the phone to a door
            // nothing is listening at.
            assert_eq!(
                fs::read_to_string(port_file(&pairing_file)).unwrap().trim(),
                got.to_string()
            );
            if got == wanted {
                bound = Some(got);
                break;
            }
        }
        assert!(
            bound.is_some(),
            "three recorded ports were taken between being released and asked for"
        );
    }

    #[test]
    fn records_a_new_port_when_the_preferred_one_is_taken() {
        let pairing_file = scratch("fallback");
        let occupied = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let occupied_port = occupied.local_addr().unwrap().port();
        fs::write(port_file(&pairing_file), format!("{occupied_port}\n")).unwrap();

        let replacement = bind(&pairing_file).unwrap();
        let replacement_port = replacement.local_addr().unwrap().port();
        assert_ne!(replacement_port, occupied_port);
        assert_eq!(
            fs::read_to_string(port_file(&pairing_file)).unwrap().trim(),
            replacement_port.to_string()
        );
    }
}
