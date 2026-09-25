//! The square: the ceremony's payload as the symbol a phone camera reads.
//!
//! This module is the one exception to the crate's redaction rule, and it
//! must stay one. Everywhere else, a `Debug` that prints a secret is a leak;
//! here the payload — the one-time code and the binding secret in the clear
//! — *is* the deliverable, because the phone reads its copy of those secrets
//! off the screen with a camera. Two consequences, written down so nobody
//! later "fixes" either:
//!
//! * the returned SVG never contains the secrets as text — they exist only
//!   as the geometry of dark modules — yet the symbol decodes to them. The
//!   string is safer to hold than the JSON it was built from, and must never
//!   be logged all the same;
//! * the symbol, once on screen, is the ceremony's own terms: anyone who can
//!   see it can pair. That is the product decision documented in `secret`,
//!   not a defect here.
//!
//! Size arithmetic, measured rather than guessed — `tests` encodes real
//! payloads and pins every number below: `payload::encode` emits
//! `{"v":3,"reachable":"http://127.0.0.1:4952","code":"<32 hex>","nonce":"<64 hex>"}`
//! — 160 bytes with the shell's loopback address; an open road appends
//! `,"node":"<64 hex>"` for 234. Error-correction level M (15% of
//! codewords recoverable) is deliberate: the scan happens in calm
//! conditions, and level H would push the same payload past version 12,
//! buying robustness a single-use, windowed code does not need — a
//! damaged scan costs a re-scan, nothing else. Level M carries those 160
//! bytes at version 9 (53×53 modules) and the 234-byte node square at
//! version 11 (61×61), and refuses — [`PayloadTooLong`], never a
//! truncated symbol — past version 40 (2331 bytes). If the payload ever
//! outgrows its QR, the remedy is upstream in `payload`: the 48 bytes of
//! hex overhead on the code and binding could ride as raw bytes instead.

use qrcodegen::{QrCode, QrCodeEcc};

use crate::error::PayloadTooLong;

/// The quiet zone the QR spec requires around the symbol, in modules.
const QUIET_ZONE: i32 = 4;

/// Encode the payload as a QR symbol, as SVG the shell can drop straight
/// into the window: black modules on white, `shape-rendering="crispEdges"`,
/// and a `viewBox` in module units so CSS sizes it without resampling. One
/// byte-mode segment, error-correction level M — see the size arithmetic
/// above for why.
pub fn qr_svg(payload: &str) -> Result<String, PayloadTooLong> {
    let code =
        QrCode::encode_binary(payload.as_bytes(), QrCodeEcc::Medium).map_err(|_| PayloadTooLong)?;
    let size = code.size();
    let dimension = size + QUIET_ZONE * 2;
    let mut dark = String::new();
    for y in 0..size {
        for x in 0..size {
            if code.get_module(x, y) {
                // Every module is placed inside the quiet zone: the margin
                // the viewBox promises must exist on all four sides — a
                // decoder finds the symbol's edges by it.
                dark.push_str(&format!("M{} {}h1v1h-1", x + QUIET_ZONE, y + QUIET_ZONE));
            }
        }
    }
    Ok(format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {dimension} {dimension}\" \
         shape-rendering=\"crispEdges\">\
         <rect width=\"{dimension}\" height=\"{dimension}\" fill=\"#ffffff\"/>\
         <path fill=\"#000000\" d=\"{dark}\"/></svg>"
    ))
}

#[cfg(test)]
mod tests;
