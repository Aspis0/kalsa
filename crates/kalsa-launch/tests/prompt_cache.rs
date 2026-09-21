//! Measured, not deduced: what does the second turn of a conversation cost?
//!
//! A real `llama-server` (the shipped build) answers a long first prompt,
//! then a conversation continuation whose input is the first prompt plus
//! the answer plus a new turn — the exact shape of turn N+1. The server's
//! own `timings` tell how many prompt tokens it actually computed. If the
//! prompt cache works, turn 2 pays only the new tail; if not, it pays the
//! whole conversation again. The alternation A,B,A,B asks the same question
//! with two conversations fighting for the slot, and one continuation is
//! sent through the real door to ask whether the door breaks the match.
//!
//! The argv is the crate's own launch plan — no flag is added, none is
//! removed; only the context size is this harness's, so the conversation
//! fits. For measuring candidate configurations (harness-only, never the
//! shipped plan) the environment can append flags and vary the harness:
//!
//! ```text
//! KALSA_MEASURE_ARGS="--cache-reuse 256"   extra flags, appended verbatim
//! KALSA_MEASURE_CTX=16384                  overrides the harness context
//! KALSA_MEASURE_PARAGRAPHS=30              shorter conversations
//! KALSA_MEASURE_QUICK=1                    warmup + first turn only (sweeps)
//! KALSA_MEASURE_LAYOUT=four                four conversations, then all four
//!                                          continuations, with the server's
//!                                          RSS sampled between the phases
//! ```
//!
//! Ignored by default, one model at a time, thermal level printed before and
//! after:
//!
//! ```text
//! KALSA_REAL_SERVER=/path/to/llama-server \
//! KALSA_REAL_MODEL=/path/to/model.gguf \
//! cargo test -p kalsa-launch --test prompt_cache -- --ignored --nocapture
//! ```

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use kalsa_launch::{KvCache, Offload, ServerArgs};

/// Findable, and clear of the supervisor's 8137 and the sibling's 8138.
const PORT: u16 = 8139;
const HEALTH_DEADLINE: Duration = Duration::from_secs(120);
/// A long prefill plus a full generation is one non-streaming response.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
/// Room for a conversation of a few thousand tokens. This harness's only
/// launch-plan input; every other argument is the crate's own.
const CONTEXT_TOKENS: u64 = 8192;
/// Short answers: the measurement is about prefill, and less decoding is
/// less heat.
const MAX_TOKENS: u32 = 32;

/// Kills the child on every path, drop runs even when an assert panics: no
/// orphaned server is left holding a port and a few GiB of RAM.
struct ServerChild(Child);

