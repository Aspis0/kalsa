use std::collections::HashSet;
use std::time::{Duration, Instant};

use qrcodegen::{QrCode, QrCodeEcc};

use super::qr_svg;
use crate::ceremony::Pairing;
use crate::error::PayloadTooLong;

const REACHABLE: &str = "http://192.168.1.10:4952";

/// A real offer, composed the way the shell will: ceremony, then square.
fn offered_svg() -> (String, String) {
    let session = Pairing::offer(Instant::now(), Duration::from_secs(300)).unwrap();
    let payload = session.qr_payload(REACHABLE).unwrap();
    let svg = qr_svg(&payload).unwrap();
    (payload, svg)
}

/// The dark modules and the inner symbol size, read back out of the SVG the
/// way a renderer would consume it: the `viewBox` and the path's pen moves.
fn svg_modules(svg: &str) -> (i32, HashSet<(i32, i32)>) {
    let dimension: i32 = svg
        .split("viewBox=\"")
        .nth(1)
        .unwrap()
        .split('"')
        .next()
        .unwrap()
        .split(' ')
        .nth(2)
        .unwrap()
        .parse()
        .unwrap();
    let path = svg.split("d=\"").nth(1).unwrap().split('"').next().unwrap();
    let mut modules = HashSet::new();
    for segment in path.split('M').filter(|s| !s.is_empty()) {
        let (x, rest) = segment.split_once(' ').unwrap();
        let y = &rest[..rest.find('h').unwrap()];
        modules.insert((x.parse().unwrap(), y.parse().unwrap()));
    }
    (dimension, modules)
}

#[test]
fn the_symbol_decodes_to_its_payload() {
    let (payload, svg) = offered_svg();
    let (dimension, modules) = svg_modules(&svg);

    // Render the SVG the way a camera would see it: each module a solid
    // block, quiet zone white, black-on-white at full contrast.
    let scale = 8i32;
    let side = (dimension * scale) as usize;
    let mut prepared = rqrr::PreparedImage::prepare_from_bitmap(side, side, |x, y| {
        let module_x = (x as i32) / scale - 4;
        let module_y = (y as i32) / scale - 4;
        modules.contains(&(module_x, module_y))
    });
    let grids = prepared.detect_grids();
    assert_eq!(grids.len(), 1, "exactly one symbol in the square");
    let (_meta, decoded) = grids[0].decode().unwrap();
    // The whole chain, decoder-verified: payload → matrix → SVG → raster →
    // exactly the payload that went in.
    assert_eq!(decoded, payload);
}

#[test]
fn the_svg_draws_exactly_the_encoders_matrix() {
    let (payload, svg) = offered_svg();
    let code = QrCode::encode_binary(payload.as_bytes(), QrCodeEcc::Medium).unwrap();
    let (_dimension, from_svg) = svg_modules(&svg);

    let mut from_encoder = HashSet::new();
    for y in 0..code.size() {
        for x in 0..code.size() {
            if code.get_module(x, y) {
                from_encoder.insert((x, y));
            }
        }
    }
    assert_eq!(from_svg, from_encoder);
    // And the symbol is the size the arithmetic in the module header
    // promises for a 165-byte payload at level M.
    assert_eq!(code.version().value(), 9);
}

#[test]
fn a_payload_that_does_not_fit_is_an_error_not_a_smaller_symbol() {
    // 2500 bytes fits version 40 at level L (2953) but not level M (2331):
    // the level is in force, and the answer is a refusal, not a cropped
    // square that scans into something else.
    let too_long = "x".repeat(2500);
    assert!(matches!(qr_svg(&too_long), Err(PayloadTooLong)));
    // The 165-byte payload the ceremony actually produces does fit.
    assert!(qr_svg(&offered_svg().0).is_ok());
}

#[test]
fn the_qr_leaks_nothing_outside_the_symbol_itself() {
    let (payload, svg) = offered_svg();
    let value: serde_json::Value = serde_json::from_str(&payload).unwrap();
    let code_hex = value["code"].as_str().unwrap();
    let binding_hex = value["binding"].as_str().unwrap();

    // The secrets ride in the geometry, not the text: the SVG never spells
    // them out, though the symbol decodes to them. That contrast *is* the
    // exception this module exists for.
    assert!(svg.starts_with("<svg"));
    assert!(!svg.contains(code_hex));
    assert!(!svg.contains(binding_hex));

    // Nothing else the module hands out renders them either.
    let error = qr_svg(&"x".repeat(2500)).unwrap_err();
    let rendered = format!("{error:?} {error}");
    assert!(!rendered.contains(code_hex));
    assert!(!rendered.contains(binding_hex));
}
