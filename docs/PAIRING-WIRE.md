# The pairing wire, byte for byte (from the desktop, 2026-09-24)

Provenance: the desktop's session quoted every line of `crates/kalsa-pairing` (`messages.rs`,
`secret.rs`) and `src-tauri/src/transport*.rs`, then **reimplemented the recipe independently in Python**
and reproduced all three vectors frozen in the Rust tests (`crates/kalsa-pairing/src/messages/tests.rs`)
plus the RFC 4231 HMAC case. Vector D is its Python only and is not frozen in Rust yet.

**Why this file exists**: with these vectors the phone's ceremony is testable **offline**, on a laptop,
before the road exists. That is what makes the client buildable now and the camera buildable later.

## The MAC (phone to computer)

```
key   = hex_decode(square.code)    -> 16 bytes  (code is 32 lowercase hex chars)
nonce = hex_decode(square.nonce)   -> 32 bytes  (64 hex chars)
mac   = HMAC-SHA256(key, DOMAIN || nonce || payload)
DOMAIN = ASCII "kalsa-pairing/phone-mac/v3"      (no separators, no terminator)

payload = F(reachable) || F(node) || F(delivery_token) || F(canonical)
F(x)    = 8-byte BIG-ENDIAN length of x, then x's bytes

reachable      = the square's string EXACTLY as scanned, UTF-8 (today "http://127.0.0.1:<port>")
node           = the square's node hex string, or the EMPTY string when the square has none (length 0)
delivery_token = the 32-char lowercase hex STRING, as ASCII — not decoded
canonical      = compact JSON, no whitespace, keys in THIS order:
   {"weights_bytes":<u64>,"parameters":{"total":<u64>,"active":<u64>} or null,
    "measured_tokens_per_second":<f64> or null,"battery_powered":<bool> or null}
   Absent values are null, never omitted.
mac on the wire = 64 lowercase hex chars.
```

### Trap 1 — the float, and it fails silently
The desk does **not** verify against our bytes: it parses our JSON, **re-serializes it with Rust
`serde_json`** and verifies against that (`messages.rs:339`). `serde_json` writes an integral `f64` as
`10.0`; JavaScript's `JSON.stringify` writes `10`. So an integral
`measured_tokens_per_second` makes our canonical string differ from the desk's and the ceremony is refused
with no explanation. **Our canonical writer emits integral floats with `.0`, or sends null.** Non-integral
values such as `9.5` render identically in both.

### Trap 2 — precision
`weights_bytes` and `parameters` are `u64`. Stay below 2^53 in JS, or build that part of the JSON from
strings.

## The two requests (to the DESK's URL)

```
POST /pair/claim     {"code":"<32 hex>"}
  -> 200, body {}                       Content-Type: application/json, Connection: close

POST /pair/complete  {"phone":{...canonical fields...},"mac":"<64 hex>","delivery_token":"<32 hex>"}
  -> 200, {"credential_ciphertext":"<64 hex>","mac":"<64 hex>"}
```

The **phone mints the `delivery_token`**: 16 random bytes, lowercase hex. Keep it: a retry of `complete`
re-sends the **same** token, and only if the 200 never arrived.

**Every failure is byte-identical**:
`HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n` — and that one response covers a
wrong route or method, bad JSON, a wrong code, not claimed, expired, a bad MAC, the desk not serving, a full
queue and an oversize body. **The phone cannot tell which one it was, by design**, so no copy of ours may
suggest it knows.

Limits: body at most 8 KiB measured by `Content-Length`, head at most 8 KiB. `Transfer-Encoding`, a
duplicate `Content-Length`, or bytes beyond `Content-Length` are refused with the same 403. **Always send a
`Content-Length`.**

## What the declaration means on the desktop, corrected (2026-09-24)

The desktop's upgrade judgement reads **`weights_bytes` alone**: a model on the computer must weigh at
least 1.4× the phone's GGUF. So a **real** file size makes that judgement real, and **`0` is the value that
breaks it** — zero would make every model on the computer count as an upgrade.

