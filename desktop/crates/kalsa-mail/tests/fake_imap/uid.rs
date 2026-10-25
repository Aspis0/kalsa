//! What the fake answers to `UID SEARCH` and `UID FETCH`. Two messages are known; which
//! of them come back is the policy the test asks for.

#[derive(Clone, Copy)]
pub enum Answers {
    /// Only the UIDs named in the set.
    Exact,
    /// Every known message from the lowest UID named upward, as the lab's fake answers a
    /// set such as "105".
    Wider,
    /// Only the newest known message, whatever was asked for.
    Other,
    /// Like `Exact`, but a header fetch leaves out the lowest UID: a server that drops one response.
    HeaderOmitsLowest,
    /// Like `Exact`, but the lowest UID's header block runs past three megabytes after its From.
    BigHeader,
    /// Like `Exact`, but the lowest UID's header block starts with a three-megabyte trace header.
    TraceFirst,
    /// Like `Exact`, but the lowest UID's From starts just before the two-kilobyte cap, so the cap falls inside it.
    CutInFrom,
}

const MESSAGES: [(u32, &str); 2] = [
    (
        105,
        "From: Giulia Serra <giulia.serra@serraconsulting.example.it>\r\nSubject: Preventivo\r\n\r\nTesto.\r\n",
    ),
    (
        115,
        "From: Banca Esempio <alert@banca-esempio.example.it>\r\nSubject: Movimento\r\n\r\nTesto.\r\n",
    ),
];

enum Part {
    Size,
    Header,
    Whole,
}

/// `rest` is what follows `UID `.
pub fn answer(tag: &str, rest: &str, answers: Answers) -> Vec<u8> {
    let mut words = rest.split_whitespace();
    match words.next() {
        Some("SEARCH") => search(tag),
        Some("FETCH") => fetch(tag, words.collect(), answers),
        _ => format!("{tag} BAD only UID SEARCH and UID FETCH are known\r\n").into_bytes(),
    }
}

/// Every known message, whatever the criteria: the account and sender reads ask for ALL.
fn search(tag: &str) -> Vec<u8> {
    let uids: Vec<String> = MESSAGES.iter().map(|(uid, _)| uid.to_string()).collect();
    format!("* SEARCH {}\r\n{tag} OK SEARCH completed\r\n", uids.join(" ")).into_bytes()
}

/// `words` is `<set> <items>`, the words after `FETCH`.
fn fetch(tag: &str, words: Vec<&str>, answers: Answers) -> Vec<u8> {
    let Some((set, items)) = words.split_first() else {
        return format!("{tag} BAD FETCH needs a set\r\n").into_bytes();
    };
    let set: Vec<u32> = set.split(',').filter_map(|uid| uid.parse().ok()).collect();
    let part = if items.iter().any(|item| item.starts_with("RFC822.SIZE")) {
        Part::Size
    } else if items.iter().any(|item| item.contains("HEADER")) {
        Part::Header
    } else {
        Part::Whole
    };

    let omits_lowest = matches!((answers, &part), (Answers::HeaderOmitsLowest, Part::Header));
    let mut out = Vec::new();
    for (seq, uid, body) in chosen(answers, &set) {
        if omits_lowest && uid == MESSAGES[0].0 {
            continue;
        }
        out.extend(match part {
            Part::Size => format!("* {seq} FETCH (UID {uid} RFC822.SIZE {})\r\n", body.len()).into_bytes(),
            Part::Header => literal(seq, uid, "BODY[HEADER]", origin_cut(&header_for(answers, uid, body), items)),
            Part::Whole => literal(seq, uid, "BODY[]", origin_cut(body.as_bytes(), items)),
        });
    }
    out.extend(format!("{tag} OK FETCH completed\r\n").into_bytes());
    out
}

/// A literal, the way the server sends bytes that can contain CRLF.
fn literal(seq: usize, uid: u32, name: &str, bytes: &[u8]) -> Vec<u8> {
    let mut out = format!("* {seq} FETCH (UID {uid} {name} {{{}}}\r\n", bytes.len()).into_bytes();
    out.extend(bytes);
    out.extend(b")\r\n");
    out
}

/// The header block through its blank line, in file order, as a server that ignores the
/// field list sends it. The header policies pad the first mail's block around its From.
fn header_for(answers: Answers, uid: u32, body: &str) -> Vec<u8> {
    let header = header_of(body);
    if uid != MESSAGES[0].0 {
        return header.as_bytes().to_vec();
    }
    let text = match answers {
        Answers::BigHeader => {
            let trace = "a".repeat(3 << 20);
            format!("Date: Thu, 15 Oct 2026 10:00:00 +0000\r\n{header}X-Trace: {trace}\r\n\r\n")
        }
        Answers::TraceFirst => {
            let trace = "a".repeat(3 << 20);
            format!("Received: {trace}\r\nDate: Thu, 15 Oct 2026 10:00:00 +0000\r\n{header}\r\n")
        }
        Answers::CutInFrom => format!(
            "Received: {}\r\nFrom: giulia.serra@serraconsulting.example.it\r\n\r\n",
            "r".repeat(1995)
        ),
        _ => header.to_string(),
    };
    text.into_bytes()
}

fn header_of(body: &str) -> &str {
    body.find("\r\n\r\n").map_or(body, |end| &body[..end + 2])
}

/// What a partial fetch `<0.N>` asks for: the first N bytes, cut as a server cuts them.
fn origin_cut<'a>(bytes: &'a [u8], items: &[&str]) -> &'a [u8] {
    let limit = items.iter().find_map(|item| {
        item.split_once("<0.")?.1.split('>').next()?.parse::<usize>().ok()
    });
    &bytes[..limit.map_or(bytes.len(), |limit| limit.min(bytes.len()))]
}

fn chosen(answers: Answers, set: &[u32]) -> Vec<(usize, u32, &'static str)> {
    let lowest = set.iter().copied().min().unwrap_or(0);
    let newest = MESSAGES.len() - 1;
    MESSAGES
        .iter()
        .enumerate()
        .filter(|(index, (uid, _))| match answers {
            Answers::Exact | Answers::HeaderOmitsLowest | Answers::BigHeader | Answers::TraceFirst | Answers::CutInFrom => {
                set.contains(uid)
            }
            Answers::Wider => *uid >= lowest,
            Answers::Other => *index == newest,
        })
        .map(|(index, (uid, body))| (index + 1, *uid, *body))
        .collect()
}
