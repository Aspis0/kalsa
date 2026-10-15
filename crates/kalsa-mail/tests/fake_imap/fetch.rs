//! What the fake answers to `UID FETCH`. Two messages are known; which of them come back
//! is the policy the test asks for.

#[derive(Clone, Copy)]
pub enum Answers {
    /// Only the UIDs named in the set.
    Exact,
    /// Every known message from the lowest UID named upward, as the lab's fake answers a
    /// set such as "105".
    Wider,
    /// Only the newest known message, whatever was asked for.
    Other,
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

/// `rest` is what follows `UID `: `FETCH <set> <items>`.
pub fn answer(tag: &str, rest: &str, answers: Answers) -> Vec<u8> {
    let mut words = rest.split_whitespace();
    if words.next() != Some("FETCH") {
        return format!("{tag} BAD only UID FETCH is known\r\n").into_bytes();
    }
    let set: Vec<u32> = words
        .next()
        .unwrap_or_default()
        .split(',')
        .filter_map(|uid| uid.parse().ok())
        .collect();
    let sizes_only = words.any(|item| item.starts_with("RFC822.SIZE"));

    let mut out = Vec::new();
    for (seq, uid, body) in chosen(answers, &set) {
        if sizes_only {
            out.extend(format!("* {seq} FETCH (UID {uid} RFC822.SIZE {})\r\n", body.len()).into_bytes());
        } else {
            out.extend(format!("* {seq} FETCH (UID {uid} BODY[] {{{}}}\r\n", body.len()).into_bytes());
            out.extend(body.as_bytes());
            out.extend(b")\r\n");
        }
    }
    out.extend(format!("{tag} OK FETCH completed\r\n").into_bytes());
    out
}

fn chosen(answers: Answers, set: &[u32]) -> Vec<(usize, u32, &'static str)> {
    let lowest = set.iter().copied().min().unwrap_or(0);
    let newest = MESSAGES.len() - 1;
    MESSAGES
        .iter()
        .enumerate()
        .filter(|(index, (uid, _))| match answers {
            Answers::Exact => set.contains(uid),
            Answers::Wider => *uid >= lowest,
            Answers::Other => *index == newest,
        })
        .map(|(index, (uid, body))| (index + 1, *uid, *body))
        .collect()
}
