use std::io::{Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant, SystemTime};

use kalsa_catalog::{Parameters, PhoneModel};
use kalsa_pairing::PhoneDeclaration;

use super::{content_length, read_request, serve, Listener};
use crate::pairing::Desk;

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "kalsa-brain-transport-{name}-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("scratch");
    dir.join("pairing.json")
}

fn phone() -> PhoneModel {
    PhoneModel {
        weights_bytes: 2_000_000_000,
        parameters: Some(Parameters::mixture(8_000_000_000, 1_000_000_000)),
        measured_tokens_per_second: Some(11.5),
        battery_powered: Some(true),
    }
}

fn setup(name: &str) -> (Arc<Desk>, Listener, String, String, String, String) {
    let desk = Arc::new(Desk::new(scratch(name)));
    let listener = serve(desk.clone()).expect("listener");
    let address = listener.address().to_string();
    let now = SystemTime::now();
    let dto = serde_json::to_value(desk.read(true, &address, now)).expect("dto");
    let qr = dto["qr_svg"].as_str().expect("page has a square");
    assert!(
        !qr.is_empty(),
        "the page must carry the square, not just ceremony state"
    );
    let payload = desk.test_square().expect("square payload");
    let value: serde_json::Value = serde_json::from_str(&payload).expect("payload");
    (
        desk,
        listener,
        address,
        value["code"].as_str().unwrap().to_string(),
        value["nonce"].as_str().unwrap().to_string(),
        value["reachable"].as_str().unwrap().to_string(),
    )
}

fn request(address: &str, method: &str, path: &str, body: &str) -> String {
    let target = address.strip_prefix("http://").unwrap();
    let mut stream = TcpStream::connect(target).expect("connect");
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    let request = format!(
        "{method} {path} HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(request.as_bytes()).unwrap();
    stream.shutdown(Shutdown::Write).unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).expect("response");
    response
}

fn body(response: &str) -> &str {
    response.split_once("\r\n\r\n").unwrap().1
}

#[test]
fn a_phone_completes_over_real_http_and_the_post_route_is_required() {
    let (desk, listener, address, code, nonce, reachable) = setup("http");
    let claim = serde_json::json!({ "code": code });
    assert!(
        request(&address, "POST", "/pair/claim", &claim.to_string()).starts_with("HTTP/1.1 200")
    );

    let declaration = PhoneDeclaration::sign(&code, &nonce, &reachable, phone()).unwrap();
    let complete = serde_json::to_string(&declaration).unwrap();
    assert!(request(&address, "GET", "/pair/complete", &complete).starts_with("HTTP/1.1 403"));

    let response = request(&address, "POST", "/pair/complete", &complete);
    assert!(response.starts_with("HTTP/1.1 200"));
    let seal: kalsa_pairing::PairingSeal = serde_json::from_str(body(&response)).unwrap();
    let credential = seal.open(&code, &nonce).expect("phone can open the seal");
    assert_eq!(credential.len(), 64);
    assert_eq!(desk.phone().unwrap().unwrap().weights_bytes, 2_000_000_000);
    listener.shutdown();
}

#[test]
fn slow_clients_do_not_block_a_second_phone() {
    let (_desk, listener, address, code, _nonce, _reachable) = setup("parallel");
    let target = address.strip_prefix("http://").unwrap();
    let mut slow = Vec::new();
    for _ in 0..3 {
        let mut stream = TcpStream::connect(target).unwrap();
        stream
            .write_all(b"POST /pair/claim HTTP/1.1\r\nContent-Length: 8192\r\n\r\n")
            .unwrap();
        slow.push(stream);
    }
    // Let the accept loop hand the slow socket to a worker before the real
    // phone arrives; with one worker this deliberately recreates the audit's
    // head-of-line block.
    let deadline = Instant::now() + Duration::from_secs(2);
    while listener.accepted_count() < 3 && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(20));
    }
    assert_eq!(listener.accepted_count(), 3);

    let claim = serde_json::json!({ "code": code });
    let response = request(&address, "POST", "/pair/claim", &claim.to_string());
    assert!(response.starts_with("HTTP/1.1 200"));
    for stream in slow {
        let _ = stream.shutdown(Shutdown::Both);
    }
    listener.shutdown();
}

#[test]
fn a_connection_has_an_absolute_deadline_even_when_bytes_trickle_in() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let client = thread::spawn(move || {
        let mut stream = TcpStream::connect(address).unwrap();
        for byte in b"GET /" {
            let _ = stream.write_all(&[*byte]);
            thread::sleep(Duration::from_millis(30));
        }
    });
    let (stream, _) = listener.accept().unwrap();
    let mut reader = std::io::BufReader::new(stream);
    assert!(read_request(&mut reader, Instant::now() + Duration::from_millis(80)).is_none());
    client.join().unwrap();
}

#[test]
fn ambiguous_http_framing_is_refused() {
    let (_desk, listener, address, code, _nonce, _reachable) = setup("framing");
    let target = address.strip_prefix("http://").unwrap();
    let mut stream = TcpStream::connect(target).unwrap();
    let body = serde_json::json!({ "code": code }).to_string();
    let raw = format!(
        "POST /pair/claim HTTP/1.1\r\nHost: localhost\r\nContent-Length: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len(),
        body.len()
    );
    stream.write_all(raw.as_bytes()).unwrap();
    stream.shutdown(Shutdown::Write).unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).unwrap();
    assert!(response.starts_with("HTTP/1.1 403"));
    listener.shutdown();
}

#[test]
fn transfer_encoding_is_not_silently_interpreted() {
    assert!(content_length("POST / HTTP/1.1\nTransfer-Encoding: chunked\n").is_none());
}
