/**
 * The screen that runs before the put: a phone body keeps only the lines in the
 * client's own shapes, both bodies are redacted, and only the counts of what
 * went out reach the object metadata — never the text.
 */

import worker from "./index";
import { CLIENT_IP, REPORT_URL, VALID_APP, errorBody, fakeEnv, post } from "./fakes";

const PHONE_APP = "1.4.2/android/arm64";
const DESKTOP_APP = VALID_APP; // 0.9.1/macos/arm64

/** A real `finalizeLine` output (src/logReport/normalize.ts). */
const phoneLine = (json: string, stamp = "2026-10-16T14:49:27.123Z") =>
  `${stamp} KALSA_LOAD ${json}`;
const LOAD = phoneLine('{"component":"engine","stage":"load"}');
const STALL = phoneLine('{"stage":"prefill"}', "2026-10-16T14:50:02.400Z");

const SEPARATOR = "──────── earlier log ────────";

/** What must not survive in a stored line, whatever shape it arrived in. */
const TOKEN_FRAGMENTS = [
  "marco@example.com",
  "marco\\u0040example.com",
  "marco%40example.com",
  "10.0.0.7",
  "10\\u002e0\\u002e0\\u002e7",
  "Users\\\\marco",
  "Users\\/marco",
  "token=abc",
];

/**
 * A phone line whose payload sits exactly at the clip ceiling — the one payload
 * length the gate keeps without it parsing, and the one an attacker can hit by
 * counting characters. Padding is `a`, so the line is 325 characters, the cap.
 */
const clippedLine = (head: string, tag = "KALSA_ROAD") =>
  `2026-10-16T14:49:27.123Z ${tag} ${head}${"a".repeat(300 - tag.length - 1 - head.length)}`;

const storedText = (puts: { value: Uint8Array }[]) => new TextDecoder().decode(puts[0].value);
const metadata = (puts: { options?: { customMetadata?: Record<string, string> } }[]) =>
  puts[0].options?.customMetadata ?? {};

describe("the phone line gate", () => {
  test("a phone body keeps its KALSA lines and drops prose, counted not stored", async () => {
    const { env, puts } = fakeEnv();
    const res = await post(env, `${LOAD}\nthe tester pasted a private note\n${STALL}\n`, {
      "x-kalsa-app": PHONE_APP,
    });
    expect(res.status).toBe(201);
    expect(storedText(puts)).toBe(`${LOAD}\n${STALL}`);
    expect(storedText(puts)).not.toContain("private note");
    expect(metadata(puts)).toMatchObject({ dropped: "1", redacted: "0" });
  });

  test("the same body from a desktop header is stored whole: the os decides", async () => {
    const { env, puts } = fakeEnv();
    const body = `${LOAD}\nthe tester pasted a private note\n${STALL}\n`;
    const res = await post(env, body, { "x-kalsa-app": DESKTOP_APP });
    expect(res.status).toBe(201);
    expect(storedText(puts)).toBe(body);
    expect(metadata(puts).dropped).toBe("0");
  });

  test("every js_error line the phone writes is kept: those are the crashes", async () => {
    // The second writer (recordJsError -> formatJsErrorLine), the reason the
    // report exists at all. Names and bundle basenames come from the client's
    // SAFE_NAMES / BUNDLE_BASENAMES; digits in a name must not lose the line.
    const crashes = [
      "js_error name=TypeError frame=index.bundle:42:7",
      "js_error name=Sha256VerificationUnavailableError frame=index.android.bundle:1:2",
      "js_error name=Error frame=none",
      "js_error name=TypeError frame=main.jsbundle:9:9",
    ].map((record) => `2026-10-16T14:49:27.123Z ${record}`);
    const { env, puts } = fakeEnv();
    const res = await post(env, `${crashes.join("\n")}\n${LOAD}\n`, {
      "x-kalsa-app": PHONE_APP,
    });
    expect(res.status).toBe(201);
    expect(storedText(puts)).toBe([...crashes, LOAD].join("\n"));
    expect(metadata(puts).dropped).toBe("0");
  });

  test("a js_error line carrying anything else is still dropped", async () => {
    const { env, puts } = fakeEnv();
    const forged = [
      "js_error name=marco@example.com frame=none", // an address in the name
      "js_error name=TypeError frame=/Users/marco/src/index.js:1:2", // a path
      "js_error name=TypeError frame=index.bundle:42:7 and the answer was 42", // prose
      "js_error the model answered 42",
    ].map((record) => `2026-10-16T14:49:27.123Z ${record}`);
    const res = await post(env, `${forged.join("\n")}\n`, { "x-kalsa-app": PHONE_APP });
    expect(res.status).toBe(201);
    expect(storedText(puts)).toBe("");
    expect(metadata(puts).dropped).toBe(String(forged.length));
  });

  test("a line that only looks like a phone line is dropped", async () => {
    const { env, puts } = fakeEnv();
    // Right prefix, wrong tag, prose, and an object cut short at no clip length.
    const forged = [
      "2026-10-16T14:49:27.123Z NOT_KALSA {\"a\":1}",
      "2026-10-16T14:49:27.123Z KALSA_LOAD {\"a\":",
      "KALSA_LOAD {\"component\":\"engine\"}",
      "the answer to the question was 42",
    ];
    const res = await post(env, `${LOAD}\n${forged.join("\n")}\n`, { "x-kalsa-app": PHONE_APP });
    expect(res.status).toBe(201);
    expect(storedText(puts)).toBe(LOAD);
    expect(metadata(puts).dropped).toBe(String(forged.length));
  });

  test("a phone line clipped mid-object at the client's own limit is kept", async () => {
    const { env, puts } = fakeEnv();
    // finalizeLine clips `TAG {json}` — the timestamp is added after the cut —
    // at 300 characters, so a real long line ends inside the object.
    const payload = `{"pad":"${"x".repeat(279)}"}`;
    const clipped = phoneLine(payload);
    expect(`KALSA_LOAD ${payload}`.length).toBe(300);
    const res = await post(env, `${clipped}\n`, { "x-kalsa-app": PHONE_APP });
    expect(res.status).toBe(201);
    expect(storedText(puts)).toBe(clipped);
    expect(metadata(puts).dropped).toBe("0");
  });

  test("a line longer than the client's clip cannot come from the phone", async () => {
    const { env, puts } = fakeEnv();
    const overlong = phoneLine(`{"pad":"${"x".repeat(4000)}"}`);
    expect(overlong.length).toBeGreaterThan(325);
    const res = await post(env, `${overlong}\n${LOAD}\n`, { "x-kalsa-app": PHONE_APP });
    expect(res.status).toBe(201);
    expect(storedText(puts)).toBe(LOAD);
    expect(metadata(puts).dropped).toBe("1");
  });

  test("a blank line is neither kept nor counted", async () => {
    const { env, puts } = fakeEnv();
    await post(env, `${LOAD}\n\n${STALL}\n`, { "x-kalsa-app": PHONE_APP });
    expect(storedText(puts)).toBe(`${LOAD}\n${STALL}`);
    expect(metadata(puts).dropped).toBe("0");
  });

  test("a phone body of nothing but prose is stored empty, with its count", async () => {
    const { env, puts } = fakeEnv();
    const res = await post(env, "my answer was in the log somewhere\n", {
      "x-kalsa-app": PHONE_APP,
    });
    expect(res.status).toBe(201);
    expect(storedText(puts)).toBe("");
    expect(metadata(puts)).toMatchObject({ dropped: "1", redacted: "0" });
    expect(storedText(puts)).not.toContain("answer");
  });

});

