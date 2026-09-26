use std::collections::HashSet;
use std::time::{Duration, SystemTime};

use qrcodegen::{QrCode, QrCodeEcc};

use super::{qr_svg, QUIET_ZONE};
use crate::ceremony::Pairing;
use crate::error::PayloadTooLong;

const REACHABLE: &str = "http://192.168.1.10:4952";
const NODE: &str = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

/// A real offer, composed the way the shell will: ceremony, then square.
/// This one carries no node id — the common case while the internet road is
/// off, and the shape of every square before this release.
fn offered_svg() -> (String, String) {
    let session =
        Pairing::offer(REACHABLE, None, SystemTime::now(), Duration::from_secs(300)).unwrap();
    let payload = session.qr_payload().unwrap();
    let svg = qr_svg(&payload).unwrap();
    (payload, svg)
}

/// The same, with the internet road open: the square now carries the node
/// id the phone dials the inference road by.
fn offered_svg_with_node() -> (String, String) {
    let session = Pairing::offer(
        REACHABLE,
        Some(NODE),
        SystemTime::now(),
        Duration::from_secs(300),
    )
    .unwrap();
    let payload = session.qr_payload().unwrap();
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

    // Rasterize exactly what the shell was given: the full viewBox, modules
    // exactly where the path places them, and nothing the test invents on
    // top — no margin added here, no offsets assumed. If the symbol sits
    // where the SVG says it sits, the decoder must read the payload out of
    // that raster.
    let scale = 8i32;
    let side = (dimension * scale) as usize;
    let mut prepared = rqrr::PreparedImage::prepare_from_bitmap(side, side, |x, y| {
        modules.contains(&((x as i32) / scale, (y as i32) / scale))
    });
    let grids = prepared.detect_grids();
    assert_eq!(grids.len(), 1, "exactly one symbol in the square");
    let (_meta, decoded) = grids[0].decode().unwrap();
    // The whole chain, decoder-verified: payload → matrix → SVG → raster →
    // exactly the payload that went in.
    assert_eq!(decoded, payload);
}

#[test]
fn the_qr_holds_the_quiet_zone_on_all_four_sides() {
    let (_payload, svg) = offered_svg();
    let (dimension, modules) = svg_modules(&svg);

    // The quiet zone is not a viewBox wish; the geometry must carry it. The
    // finder patterns guarantee the extreme dark modules sit at the symbol's
    // own corners, so the bounding box below is the symbol's true extent,
    // and the spec's margin must show on all four sides of it — not pile up
    // on two.
    let min_x = modules.iter().map(|m| m.0).min().unwrap();
    let min_y = modules.iter().map(|m| m.1).min().unwrap();
    let max_x = modules.iter().map(|m| m.0).max().unwrap();
    let max_y = modules.iter().map(|m| m.1).max().unwrap();
    assert_eq!(min_x, QUIET_ZONE, "no margin on the left edge");
    assert_eq!(min_y, QUIET_ZONE, "no margin on the top edge");
    assert_eq!(max_x, dimension - QUIET_ZONE - 1, "right margin short");
    assert_eq!(max_y, dimension - QUIET_ZONE - 1, "bottom margin short");
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
                // The SVG places the symbol inside its quiet zone, so every
                // module sits at the encoder's coordinate plus the margin.
                from_encoder.insert((x + QUIET_ZONE, y + QUIET_ZONE));
            }
        }
    }
    assert_eq!(from_svg, from_encoder);
    // And the symbol is the size the arithmetic in the module header
    // promises for this payload at level M — the byte count pinned here,
    // measured from what this test builds.
    assert_eq!(payload.len(), 163, "the ceremony's own payload");
    assert_eq!(code.version().value(), 9);
}

#[test]
fn a_payload_that_does_not_fit_is_an_error_not_a_smaller_symbol() {
    // 2500 bytes fits version 40 at level L (2953) but not level M (2331):
    // the level is in force, and the answer is a refusal, not a cropped
    // square that scans into something else.
    let too_long = "x".repeat(2500);
    assert!(matches!(qr_svg(&too_long), Err(PayloadTooLong)));
    // The 163-byte payload the ceremony actually produces does fit.
    assert!(qr_svg(&offered_svg().0).is_ok());
}

#[test]
fn the_capacity_boundaries_the_header_names_are_measured() {
    // The refusal line's numbers, at the byte: level M's version-40
    // capacity fits exactly and refuses one byte more; level L's 2953 is
    // the figure the refusal test above leans on.
    let at_m = QrCode::encode_binary(&[b'x'; 2331], QrCodeEcc::Medium)
        .expect("2331 bytes fit level M at version 40");
    assert_eq!(
        at_m.version().value(),
        40,
        "2331 bytes is the version-40 symbol at level M"
    );
    assert!(
        QrCode::encode_binary(&[b'x'; 2332], QrCodeEcc::Medium).is_err(),
        "one byte past the capacity must refuse, not grow a symbol"
    );
    let at_l = QrCode::encode_binary(&[b'x'; 2953], QrCodeEcc::Low)
        .expect("2953 bytes fit level L at version 40");
    assert_eq!(
        at_l.version().value(),
        40,
        "2953 bytes is the version-40 symbol at level L"
    );
}