`parameters` and `measured_tokens_per_second` being null does **not** cause that: nulls mean the desktop makes
no capability claim and states no speed comparison. If an upgrade list ever looks wrong, the cause is a wrong
`weights_bytes`, not the nulls — a sentence worth keeping because I wrote the opposite once, and the difference
between a declaration and a comparison is exactly the kind of thing a hurried session flattens.

## The seal (the phone opens it)

```
stream_key = HMAC-SHA256(key, "kalsa-pairing/credential-encryption/v1" || nonce || "key")
block_i    = HMAC-SHA256(stream_key, "kalsa-pairing/credential-stream/v1" || nonce || u64_be(i))
credential = ciphertext XOR (block_0 || block_1 || ...)
```
The ciphertext MUST be exactly 32 bytes; anything else is refused. **Before decrypting**, check
`seal.mac == HMAC-SHA256(key, "kalsa-pairing/computer-mac/v2" || nonce || ciphertext)` — over the
**ciphertext** — compared in constant time. On success we hold a 32-byte credential (the desktop's own
representation is 64 lowercase hex), and we present it to the **DOOR** as a bearer credential. The Allow gate
applies: an empty 401 until the owner allows.

## Vectors

| | case | expected |
|---|---|---|
| **A** (Rust-frozen) | key `0x31`×16 (code `"31"`×16), nonce `0x32`×32, reachable `http://192.168.1.10:4952`, node `""`, token `""`, canonical `{"weights_bytes":2200000000,"parameters":{"total":7600000000,"active":2400000000},"measured_tokens_per_second":9.5,"battery_powered":true}` | mac `51e82d91c365352b430a40533ec8ea76966762ac1413557712e110889b44905e` |
| **B** (Rust-frozen) | A plus node `9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08` | mac `0503754d7ad8a465ffcf82506231bf961da877ff802087c8f8c5756da0de0d83` |
| **C** (Rust-frozen) | seal: key `0x41`×16, nonce `0x42`×32, credential `0xab`×32 | ciphertext `19d0b3455e311a70ba202aea83ea569e8127f2f1936f67bdc557439a82222ba7`, seal mac `6d86a29391e258de9bb13dae9ceb3612143c4448050562a36ad2e6ac8dd4a849`, opens to `ab`×32 |
| **D** (Python only) | the real shape: key/nonce as A, reachable `http://127.0.0.1:8132`, node `""`, token `c0c0…c0` (32 hex), same canonical | mac `ad34a8b2731b0a0e3d41f09d498e4f206333c1c1a67d3421f62b0659324f4132` |

D's signed payload, as hex, for anyone porting this without the Python:
`0000000000000015687474703a2f2f3132372e302e302e313a38313332000000000000000000000000000000206330633063306330633063306330633063306330633063306330633063306330000000000000008a7b22776569676874735f6279746573223a323230303030303030302c22706172616d6574657273223a7b22746f74616c223a373630303030303030302c22616374697665223a323430303030303030307d2c226d656173757265645f746f6b656e735f7065725f7365636f6e64223a392e352c22626174746572795f706f7765726564223a747275657d`

And its bodies:
```
claim    {"code":"31313131313131313131313131313131"}
complete {"phone":{"weights_bytes":2200000000,"parameters":{"total":7600000000,"active":2400000000},"measured_tokens_per_second":9.5,"battery_powered":true},"mac":"ad34a8b2731b0a0e3d41f09d498e4f206333c1c1a67d3421f62b0659324f4132","delivery_token":"c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0"}
```

**Pin A, B and C first** (they are frozen in Rust), then D — and if our TypeScript agrees with A and B and
disagrees with D, **say so before assuming D is wrong**: the frozen vectors use an empty token while a real
declaration always carries one, which is exactly where a port goes subtly wrong.