describe("the redaction pass", () => {
  test("a phone line with an email is kept, the address is not", async () => {
    const { env, puts } = fakeEnv();
    const line = phoneLine('{"detail":"marco@example.com"}');
    const res = await post(env, `${line}\n`, { "x-kalsa-app": PHONE_APP });
    expect(res.status).toBe(201);
    expect(storedText(puts)).toBe(phoneLine('{"detail":"<email>"}'));
    expect(storedText(puts)).not.toContain("marco@example.com");
    expect(metadata(puts)).toMatchObject({ dropped: "0", redacted: "1" });
  });

  test("a desktop body is redacted on every class, and keeps everything else", async () => {
    const { env, puts } = fakeEnv();
    const body = [
      "engine failed to load /Users/marco/models/q4.gguf from /home/tester/cache",
      `redirected to https://hf.co/resolve?sig=abc123 (also ${SEPARATOR})`,
      "peer 10.0.0.7 over [fe80:0000:0000:0000:0000:0000:0000:0001] wrote marco@example.com",
      "plain log line with nothing to redact",
    ].join("\n");
    const res = await post(env, `${body}\n`);
    expect(res.status).toBe(201);
    const text = storedText(puts);
    expect(text).toContain("/Users/<user>");
    expect(text).toContain("/home/<user>");
    expect(text).toContain("https://hf.co/resolve<query>");
    expect(text).toContain("<ip>");
    expect(text).toContain("<ip6>");
    expect(text).toContain("<email>");
    expect(text).toContain(SEPARATOR);
    expect(text).toContain("plain log line with nothing to redact");
    for (const gone of [
      "/Users/marco",
      "/home/tester",
      "hf.co/resolve?sig",
      "10.0.0.7",
      "fe80:0000",
      "marco@example.com",
    ]) {
      expect(text).not.toContain(gone);
    }
    expect(metadata(puts)).toMatchObject({ dropped: "0", redacted: "6" });
  });

  test("a body with nothing to redact reports zero of both counts", async () => {
    const { env, puts } = fakeEnv();
    await post(env, "engine ready\ntwo log files joined\n");
    expect(metadata(puts)).toMatchObject({ dropped: "0", redacted: "0" });
  });

  test("every address shape the clients write is replaced", async () => {
    const { env, puts } = fakeEnv();
    const lines = [
      "loopback ::1 and [::1]:8080 on the socket",
      "full fe80:0000:0000:0000:0000:0000:0000:0001 and compressed 2001:db8::1",
      "zone fe80::1%eth0 and mapped ::ffff:10.0.0.1 and dotted tail 2001:db8::10.0.0.1",
      "mail marco@example.com and marco@localhost and marco+tag@sub.example.co.uk",
      "creds https://user:pass@host/path and query https://host/p?sig=abc#frag",
      "paths /Users/marco/models/q4.gguf /home/tester/c /data/user/0/com.kalsa.dev",
      "windows C:\\Users\\marco\\x and c:\\users\\marco\\y and C:\\Users\\Marco Polo\\f.txt",
      "unc \\\\server\\Users\\marco\\share",
    ];
    const res = await post(env, `${lines.join("\n")}\n`);
    expect(res.status).toBe(201);
    const text = storedText(puts);
    for (const gone of [
      "::1",
      "fe80:",
      "2001:db8",
      "marco@example.com",
      "marco@localhost",
      "marco+tag@",
      "user:pass",
      "sig=abc",
      "/Users/marco",
      "/home/tester",
      "com.kalsa.dev",
      "\\marco",
      "Marco Polo",
    ]) {
      expect(text).not.toContain(gone);
    }
    expect(text).toContain("[<ip6>]:8080");
    // The whole run, not `2001:<ip6>`: a leading group is still a location.
    expect(text).toContain("compressed <ip6>");
    expect(text).toContain("zone <ip6>"); // the %eth0 scope id goes with it
    expect(text).toContain("mapped <ip6>");
    expect(text).toContain("https://<cred>@host/path");
    expect(text).toContain("https://host/p<query>");
    expect(text).toContain("/Users/<user>");
    expect(text).toContain("c:\\users\\<user>\\y"); // case kept, name gone
    expect(text).toContain("\\\\server\\Users\\<user>"); // UNC, server kept
  });

  test("an address in angle brackets, or before a `>`, is still redacted", async () => {
    const { env, puts } = fakeEnv();
    // A `>` guard on the far side of the run was added for idempotence and cost
    // us every address in brackets, which both clients redact.
    const lines = [
      "<10.0.0.1>",
      "<2001:db8::1>",
      "<::1>",
      "10.0.0.1>",
      "<10.0.0.1:8080>",
      "peer <10.0.0.1> failed",
      "[10.0.0.1] (10.0.0.1) {10.0.0.1}",
      "<fe80::1%eth0>",
    ];
    await post(env, `${lines.join("\n")}\n`, { "x-kalsa-app": DESKTOP_APP });
    expect(storedText(puts)).toBe(
      [
        "<<ip>>",
        "<<ip6>>",
        "<<ip6>>",
        "<ip>>",
        "<<ip>:8080>",
        "peer <<ip>> failed",
        "[<ip>] (<ip>) {<ip>}",
        "<<ip6>>",
      ].join("\n") + "\n",
    );
  });

  test("an address straight after a `>` is left, and that is the idempotence guard", async () => {
    const { env, puts } = fakeEnv();
    // Pinned rather than fixed: `<email>::` has to stay two things on a second
    // pass, and refusing to read an address after a `>` is what does it. An
    // address between a `>` and nothing else is the price, and it is written here
    // so nobody reads the rule above as covering both sides.
    await post(env, "peer>10.0.0.1 and marco@example.com::1\n", { "x-kalsa-app": DESKTOP_APP });
    expect(storedText(puts)).toBe("peer>10.0.0.1 and <email>::1\n");
  });

  test("a password holding a dot is redacted whole", async () => {
    const { env, puts } = fakeEnv();
    // The walk used to stop at the dot and store `user:pa` — the username, and
    // the first half of the password — in front of the marker.
    const lines = ["https://user:pa.ss@host/", "https://user:pass@host/", "http://u:p@h@x.io/"];
    await post(env, `${lines.join("\n")}\n`, { "x-kalsa-app": DESKTOP_APP });
    const text = storedText(puts);
    expect(text).toContain("https://<cred>@host/");
    for (const gone of ["user:pa", "user:pass", "u:p@"]) expect(text).not.toContain(gone);
  });

  test("a userinfo longer than the cap is redacted from the start of the authority", async () => {
    const { env, puts } = fakeEnv();
    // Past 256 characters the walk stops, and stopping there used to leave the
    // head of the userinfo — the username and 44 more characters — in the clear.
    const long = `https://user:${"a".repeat(300)}@host/`;
    await post(env, `${long}\n`, { "x-kalsa-app": DESKTOP_APP });
    expect(storedText(puts)).toBe("https://<cred>@host/\n");
    // Under the cap the span is the userinfo, not the whole authority.
    const short = `https://user:${"a".repeat(200)}@host/`;
    const { env: env2, puts: puts2 } = fakeEnv();
    await post(env2, `${short}\n`, { "x-kalsa-app": DESKTOP_APP });
    expect(storedText(puts2)).toBe("https://<cred>@host/\n");
  });

  test("an authority ends with its URL, so prose past it is not a credential", async () => {
    const { env, puts } = fakeEnv();
    // A URL with no path left its authority open for the rest of the line, and
    // the next `@` was read as the credential's: everything from the scheme to
    // the `@` was replaced, taking the sentence with it.
    const lines = [
      "GET https://api.example.com failed, contact marco@example.com",
      "peer https://h.io ok, user@host down",
      "a https://x.io and b@c.d and e@f.g",
    ];
    await post(env, `${lines.join("\n")}\n`, { "x-kalsa-app": DESKTOP_APP });
    expect(storedText(puts)).toBe(
      [
        "GET https://api.example.com failed, contact <email>",
        "peer https://h.io ok, <email> down",
        "a https://x.io and <email> and <email>",
      ].join("\n") + "\n",
    );
  });

  test("a phone line keeps its JSON, and a real credential is still redacted", async () => {
    const { env, puts } = fakeEnv();
    // The corruption this had: a valid phone line came back reading
    // `{"u":"http://<cred>@example.com"}`, as if the address were the URL's host.
    const line = phoneLine('{"u":"http://h","mail":"marco@example.com"}');
    await post(env, `${line}\n`, { "x-kalsa-app": PHONE_APP });
    expect(storedText(puts)).toBe(phoneLine('{"u":"http://h","mail":"<email>"}'));
    const { env: env2, puts: puts2 } = fakeEnv();
    await post(env2, "GET https://user:pass@host/x\n", { "x-kalsa-app": DESKTOP_APP });
    expect(storedText(puts2)).toBe("GET https://<cred>@host/x\n");
  });

  test("a Windows account name ends at the path, not at the sentence", async () => {
    const { env, puts } = fakeEnv();
    // The name may hold a space, so it ends at the separator that closes the
    // segment — but only when that separator arrives before any `:`. With
    // nothing to close it, the name ends at the end of the word.
    const lines = [
      "user C:\\Users\\marco logged out",
      "C:\\Users\\Marco Gualtieri\\Documents",
      "profile C:\\Users\\marco (missing)",
      "\\\\server\\Users\\marco logged out",
      "\\\\server\\Users\\marco and \\\\server\\Users\\anna",
    ];
    await post(env, `${lines.join("\n")}\n`, { "x-kalsa-app": DESKTOP_APP });
    expect(storedText(puts)).toBe(
      [
        "user C:\\Users\\<user> logged out",
        "C:\\Users\\<user>\\Documents",
        "profile C:\\Users\\<user> (missing)",
        "\\\\server\\Users\\<user> logged out",
        "\\\\server\\Users\\<user> and \\\\server\\Users\\<user>",
      ].join("\n") + "\n",
    );
  });

  test("two Windows names in one sentence are both redacted", async () => {
    const { env, puts } = fakeEnv();
    // The second path used to survive whole: the first name ran to the colon of
    // the second drive letter and the span joined the two.
    await post(env, "C:\\Users\\marco and C:\\Users\\anna\n", { "x-kalsa-app": DESKTOP_APP });
    expect(storedText(puts)).toBe("C:\\Users\\<user> and C:\\Users\\<user>\n");
  });

  test("a name written in a non-ASCII script is redacted whole", async () => {
    const { env, puts } = fakeEnv();
    // The first-character gates were ASCII-only, so these were stored whole, and
    // `/Users/josé/x` came back as `/Users/<user>é/x`.
    const lines = ["/Users/用户/x", "C:\\Users\\用户\\x", "/data/user/0/com.用户"];
    await post(env, `${lines.join("\n")}\n`, { "x-kalsa-app": DESKTOP_APP });
    const text = storedText(puts);
    expect(text).toContain("/Users/<user>/x");
    expect(text).toContain("C:\\Users\\<user>\\x");
    expect(text).toContain("/data/user/<n>/<pkg>");
    for (const gone of ["用户", "com."]) expect(text).not.toContain(gone);
  });

  test("an address written with non-ASCII letters is redacted whole", async () => {
    const { env, puts } = fakeEnv();
    const lines = ["mail josé@example.com", "mail 用户@example.com", "mail marco@exämple.com"];
    await post(env, `${lines.join("\n")}\n`, { "x-kalsa-app": DESKTOP_APP });
    const text = storedText(puts);
    expect(text).toBe("mail <email>\nmail <email>\nmail <email>\n");
  });

  test("a question mark with nothing behind it in the URL is prose", async () => {
    const { env, puts } = fakeEnv();
    // `see https://example.com? yes` is a sentence, not a query, and calling it
    // one deleted the token after it behind a marker that claimed otherwise.
    const lines = [
      "see https://example.com? yes",
      "connected to https://h.io; error #42: timeout",
      "https://h/p?q=1",
    ];
    await post(env, `${lines.join("\n")}\n`, { "x-kalsa-app": DESKTOP_APP });
    expect(storedText(puts)).toBe(
      ["see https://example.com? yes", "connected to https://h.io; error #42: timeout", "https://h/p<query>"].join("\n") + "\n",
    );
  });

  test("an IPv4-mapped address with a port goes whole", async () => {
    const { env, puts } = fakeEnv();
    // The quad had to close the run, so `::ffff:10.0.0.1:8080` left its tail.
    const line = "listen ::ffff:10.0.0.1:8080 and [::ffff:10.0.0.1]:9090";
    await post(env, `${line}\n`, { "x-kalsa-app": DESKTOP_APP });
    expect(storedText(puts)).toBe("listen <ip6> and [<ip6>]:9090\n");
  });

  test("a run of colons longer than any address is not an address", async () => {
    const { env, puts } = fakeEnv();
    // The longest literal either form can be is 39 characters, so the run
    // parsers never see a longer one: on a body of `1:1:1:…` that is the
    // difference between walking the line once and walking it twice.
    const notAnAddress = `1:${"1:".repeat(80)}1`;
    const line = `next to fe80::1 ${notAnAddress}`;
    await post(env, `${line}\n`);
    const text = storedText(puts);
    expect(text).toContain("next to <ip6> "); // the address is redacted
    expect(text).toContain(notAnAddress); // the rest of the run is left alone
  });

  test("a colon run before a Windows path does not eat the drive letter", async () => {
    const { env, puts } = fakeEnv();
    // `1:a::C:` is not an address (it ends in a lone `:`), and reading it as one
    // swallowed the drive letter, so `C:\Users\marco` went through whole.
    const { env: env2, puts: puts2 } = fakeEnv();
    await post(env, `at 1:a::C:\\Users\\marco\\x\n`, { "x-kalsa-app": DESKTOP_APP });
    expect(storedText(puts)).toBe("at 1:a::C:\\Users\\<user>\\x\n");
    // A bare `C:` is not a path either, and must not turn the loop inside out.
    await post(env2, "deadbeef C: nope\n", { "x-kalsa-app": DESKTOP_APP });
    expect(storedText(puts2)).toBe("deadbeef C: nope\n");
  });

  test("a URL is redacted in any scheme and in any case", async () => {
    const { env, puts } = fakeEnv();
    // RFC 3986: the scheme is case-insensitive. Matching `https://` literally
    // stored the whole token of `HTTPS://x.io/p?token=abc`, and the clients
    // follow redirects through ftp:, ws: and s3: too.
    const lines = [
      "upper HTTPS://x.io/p?token=abc and mixed Https://x.io/a#frag",
      "others ftp://h/x?y=1 ws://h/p?t=1 s3://b/k?x=2",
    ];
    const res = await post(env, `${lines.join("\n")}\n`);
    expect(res.status).toBe(201);
    const text = storedText(puts);
    expect(text).toContain("HTTPS://x.io/p<query>");
    expect(text).toContain("Https://x.io/a<query>");
    expect(text).toContain("ftp://h/x<query>");
    expect(text).toContain("ws://h/p<query>");
    expect(text).toContain("s3://b/k<query>");
    for (const gone of ["token=abc", "#frag", "y=1", "t=1", "x=2"]) {
      expect(text).not.toContain(gone);
    }
  });

  test("a version is not an address: the rule takes four octets, then a port", async () => {
    const { env, puts } = fakeEnv();
    // `10.0.0.7.5` is a build string; an earlier rule burned the first four
    // parts and stored `<ip>.5` in its place.
    const res = await post(env, "app 10.0.0.7.5 listens on 10.0.0.7:9000\n");
    expect(res.status).toBe(201);
    expect(storedText(puts)).toBe("app 10.0.0.7.5 listens on <ip>:9000\n");
    expect(metadata(puts)).toMatchObject({ dropped: "0", redacted: "1" });
  });

  test("a line with nothing identifying in it is left exactly as it was", async () => {
    const { env, puts } = fakeEnv();
    const line = "rust error std::io::Error at 12:34:56 elapsed 0.014s stage=prefill";
    await post(env, `${line}\n`);
    expect(storedText(puts)).toBe(`${line}\n`);
  });

  test("a line longer than the clients cap is dropped, not scanned", async () => {
    const { env, puts } = fakeEnv();
    // Above the desktop's own LINE_CHAR_CAP plus its truncation marker: a line
    // no client writes, and exactly the shape a rule could go quadratic on.
    const huge = `engine frame ${"z".repeat(8209)}`;
    const res = await post(env, `${huge}\nengine ready\n`);
    expect(res.status).toBe(201);
    expect(storedText(puts)).toBe("engine ready\n");
    expect(metadata(puts)).toMatchObject({ dropped: "1", redacted: "0" });
  });
});