#[test]
fn a_square_carrying_the_node_id_decodes_from_its_rendered_svg() {
    let (payload, svg) = offered_svg_with_node();
    let (dimension, modules) = svg_modules(&svg);

    // Same honesty as the base test: the raster is exactly the rendered
    // SVG — the shell's real deliverable — with nothing the test invents.
    let scale = 8i32;
    let side = (dimension * scale) as usize;
    let mut prepared = rqrr::PreparedImage::prepare_from_bitmap(side, side, |x, y| {
        modules.contains(&((x as i32) / scale, (y as i32) / scale))
    });
    let grids = prepared.detect_grids();
    assert_eq!(grids.len(), 1);
    let (_meta, decoded) = grids[0].decode().unwrap();
    assert_eq!(decoded, payload);
    let value: serde_json::Value = serde_json::from_str(&decoded).unwrap();
    assert_eq!(value["node"], NODE);
}

#[test]
fn the_node_square_s_size_is_measured_and_stays_in_camera_reach() {
    // Measured, not assumed: the node id is 64 hex characters, and with a
    // 24-character reachable address the payload renders a version-11
    // symbol at level M — 61×61 modules, eight more per side than the
    // version-9 square of release one. A base32 node id (52 characters)
    // measures the same version 11, so the simpler hex wins. The bound
    // below is not cosmetic: a silent growth past it shrinks the modules a
    // phone camera must resolve, and goes through review.
    let (payload, svg) = offered_svg_with_node();
    let code = QrCode::encode_binary(payload.as_bytes(), QrCodeEcc::Medium).unwrap();
    assert_eq!(
        code.version().value(),
        11,
        "the node square grew past the measured size a phone camera handles"
    );
    let (dimension, _) = svg_modules(&svg);
    assert_eq!(dimension, 61 + QUIET_ZONE * 2);
}

#[test]
fn a_square_with_the_road_off_carries_no_node_id() {
    let (payload, _svg) = offered_svg();
    let value: serde_json::Value = serde_json::from_str(&payload).unwrap();
    assert!(
        value.get("node").is_none(),
        "the square promised a node id while the road was off: {payload}"
    );
}

#[test]
fn the_size_arithmetic_in_the_module_header_is_measured() {
    // The header's numbers on the square the shell actually shows:
    // `reachable` is the listener's loopback address (the shell builds it
    // from its 127.0.0.1 bind), so the byte counts and the symbol
    // versions below are measured here, not asserted in prose.
    let base = "http://127.0.0.1:8134";
    let session = Pairing::offer(base, None, SystemTime::now(), Duration::from_secs(300)).unwrap();
    let payload = session.qr_payload().unwrap();
    assert_eq!(payload.len(), 160, "the header's byte count");
    let code = QrCode::encode_binary(payload.as_bytes(), QrCodeEcc::Medium).unwrap();
    assert_eq!(code.version().value(), 9, "160 bytes at level M");

    // The desk's random fallback port is the OS's pick — four or five
    // digits; five is the worst case: one byte more than the base, the
    // same symbol version.
    let session = Pairing::offer(
        "http://127.0.0.1:12345",
        None,
        SystemTime::now(),
        Duration::from_secs(300),
    )
    .unwrap();
    let payload = session.qr_payload().unwrap();
    assert_eq!(payload.len(), 161, "five-digit fallback port byte count");
    let code = QrCode::encode_binary(payload.as_bytes(), QrCodeEcc::Medium).unwrap();
    assert_eq!(code.version().value(), 9, "161 bytes at level M");
    let high = QrCode::encode_binary(payload.as_bytes(), QrCodeEcc::High).unwrap();
    assert!(
        high.version().value() > 12,
        "level H must push the same payload past version 12"
    );

    let session = Pairing::offer(
        base,
        Some(NODE),
        SystemTime::now(),
        Duration::from_secs(300),
    )
    .unwrap();
    let payload = session.qr_payload().unwrap();
    assert_eq!(payload.len(), 234, "the open road's byte count");
    let code = QrCode::encode_binary(payload.as_bytes(), QrCodeEcc::Medium).unwrap();
    assert_eq!(code.version().value(), 11, "234 bytes at level M");
}

#[test]
fn the_qr_leaks_nothing_outside_the_symbol_itself() {
    let (payload, svg) = offered_svg();
    let value: serde_json::Value = serde_json::from_str(&payload).unwrap();
    let code_hex = value["code"].as_str().unwrap();
    let nonce_hex = value["nonce"].as_str().unwrap();

    // The secrets ride in the geometry, not the text: the SVG never spells
    // them out, though the symbol decodes to them. That contrast *is* the
    // exception this module exists for.
    assert!(svg.starts_with("<svg"));
    assert!(!svg.contains(code_hex));
    assert!(!svg.contains(nonce_hex));

    // Nothing else the module hands out renders them either.
    let error = qr_svg(&"x".repeat(2500)).unwrap_err();
    let rendered = format!("{error:?} {error}");
    assert!(!rendered.contains(code_hex));
    assert!(!rendered.contains(nonce_hex));
}
