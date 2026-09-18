//! Choose and remember the local port for the authenticated door.
//!
//! The door crate receives the listener after this module binds it. Keeping
//! port selection here makes the caller responsible for persistence while the
//! door remains responsible for validating the address it was handed.

use std::fs;
use std::io;
use std::net::{Ipv4Addr, TcpListener};
use std::path::{Path, PathBuf};

const DEFAULT_PORT: u16 = 8131;

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
    use super::{bind, port_file};
    use std::fs;
    use std::net::{Ipv4Addr, TcpListener};
    use std::path::PathBuf;

    fn scratch(name: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!(
            "kalsa-brain-door-port-{}-{name}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).unwrap();
        directory.join("pairing.json")
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