describe("a phone payload is scrubbed through its decoded values", () => {
  test("an encoded break character cannot keep part of a credential", async () => {
    const { env, puts } = fakeEnv();
    // Choosing between the raw and the decoded scan redacted both exactly once
    // for each of these, so the count could not tell them apart — and the decoded
    // one is the weaker: it stops at the `?` the escape becomes, and stored the
    // username and a password prefix in front of the marker.
    const lines = [
      "https://user:pa%3Fss@host/",
      "https://user:pass%20word@host/",
      "https://user:pa%23ss@host/",
      "https://user:pa%2Fss@host/",
      "https://user:pa%40ss%20word@host/",
    ];
    await post(env, `${lines.join("\n")}\n`, { "x-kalsa-app": DESKTOP_APP });
    expect(storedText(puts)).toBe(`${lines.map(() => "https://<cred>@host/").join("\n")}\n`);
    for (const gone of ["user:", "pass", "pa"]) expect(storedText(puts)).not.toContain(gone);

    const { env: env2, puts: puts2 } = fakeEnv();
    await post(env2, `${phoneLine('{"u":"https://user:pa%3Fss@host/"}')}\n`, {
      "x-kalsa-app": PHONE_APP,
    });
    expect(storedText(puts2)).toBe(phoneLine('{"u":"https://<cred>@host/"}'));
  });

  test("a percent-encoded control stays encoded", async () => {
    const { env, puts } = fakeEnv();
    // Decoding `%0A` would write a literal newline into the middle of a stored
    // line and split one report line into two.
    await post(env, "alpha marco%40example.com %0A bravo\n", { "x-kalsa-app": DESKTOP_APP });
    const text = storedText(puts);
    expect(text).toBe("alpha <email> %0A bravo\n");
    expect(text.split("\n")).toHaveLength(2);
  });

  test("a `__proto__` key survives the walk and is scrubbed like any other", async () => {
    const { env, puts } = fakeEnv();
    // A plain assignment goes to the prototype setter and the entry silently
    // disappeared from the stored report.
    const payloads: [string, string][] = [
      ['{"__proto__":"marco@example.com"}', '{"__proto__":"<email>"}'],
      ['{"__proto__":{"m":"marco@example.com"}}', '{"__proto__":{"m":"<email>"}}'],
      ['{"a":{"__proto__":"marco@example.com"},"b":"ok"}', '{"a":{"__proto__":"<email>"},"b":"ok"}'],
    ];
    await post(env, `${payloads.map(([p]) => phoneLine(p)).join("\n")}\n`, {
      "x-kalsa-app": PHONE_APP,
    });
    expect(storedText(puts)).toBe(payloads.map(([, want]) => phoneLine(want)).join("\n"));
  });

  // The gate validates a phone payload by parsing it, the pass used to scan the
  // raw text, and the raw text is what got stored. Every payload below survived
  // with zero redactions and decoded back to the token it hid.

  test("no JSON escape hides a token from the pass", async () => {
    const { env, puts } = fakeEnv();
    const shapes: [string, string][] = [
      ['{"m":"marco\\u0040example.com"}', '{"m":"<email>"}'],
      ['{"ip":"10\\u002e0\\u002e0\\u002e7"}', '{"ip":"<ip>"}'],
      ['{"ip":"2001\\u003adb8\\u003a\\u003a1"}', '{"ip":"<ip6>"}'],
      ['{"p":"\\u002fUsers\\u002fmarco"}', '{"p":"/Users/<user>"}'],
      // `JSON.stringify` really does emit these two, so a peer-reported path
      // bypassed the path rules on its way past the pass.
      ['{"p":"C:\\\\Users\\\\marco\\\\x"}', '{"p":"C:\\\\Users\\\\<user>\\\\x"}'],
      ['{"p":"\\\\\\\\server\\\\Users\\\\marco\\\\x"}', '{"p":"\\\\\\\\server\\\\Users\\\\<user>\\\\x"}'],
      ['{"u":"https\\u003a//x.io/p?q=1"}', '{"u":"https://x.io/p<query>"}'],
      ['{"u":"https://x.io/p\\u003fq=1"}', '{"u":"https://x.io/p<query>"}'],
      ['{"m":"marco%40example.com"}', '{"m":"<email>"}'],
    ];
    const body = `${shapes.map(([payload]) => phoneLine(payload)).join("\n")}\n`;
    const res = await post(env, body, { "x-kalsa-app": PHONE_APP });
    expect(res.status).toBe(201);
    expect(metadata(puts).dropped).toBe("0");
    expect(storedText(puts)).toBe(shapes.map(([, want]) => phoneLine(want)).join("\n"));
    expect(metadata(puts).redacted).toBe(String(shapes.length));
  });

  test("the stored line is still the JSON the gate accepted", async () => {
    const { env, puts } = fakeEnv();
    // The pass used to start a match *inside* an escape and leave the backslash
    // behind, storing `marco\<email>` — the address gone, the line unparseable.
    const payloads = [
      '{"m":"marco\\u0000@example.com"}',
      '{"m":"marco\\t@example.com"}',
      '{"m":"\\ud83d@example.com"}',
      '{"u":"https:\\/\\/user:p\\u0040ss@host\\/p?q=1"}',
    ];
    await post(env, `${payloads.map((p) => phoneLine(p)).join("\n")}\n`, {
      "x-kalsa-app": PHONE_APP,
    });
    for (const line of storedText(puts).split("\n")) {
      const payload = JSON.parse(line.slice(line.indexOf("{")));
      expect(payload).not.toBeUndefined();
    }
    expect(storedText(puts)).toContain('{"m":"<email>"}');
    expect(storedText(puts)).toContain("<query>");
    expect(storedText(puts)).not.toContain("ss@host");
  });

  test("a key is scrubbed like a value, and so is a nested one", async () => {
    const { env, puts } = fakeEnv();
    await post(env, `${phoneLine('{"marco@example.com":"10.0.0.7"}')}\n`, {
      "x-kalsa-app": PHONE_APP,
    });
    expect(storedText(puts)).toBe(phoneLine('{"<email>":"<ip>"}'));
    const { env: env2, puts: puts2 } = fakeEnv();
    await post(env2, `${phoneLine('{"a":{"b":["marco@example.com",{"c":"10.0.0.7"}]}}')}\n`, {
      "x-kalsa-app": PHONE_APP,
    });
    expect(storedText(puts2)).toBe(phoneLine('{"a":{"b":["<email>",{"c":"<ip>"}]}}'));
  });

  test("a percent-encoded token is decoded, scanned, and stored decoded", async () => {
    const { env, puts } = fakeEnv();
    // The trigger character is the thing an encoded token is hiding, so neither
    // body nor redactor sees the query or the address until it is decoded.
    await post(
      env,
      "url https%3A%2F%2Fx.io%2Fp%3Ftoken%3Dabc and mail marco%40example.com now\n",
      { "x-kalsa-app": DESKTOP_APP },
    );
    expect(storedText(puts)).toBe("url https://x.io/p<query> and mail <email> now\n");
    const { env: env2, puts: puts2 } = fakeEnv();
    await post(env2, `${phoneLine('{"u":"https%3A%2F%2Fx.io%2Fp%3Ftoken%3Dabc"}')}\n`, {
      "x-kalsa-app": PHONE_APP,
    });
    expect(storedText(puts2)).toBe(phoneLine('{"u":"https://x.io/p<query>"}'));
  });

  test("a percent sign that starts no escape is left exactly as it arrived", async () => {
    const { env, puts } = fakeEnv();
    // Decoding must not invent text: `%` followed by anything but two hex digits
    // is not an escape, and a body full of percentages has to survive.
    await post(env, "mail 100% done and 50% off and %zz here\n", { "x-kalsa-app": DESKTOP_APP });
    expect(storedText(puts)).toBe("mail 100% done and 50% off and %zz here\n");
  });

  test("a phone line with no JSON payload is still scanned as raw text", async () => {
    const { env, puts } = fakeEnv();
    const crash = "2026-10-16T14:49:27.123Z js_error name=TypeError frame=index.bundle:42:7";
    await post(env, `${crash}\n`, { "x-kalsa-app": PHONE_APP });
    expect(storedText(puts)).toBe(crash);

    // A payload cut at exactly the clip length, which is the one shape the gate
    // keeps without it parsing. There is nothing to walk, so the raw text is
    // all the pass has, and the address in it still goes.
    const clipped = phoneLine(`{"pad":"${"x".repeat(264)}marco@example.com`);
    expect(clipped.length).toBe(325);
    const { env: env2, puts: puts2 } = fakeEnv();
    await post(env2, `${clipped}\n`, { "x-kalsa-app": PHONE_APP });
    expect(metadata(puts2).dropped).toBe("0");
    expect(storedText(puts2)).toContain("<email>");
    expect(storedText(puts2)).not.toContain("marco@example.com");
  });
test("a clipped payload cannot choose the raw-text path", async () => {
    const { env, puts } = fakeEnv();
    // The gate keeps a payload that does not parse when its length is exactly
    // the clip ceiling, and the attacker controls that length. Scanned raw,
    // `\u0040` means nothing and the token sat in the stored line whole.
    const shapes: [string, string][] = [
      ['{"m":"marco@example.com","x":"', '{"m":"<email>","x":"'],
      ['{"m":"marco\\u0040example.com","x":"', '{"m":"<email>","x":"'],
      ['{"ip":"10\\u002e0\\u002e0\\u002e7","x":"', '{"ip":"<ip>","x":"'],
      ['{"ip":"10.0.0.7","x":"', '{"ip":"<ip>","x":"'],
      ['{"p":"C:\\\\Users\\\\marco\\\\x","z":"', '{"p":"C:\\Users\\<user>\\x","z":"'],
      ['{"p":"\\/Users\\/marco\\/x","z":"', '{"p":"/Users/<user>/x","z":"'],
      ['{"u":"https\\u003a//x.io/p?token=abc","z":"', '{"u":"https://x.io/p<query>","z":"'],
      ['{"m":"marco%40example.com","x":"', '{"m":"<email>","x":"'],
    ];
    for (const [head, want] of shapes) {
      const { env: env2, puts: puts2 } = fakeEnv();
      const line = clippedLine(head);
      expect(line.length).toBe(325);
      await post(env2, `${line}\n`, { "x-kalsa-app": PHONE_APP });
      // Kept — the clip explains why it does not parse — and the stored text is
      // the text that was scanned, so it is shorter by whatever the escapes were.
      expect(metadata(puts2).dropped).toBe("0");
      expect(storedText(puts2)).toContain(want);
      for (const gone of TOKEN_FRAGMENTS) expect(storedText(puts2)).not.toContain(gone);
    }
  });

  test("an invisible character cannot split a token inside a phone payload", async () => {
    const { env, puts } = fakeEnv();
    // A NUL, a TAB or a zero-width space between the parts of an address is two
    // tokens to every rule and one to a human. They are removed from the scanned
    // text and that is scanned again. When the first scan already took the tail
    // of a split token, the head before the invisible stays (the key row): the
    // deployed pass stored the same, and a removal that runs before the first
    // scan welds `<address>\tok` and loses a redaction instead.
    const parsed: [string, string][] = [
      ['{"m":"marco\\u0000@example.com"}', '{"m":"<email>"}'],
      ['{"m":"marco\\u0009@example.com"}', '{"m":"<email>"}'],
      ['{"m":"ma\\u200brco@example.com"}', '{"m":"<email>"}'],
      ['{"m":"marco\\u00ad@example.com"}', '{"m":"<email>"}'],
      ['{"ip":"10.0.0\\u0000.7"}', '{"ip":"<ip>"}'],
      ['{"ip":"10.0.\\u00090.7"}', '{"ip":"<ip>"}'],
      ['{"ip":"10.0.0\\u200b.7"}', '{"ip":"<ip>"}'],
      ['{"p":"/Users/ma\\u202erco/x"}', '{"p":"/Users/<user>/x"}'],
      ['{"ma\\u0000rco@example.com":"v"}', '{"ma\\u0000<email>":"v"}'],
    ];
    await post(env, `${parsed.map(([p]) => phoneLine(p)).join("\n")}\n`, {
      "x-kalsa-app": PHONE_APP,
    });
    expect(storedText(puts)).toBe(parsed.map(([, want]) => phoneLine(want)).join("\n"));
  });

  test("the same, in a payload the clip left unparseable", async () => {
    const { env, puts } = fakeEnv();
    const shapes: [string, string][] = [
      // The raw scan reads `u0000` as the local part, so `marco\\` stays: the
      // same as the deployed pass, and the domain is gone either way.
      ['{"m":"marco\\u0000@example.com","x":"', '{"m":"marco\\<email>","x":"'],
      ['{"ip":"10.0.0\\u200b.7","x":"', '{"ip":"<ip>","x":"'],
      ['{"ip":"10.0.0\\u0000\\u0000.7","x":"', '{"ip":"<ip>","x":"'],
    ];
    for (const [head, want] of shapes) {
      const { env: env2, puts: puts2 } = fakeEnv();
      await post(env2, `${clippedLine(head)}\n`, { "x-kalsa-app": PHONE_APP });
      expect(metadata(puts2).dropped).toBe("0");
      expect(storedText(puts2)).toContain(want);
      for (const gone of TOKEN_FRAGMENTS) expect(storedText(puts2)).not.toContain(gone);
    }
  });

  test("a desktop line keeps the tab its fields are separated by", async () => {
    const { env, puts } = fakeEnv();
    // The invisible characters are removed inside a phone payload, where there
    // is no field separator to destroy. A desktop log separates its columns with
    // tabs, so a tab there stays: joining them would cost more structure than the
    // character is worth.
    await post(env, "stage=prefill\tcomponent=engine\tseq=7\n", { "x-kalsa-app": DESKTOP_APP });
    expect(storedText(puts)).toBe("stage=prefill\tcomponent=engine\tseq=7\n");
  });
});

