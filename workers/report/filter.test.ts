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
      "mail marco@example.com and marco@localhost and marco+tag@sub.example.co.uk",
      "creds https://user:pass@host/path and query https://host/p?sig=abc#frag",
      "paths /Users/marco/models/q4.gguf /home/tester/c /data/user/0/com.kalsa.dev",
      "windows C:\\Users\\marco\\x and c:\\users\\marco\\y and C:\\Users\\Marco Polo\\f.txt",
    ];
    const res = await post(env, `${lines.join("\n")}\n`);
    expect(res.status).toBe(201);
    const text = storedText(puts);
    for (const gone of [
      "::1",
      "fe80:",
      "2001:db8::1",
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
    expect(text).toContain("2001:<ip6>"); // the client's own `::`-anchored rule
    expect(text).toContain("https://<cred>@host/path");
    expect(text).toContain("https://host/p<query>");
    expect(text).toContain("/Users/<user>");
    expect(text).toContain("c:\\users\\<user>\\y"); // case kept, name gone
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
});