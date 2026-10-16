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