impl Drop for ServerChild {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[test]
#[ignore = "runs the real llama-server; set KALSA_REAL_SERVER and KALSA_REAL_MODEL"]
fn the_second_turn_is_measured_against_the_first() {
    let Some(exe) = std::env::var("KALSA_REAL_SERVER").ok().filter(|s| !s.is_empty()) else {
        eprintln!("skipped: set KALSA_REAL_SERVER to a llama-server binary");
        return;
    };
    let Some(model) = std::env::var("KALSA_REAL_MODEL").ok().filter(|s| !s.is_empty()) else {
        eprintln!("skipped: set KALSA_REAL_MODEL to the model the app runs");
        return;
    };

    let extra_args: Vec<String> = std::env::var("KALSA_MEASURE_ARGS")
        .unwrap_or_default()
        .split_whitespace()
        .map(str::to_string)
        .collect();
    let context_tokens: u64 = std::env::var("KALSA_MEASURE_CTX")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(CONTEXT_TOKENS);
    let paragraphs: usize = std::env::var("KALSA_MEASURE_PARAGRAPHS")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(60);
    let quick = std::env::var("KALSA_MEASURE_QUICK").is_ok_and(|value| value == "1");
    // The harness context is fixed at 8192; 1536 MiB kept four 4.5k-token
    // conversations warm. Production derives its own roof from the budget
    // (see policy); this env is for measuring other roofs.
    let cache_ram_mib: u64 = std::env::var("KALSA_MEASURE_CACHE_RAM")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(1536);
    eprintln!(
        "variant: extra_args={extra_args:?} ctx={context_tokens} cache_ram={cache_ram_mib} paragraphs={paragraphs} quick={quick}"
    );

    let args = ServerArgs {
        model_path: PathBuf::from(&model),
        port: PORT,
        context_tokens,
        cache_ram_mib,
        threads: Some(4),
        offload: Offload::All,
        idle_unload_seconds: 300,
        batch_size: 2048,
        ubatch_size: 512,
        kv_cache: KvCache::Q8_0,
        parallel: kalsa_launch::DEFAULT_PARALLEL,
        // A real directory, because the engine refuses a `--slot-save-path`
        // that is not one. This harness exercises the RAM prompt cache, not
        // the save routes, so the shared temp directory is enough.
        slot_save_path: std::env::temp_dir(),
    };
    let mut argv = args.argv();
    // Harness-only variants, appended after the plan: what a changed launch
    // plan would carry, measured before it is proposed.
    argv.extend(extra_args.clone());
    let argv = argv;
    eprintln!("argv: {argv:?}");

    let stderr_path = std::env::temp_dir().join(format!("kalsa-prompt-cache-{}.log", PORT));
    let stdout_path = std::env::temp_dir().join(format!("kalsa-prompt-cache-{}.out.log", PORT));
    let stderr = std::fs::File::create(&stderr_path).expect("create the server log file");
    let stdout = std::fs::File::create(&stdout_path).expect("create the server stdout file");
    let mut child = ServerChild(
        Command::new(&exe)
            .args(&argv)
            .stdout(Stdio::from(stdout))
            .stderr(Stdio::from(stderr))
            .spawn()
            .expect("spawn the real llama-server"),
    );
    let addr = SocketAddr::from(([127, 0, 0, 1], PORT));
    wait_until_healthy(&mut child, &addr, &stderr_path);
    for path in [&stderr_path, &stdout_path] {
        for line in std::fs::read_to_string(path)
            .unwrap_or_default()
            .lines()
            .filter(|line| {
                let lower = line.to_ascii_lowercase();
                lower.contains("kv") || lower.contains("mib") || lower.contains("slots")
            })
        {
            eprintln!("server: {line}");
        }
    }

    thermal("before");
    // One tiny turn first: Metal shader compilation is a one-off cost that
    // must not sit inside the first measured prefill.
    let warmup = chat(&addr, None, &[("user", "Reply with the single word OK.")]);
    assert_eq!(warmup.status, 200, "warmup answered");
    eprintln!("warmup  timings: {}", warmup.timings);
    if quick {
        let c1 = chat(&addr, None, &[("user", long_text("cedar", paragraphs).as_str())]);
        eprintln!("C1      timings: {}", c1.timings);
        thermal("after");
        return;
    }
    if std::env::var("KALSA_MEASURE_LAYOUT").is_ok_and(|value| value == "four") {
        four_conversations(&addr, child.0.id(), paragraphs);
        thermal("after");
        return;
    }

    // Two conversations with different long pasts, alternated the way two
    // people or two tabs would alternate on one machine.
    // First the base case, with nothing in between: C2 follows C1
    // immediately. Whatever this shows, the alternation below then shows
    // what two conversations do to it.
    let c_text = long_text("cedar", paragraphs);
    let c_question = "In one short sentence, what is this archive about?";
    let c1_prompt = format!("{c_text}\n\n{c_question}");
    let c1 = chat(&addr, None, &[("user", c1_prompt.as_str())]);
    eprintln!("C1      timings: {}", c1.timings);
    let c2 = chat(
        &addr,
        None,
        &[
            ("user", c1_prompt.as_str()),
            ("assistant", c1.answer.as_str()),
            ("user", "Which detail in it mentions the weather?"),
        ],
    );
    eprintln!("C2      timings: {}", c2.timings);

    // The door question, with the cache provably alive: D1 is direct, D2
    // is the same conversation's next turn through the real door, sent
    // immediately after. If the door stripped or rewrote anything the
    // prefix match needs, D2 pays the whole prefill while C2 did not.
    let d_text = long_text("dogwood", paragraphs);
    let d_question = "In one short sentence, what is this archive about?";
    let d1_prompt = format!("{d_text}\n\n{d_question}");
    let d1 = chat(&addr, None, &[("user", d1_prompt.as_str())]);
    eprintln!("D1      timings: {}", d1.timings);
    let credential = "a".repeat(64);
    let listener = TcpListener::bind("127.0.0.1:0").expect("the door binds loopback");
    let entry = kalsa_door::DeviceEntry::new(
        kalsa_door::DeviceId::new(0),
        "test device",
        credential.clone(),
    )
    .expect("a valid test credential");
    let devices = kalsa_door::Devices::new(vec![entry]).expect("a valid device set");
    let running = kalsa_door::Door::new(
        listener,
        PORT,
        devices,
        kalsa_launch::DEFAULT_PARALLEL,
    )
    .expect("the door accepts its credential")
    .start()
    .expect("the door starts");
    let d2 = chat(
        &addr,
        Some((&running.address(), &credential)),
        &[
            ("user", d1_prompt.as_str()),
            ("assistant", d1.answer.as_str()),
            ("user", "Which detail in it mentions the weather?"),
        ],
    );
    eprintln!("D2 door timings: {}", d2.timings);
    running.shutdown();

    let a_text = long_text("alder", paragraphs);
    let b_text = long_text("beech", paragraphs);
    let a_question = "In one short sentence, what is this archive about?";
    let a_followup = "And which detail in it mentions the weather?";
    let b_question = "In one short sentence, what does this ledger record?";
    let b_followup = "Which animal appears in it?";

    let a1_prompt = format!("{a_text}\n\n{a_question}");
    let a1 = chat(&addr, None, &[("user", a1_prompt.as_str())]);
    eprintln!("A1      timings: {}", a1.timings);
    let b1_prompt = format!("{b_text}\n\n{b_question}");
    let b1 = chat(&addr, None, &[("user", b1_prompt.as_str())]);
    eprintln!("B1      timings: {}", b1.timings);

    let a2_messages = vec![
        ("user", a1_prompt.as_str()),
        ("assistant", a1.answer.as_str()),
        ("user", a_followup),
    ];
    let a2 = chat(&addr, None, &a2_messages);
    eprintln!("A2      timings: {}", a2.timings);
    let b2_messages = vec![
        ("user", b1_prompt.as_str()),
        ("assistant", b1.answer.as_str()),
        ("user", b_followup),
    ];
    let b2 = chat(&addr, None, &b2_messages);
    eprintln!("B2      timings: {}", b2.timings);

    thermal("after");
    assert_eq!(a1.status, 200, "A1 answered");
    assert_eq!(a2.status, 200, "A2 answered");
    assert!(!a2.answer.is_empty(), "A2 said something");
    let _ = std::fs::remove_file(&stderr_path);
    let _ = std::fs::remove_file(&stdout_path);
}

struct Response {
    status: u16,
    answer: String,
    /// The server's own timings object, verbatim.
    timings: String,
}

/// One non-streaming chat completion over a fresh connection, direct or
/// through the door, with the response body parsed for answer and timings.
fn chat(addr: &SocketAddr, via_door: Option<(&SocketAddr, &str)>, messages: &[(&str, &str)]) -> Response {
    let mut body = serde_json::Map::new();
    body.insert(
        "messages".to_string(),
        serde_json::Value::Array(
            messages
                .iter()
                .map(|(role, content)| {
                    serde_json::json!({"role": role, "content": content})
                })
                .collect(),
        ),
    );
    body.insert("max_tokens".to_string(), serde_json::json!(MAX_TOKENS));
    let body = serde_json::Value::Object(body).to_string();

    let target = via_door.map_or(addr, |(door, _)| door);
    let mut request = format!(
        "POST /v1/chat/completions HTTP/1.1\r\nHost: 127.0.0.1:{}\r\n",
        target.port()
    );
    if let Some((_, credential)) = via_door {
        request.push_str(&format!("Authorization: Bearer {credential}\r\n"));
    }
    request.push_str(&format!(
        "Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    ));

    let mut stream = TcpStream::connect_timeout(target, REQUEST_TIMEOUT)
        .expect("the request connects");
    let _ = stream.set_read_timeout(Some(REQUEST_TIMEOUT));
    let _ = stream.set_write_timeout(Some(REQUEST_TIMEOUT));
    stream.write_all(request.as_bytes()).expect("request written");
    let mut raw = Vec::new();
    stream.read_to_end(&mut raw).expect("response read");

    let text = String::from_utf8_lossy(&raw);
    let (head, response_body) = text
        .split_once("\r\n\r\n")
        .expect("a well-formed HTTP response");
    let status: u16 = head
        .split_whitespace()
        .nth(1)
        .and_then(|code| code.parse().ok())
        .expect("a status line");
    let lower = head.to_ascii_lowercase();
    let response_body = if lower.contains("transfer-encoding: chunked") {
        dechunk(response_body)
    } else {
        response_body.to_string()
    };
    let json: serde_json::Value = serde_json::from_str(&response_body).expect("a JSON body");
    let answer = json["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    Response {
        status,
        answer,
        timings: json["timings"].to_string(),
    }
}

/// A minimal chunked-body reader for the test's one response shape.
fn dechunk(body: &str) -> String {
    let bytes = body.as_bytes();
    let mut out = Vec::new();
    let mut cursor = 0;
    while let Some(line_end) = find(bytes, b"\r\n", cursor) {
        let size_text = std::str::from_utf8(&bytes[cursor..line_end]).unwrap_or("");
        let Ok(size) = usize::from_str_radix(size_text.split(';').next().unwrap_or("").trim(), 16)
        else {
            break;
        };
        if size == 0 {
            break;
        }
        let start = line_end + 2;
        if bytes.len() < start + size {
            break;
        }
        out.extend_from_slice(&bytes[start..start + size]);
        cursor = (start + size + 2).min(bytes.len());
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn find(haystack: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    (from..=haystack.len().saturating_sub(needle.len()))
        .find(|index| &haystack[*index..index + needle.len()] == needle)
}

/// The whole conversation as one user turn plus the new question.
fn long_text(seed: &str, paragraphs: usize) -> String {
    let mut text = format!("Notes on the {seed} archive.\n\n");
    for index in 0..paragraphs {
        text.push_str(&format!(
            "Entry {index} of the {seed} series records an ordinary season: the road, \
             the weather, the price of bread, a letter that arrived late. Nothing in \
             this paragraph is important; it exists so a conversation has a long past \
             to carry. The {seed} ledger mentions a bridge, two mills, a festival that \
             moved indoors because of rain, and a violin left on a train.\n\n"
        ));
    }
    text
}

/// Thermal warnings, before and after: if the machine throttled, this says
/// so. `pmset -g therm` answers without privileges.
fn thermal(label: &str) {
    match Command::new("pmset").arg("-g").arg("therm").output() {
        Ok(output) => {
            eprintln!(
                "--- thermal {label} ---\n{}",
                String::from_utf8_lossy(&output.stdout).trim_end()
            );
        }
        Err(error) => eprintln!("--- thermal {label}: pmset unavailable: {error}"),
    }
}

/// Four distinct conversations, each a few thousand tokens, then all four
/// continuations: the question is how many chats stay warm on one slot, and
/// what the prompt cache does to the server's own memory on the way.
fn four_conversations(addr: &SocketAddr, server_pid: u32, paragraphs: usize) {
    let seeds = ["alder", "beech", "cedar", "dogwood"];
    let followups = [
        "Which detail in it mentions the weather?",
        "What does the ledger say about the mills?",
        "Where did the festival move, and why?",
        "What was left on the train?",
    ];
    let question = "In one short sentence, what is this archive about?";
    let mut turns: Vec<(String, String)> = Vec::new();
    for seed in seeds {
        let prompt = format!("{}\n\n{question}", long_text(seed, paragraphs));
        let response = chat(addr, None, &[("user", prompt.as_str())]);
        eprintln!("{seed}1     timings: {}", response.timings);
        turns.push((prompt, response.answer));
    }
    eprintln!("rss after the four first turns: {} KB", rss_kb(server_pid));
    for (index, seed) in seeds.iter().enumerate() {
        let (prompt, answer) = &turns[index];
        let response = chat(
            addr,
            None,
            &[
                ("user", prompt.as_str()),
                ("assistant", answer.as_str()),
                ("user", followups[index]),
            ],
        );
        eprintln!("{seed}2     timings: {}", response.timings);
    }
    eprintln!("rss after the four continuations: {} KB", rss_kb(server_pid));
}

/// The server child's resident memory, for watching the prompt cache grow.
fn rss_kb(pid: u32) -> u64 {
    Command::new("ps")
        .args(["-o", "rss=", "-p", &pid.to_string()])
        .output()
        .ok()
        .and_then(|output| String::from_utf8_lossy(&output.stdout).trim().parse().ok())
        .unwrap_or(0)
}

fn wait_until_healthy(child: &mut ServerChild, addr: &SocketAddr, stderr_path: &PathBuf) {
    let deadline = Instant::now() + HEALTH_DEADLINE;
    loop {
        if let Some(status) = child.0.try_wait().expect("poll the server") {
            panic!(
                "the server exited before answering /health ({status}): {}",
                stderr_tail(stderr_path)
            );
        }
        if get_status(addr, "/health") == Some(200) {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "the server did not answer /health: {}",
            stderr_tail(stderr_path)
        );
        std::thread::sleep(Duration::from_millis(250));
    }
}

fn get_status(addr: &SocketAddr, path: &str) -> Option<u16> {
    let mut stream = TcpStream::connect_timeout(addr, REQUEST_TIMEOUT).ok()?;
    let _ = stream.set_read_timeout(Some(REQUEST_TIMEOUT));
    write!(
        stream,
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    )
    .ok()?;
    let mut response = Vec::new();
    stream.read_to_end(&mut response).ok()?;
    String::from_utf8_lossy(&response)
        .split_whitespace()
        .nth(1)
        .and_then(|code| code.parse().ok())
}

/// The server's own last words, for the failure message.
fn stderr_tail(path: &std::path::Path) -> String {
    let Ok(text) = std::fs::read_to_string(path) else {
        return "(no server output)".to_string();
    };
    let lines: Vec<&str> = text.lines().collect();
    let start = lines.len().saturating_sub(5);
    lines[start..].join(" | ")
}
