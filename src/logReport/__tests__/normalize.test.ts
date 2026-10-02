/** Final-pass tests: deny words, URL stripping, IP/home-path redaction, 300-char clip. */
import { finalizeLine } from "../normalize";

describe("deny words drop the line", () => {
  it.each([
    "KALSA_X {\"m\":\"got exception while reading\"}",
    "KALSA_X {\"m\":\"GOT EXCEPTION\"}",
    "KALSA_X {\"m\":\"last read: 12 bytes\"}",
    "KALSA_X {\"m\":\"parse_error at offset 3\"}",
    "KALSA_X {\"m\":\"json.exception type\"}",
    "KALSA_X {\"m\":\"JSON.EXCEPTION\"}",
    "KALSA_X {\"api_keys:\":[\"a\"]}",
    "KALSA_X {\"m\":\"old: 1\"}",
    "KALSA_X {\"m\":\"new: 2\"}",
  ])("drops %s", (line) => {
    expect(finalizeLine(line)).toBeNull();
  });

  it("does not drop a line that merely contains a similar word", () => {
    expect(finalizeLine('KALSA_CTX_FLOOR {"nCtx":4096}')).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    );
  });
});

describe("URL query and fragment stripping", () => {
  it("keeps the origin, drops the query with its token", () => {
    const out = finalizeLine('KALSA_ROAD {"reason":"no_node","u":"https://x.example/pair?token=abc123#frag"}');
    expect(out).toContain("https://x.example/pair");
    expect(out).not.toContain("token");
    expect(out).not.toContain("abc123");
    expect(out).not.toContain("frag");
  });
});

describe("IP and path redaction", () => {
  it("redacts IPv4", () => {
    const out = finalizeLine("KALSA_STALL {\"peer\":\"192.168.1.82\",\"port\":5555}");
    expect(out).toContain("<ip>");
    expect(out).not.toContain("192.168.1.82");
    expect(out).toContain("5555");
  });

  it("redacts compressed and full IPv6", () => {
    const out = finalizeLine('KALSA_ROAD {"a":"fe80::1","b":"2001:db8:0:0:0:0:0:1"}');
    expect(out).not.toContain("fe80::1");
    expect(out).not.toContain("2001:db8");
    expect(out).toContain("<ip6>");
  });

  it("does not corrupt the ISO timestamp colons", () => {
    const out = finalizeLine('KALSA_CTX_FLOOR {"nCtx":4096}');
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z KALSA_CTX_FLOOR \{"nCtx":4096\}$/);
  });

  it("redacts macOS home paths keeping the shape", () => {
    const out = finalizeLine('KALSA_X {"p":"/Users/marco/Projects/kalsa/src"}');
    expect(out).toContain("/Users/<user>/Projects/kalsa/src");
    expect(out).not.toContain("marco");
  });

  it("redacts linux home paths", () => {
    const out = finalizeLine('KALSA_X {"p":"/home/marco/.ssh"}');
    expect(out).toContain("/home/<user>/.ssh");
    expect(out).not.toContain("marco");
  });

  it("redacts the android app-private path", () => {
    const out = finalizeLine('KALSA_X {"p":"/data/user/0/com.kalsa.dev/cache/t.log"}');
    expect(out).toContain("/data/user/<n>/<pkg>/cache/t.log");
    expect(out).not.toContain("com.kalsa.dev");
  });
});

describe("300-char clip", () => {
  it("clips the content before the timestamp prefix", () => {
    const out = finalizeLine(`KALSA_PREWARM {"op":"skip","reason":"${"a".repeat(400)}"}`);
    expect(out).not.toBeNull();
    const content = out!.slice(out!.indexOf(" ") + 1);
    expect(content.length).toBe(300);
  });

  it("leaves short lines untouched apart from the prefix", () => {
    const out = finalizeLine('KALSA_CTX_FLOOR {"nCtx":8192}');
    expect(out?.endsWith('KALSA_CTX_FLOOR {"nCtx":8192}')).toBe(true);
  });
});
