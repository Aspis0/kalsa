//! The account line, read from the front of the standard input and nothing else.
//!
//! Byte at a time on purpose. `Stdin` keeps an 8 KiB read-ahead buffer, and the MCP
//! stream starts on the same descriptor the moment this returns: anything the buffer
//! swallowed is gone, and the server waits for a `initialize` that already arrived.

use std::io::Read;
use std::mem::ManuallyDrop;
use zeroize::Zeroizing;

/// Enough for any account line and far below the read-ahead that would eat MCP bytes.
const LIMIT: usize = 8 * 1024;

pub fn first_line() -> Result<Zeroizing<Vec<u8>>, &'static str> {
    let mut stdin = RawStdin::new();
    let mut line = Zeroizing::new(Vec::with_capacity(512));
    let mut byte = [0u8; 1];
    loop {
        match stdin.read(&mut byte) {
            Ok(0) => break,
            Ok(_) if byte[0] == b'\n' => return Ok(line),
            Ok(_) => {
                if line.len() == LIMIT {
                    return Err("the account line is longer than 8 KiB");
                }
                line.push(byte[0]);
            }
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => return Err("the account line could not be read from stdin"),
        }
    }
    if line.is_empty() {
        return Err("no account line arrived on stdin");
    }
    Ok(line)
}

/// A borrowed handle on descriptor 0. `ManuallyDrop` is what keeps it borrowed: a
/// `File` built from a raw descriptor closes that descriptor when dropped, and the
/// MCP transport is about to read from it.
struct RawStdin {
    #[cfg(unix)]
    file: ManuallyDrop<std::fs::File>,
    #[cfg(windows)]
    file: ManuallyDrop<std::fs::File>,
}

impl RawStdin {
    fn new() -> RawStdin {
        #[cfg(unix)]
        {
            use std::os::fd::{FromRawFd, RawFd};
            // SAFETY: fd 0 is open and owned by the process for its whole life, so
            // borrowing it here without ever closing it is sound.
            let file = ManuallyDrop::new(unsafe { std::fs::File::from_raw_fd(0 as RawFd) });
            RawStdin { file }
        }
        #[cfg(windows)]
        {
            use std::os::windows::io::{AsRawHandle, FromRawHandle};
            let handle = std::io::stdin().as_raw_handle();
            // SAFETY: the handle stays owned by the process; the File is never dropped.
            let file = ManuallyDrop::new(unsafe { std::fs::File::from_raw_handle(handle) });
            RawStdin { file }
        }
    }
}

impl Read for RawStdin {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        self.file.read(buf)
    }
}
