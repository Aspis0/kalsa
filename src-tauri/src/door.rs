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
        let first = bind(&pairing_file).unwrap();
        let first_port = first.local_addr().unwrap().port();
        assert_eq!(
            fs::read_to_string(port_file(&pairing_file)).unwrap().trim(),
            first_port.to_string()
        );
        drop(first);

        let second = bind(&pairing_file).unwrap();
        assert_eq!(second.local_addr().unwrap().port(), first_port);
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