describe("what the screen refuses", () => {
  test("400 invalid_utf8 for a body that is not valid UTF-8", async () => {
    const { env, puts } = fakeEnv();
    const res = await worker.fetch(
      new Request(REPORT_URL, {
        method: "POST",
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "content-length": "4",
          "x-kalsa-app": VALID_APP,
          "cf-connecting-ip": CLIENT_IP,
        },
        // A lone continuation byte: decoding it leniently would store a
        // 3-byte U+FFFD for it and triple the object against the 4 MiB cap.
        body: new Uint8Array([0xff, 0xfe, 0x80, 0x0a]),
      }),
      env,
    );
    expect(res.status).toBe(400);
    expect((await errorBody(res)).code).toBe("invalid_utf8");
    expect(puts).toHaveLength(0);
  });

  test("413 when screening grows the report past the stored cap", async () => {
    const { env, puts } = fakeEnv();
    // A `?q` becomes a `<query>` marker, so 280k one-line URLs of query-carrying
    // text go in at 3.9 MiB and come out at 4.8 MiB — past the cap that bounds
    // one stored object, with the request itself still legal.
    const body = `${Array.from({ length: 280_000 }, () => "https://h/p?q").join("\n")}\n`;
    expect(body.length).toBeLessThan(4 * 1024 * 1024);
    const res = await post(env, body);
    expect(res.status).toBe(413);
    expect((await errorBody(res)).code).toBe("payload_too_large");
    expect(puts).toHaveLength(0);
  });

  test("413 on a body that multiplies, refused without being built", async () => {
    const { env, puts } = fakeEnv();
    // Every three characters become a seven-character marker, so a body of
    // `a@b` lines goes in at 2.9 MiB and would come out at 5.8 MiB. The pass is
    // handed the stored cap and stops at it; the whole string is never assembled
    // just to be measured and refused.
    const body = `${Array.from({ length: 750_000 }, () => "a@b").join("\n")}\n`;
    expect(body.length).toBeLessThan(4 * 1024 * 1024);
    const res = await post(env, body);
    expect(res.status).toBe(413);
    expect((await errorBody(res)).code).toBe("payload_too_large");
    expect(puts).toHaveLength(0);
  });

  test("413 for a body over the cap, before anything is decoded or screened", async () => {
    const { env, puts } = fakeEnv();
    // The raw cap is read mid-stream and cancels the request, so a body over the
    // limit never reaches the filter or the pass whatever it contains.
    const over = 4 * 1024 * 1024 + 1;
    const res = await worker.fetch(
      new Request(REPORT_URL, {
        method: "POST",
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "x-kalsa-app": VALID_APP,
          "cf-connecting-ip": CLIENT_IP,
        },
        body: new Uint8Array(over).fill(0x61),
      }),
      env,
    );
    expect(res.status).toBe(413);
    expect((await errorBody(res)).code).toBe("payload_too_large");
    expect(puts).toHaveLength(0);
  });
});