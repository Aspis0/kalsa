/**
 * The source-chip policy (DESIGN.md §2.5): only a public `http(s)` address is
 * tappable, and the chip prints the citation index and the host.
 *
 * A policy, so a test: the rule the desktop states is "no favicons and no
 * previews", and its consequence — which addresses may leave the app on a tap —
 * is decided here, by a pure function, rather than by a component this stack
 * cannot render. The host half of the rule is the interesting half: the old UI
 * asked only `isSafeHttpUrl`, which would have made the user's own Kalsa Brain
 * box, or a `localhost:8080` dev server, a link.
 */
import {
  hostOf,
  isLocalNetworkHost,
  sourceChipDecision,
} from "./sourceLinkPolicy";

describe("a chip that may be tapped", () => {
  it("is an http(s) address with a host, and prints that host", () => {
    expect(sourceChipDecision("https://example.com/paper.pdf")).toEqual({
      tappable: true,
      text: "example.com",
    });
    expect(sourceChipDecision("http://example.com")).toEqual({
      tappable: true,
      text: "example.com",
    });
  });

  it("prints the host without `www.`, lowercased, and without the path", () => {
    expect(hostOf("https://WWW.Example.COM/a/b?c=d#e")).toBe("example.com");
    expect(hostOf("https://example.com./x")).toBe("example.com");
    expect(hostOf("https://en.wikipedia.org/wiki/Hilbert_space")).toBe(
      "en.wikipedia.org",
    );
  });

  it("keeps a port only when it is not the scheme's default", () => {
    expect(hostOf("https://example.com:443/x")).toBe("example.com");
    expect(hostOf("http://example.com:80/x")).toBe("example.com");
    expect(hostOf("https://example.com:8443/x")).toBe("example.com:8443");
    expect(hostOf("ftp://example.com:2121/x")).toBe("example.com:2121");
  });

  it("treats public addresses as public, including IPv4 and IPv6 literals", () => {
    for (const url of [
      "https://93.184.216.34/x",
      "http://172.32.0.1/x", // one step outside 172.16/12
      "http://172.15.255.255/x", // one step below it
      "http://11.0.0.1/x", // one step outside 10/8
      "http://[2606:2800:220:1:248:1893:25c8:1946]/x",
    ]) {
      expect(sourceChipDecision(url).tappable).toBe(true);
    }
  });

  it("drops userinfo from the printed host, so a credential cannot be shown", () => {
    expect(hostOf("https://user:secret@example.com/x")).toBe("example.com");
  });
});

describe("a chip that stays text", () => {
  it("refuses a scheme that is not http or https", () => {
    for (const url of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/plain,hello",
      "file:///data/user/0/com.kalsa.app/files/notes.txt",
      "ftp://example.com/x",
      "mailto:someone@example.com",
      "example.com",
      "//example.com/x",
      "content://media/external/images/1",
    ]) {
      expect(sourceChipDecision(url).tappable).toBe(false);
    }
  });

  it("refuses the machine's own server: loopback, LAN, link-local, mDNS", () => {
    for (const url of [
      "http://localhost:8080/chat",
      "http://localhost/x",
      "http://127.0.0.1:8080/x",
      "http://127.9.9.9/x",
      "http://0.0.0.0/x",
      "http://10.0.0.5/x",
      "http://192.168.1.82:5555/x", // the Jelly Star's own address
      "http://172.16.0.1/x",
      "http://172.31.255.254/x",
      "http://169.254.1.1/x",
      "http://100.64.0.1/x",
      "http://kalsa-brain/x", // a bare name is a LAN name, not a public one
      "http://kalsa-brain.local/x",
      "http://mac.internal/x",
      "http://[::1]:8080/x",
      "http://[fe80::1]/x",
      "http://[fd00::1]/x",
      "http://[::ffff:127.0.0.1]/x",
    ]) {
      expect(sourceChipDecision(url).tappable).toBe(false);
    }
  });

  it("still prints the host it refuses, so the chip says which one it is", () => {
    expect(sourceChipDecision("http://192.168.1.82:5555/chat")).toEqual({
      tappable: false,
      text: "192.168.1.82:5555",
    });
    expect(sourceChipDecision("http://kalsa-brain.local/x")).toEqual({
      tappable: false,
      text: "kalsa-brain.local",
    });
  });

  it("refuses an address whose authority is rewritten by an invisible character", () => {
    // `isSafeHttpUrl` rejects the zero-width space; the chip prints the host the
    // address appears to point at, but it is not a link.
    const decision = sourceChipDecision("https://example.com\u200b@evil.com/x");
    expect(decision.tappable).toBe(false);
    expect(decision.text).toBe("evil.com");
  });

  it("falls back to the title, then to a clipped address, when there is no host", () => {
    expect(sourceChipDecision("data:text/plain,hello", "A local note")).toEqual({
      tappable: false,
      text: "A local note",
    });
    expect(sourceChipDecision("data:text/plain,hello")).toEqual({
      tappable: false,
      text: "data:text/plain,hello",
    });
    const long = `data:text/plain,${"x".repeat(200)}`;
    const clipped = sourceChipDecision(long).text;
    expect(clipped).toHaveLength(49); // 48 characters plus the ellipsis
    expect(clipped.endsWith("…")).toBe(true);
    expect(long.startsWith(clipped.slice(0, 48))).toBe(true);
  });

  it("survives an empty or hostless address without inventing one", () => {
    expect(sourceChipDecision("")).toEqual({ tappable: false, text: "" });
    expect(sourceChipDecision("   ")).toEqual({ tappable: false, text: "" });
    expect(sourceChipDecision("https:///x")).toEqual({ tappable: false, text: "https:///x" });
  });
});

describe("the local-network predicate on its own", () => {
  it("is indifferent to brackets and ports, because callers forget them", () => {
    expect(isLocalNetworkHost("[::1]:8080")).toBe(true);
    expect(isLocalNetworkHost("::1")).toBe(true);
    expect(isLocalNetworkHost("localhost:3000")).toBe(true);
    expect(isLocalNetworkHost("LOCALHOST")).toBe(true);
    expect(isLocalNetworkHost("dev.localhost.")).toBe(true);
    expect(isLocalNetworkHost("example.com:8443")).toBe(false);
    expect(isLocalNetworkHost("Example.COM")).toBe(false);
  });

  it("does not mistake a public IPv6 or a private-looking IPv4 for the LAN", () => {
    expect(isLocalNetworkHost("2606:2800:220:1::1")).toBe(false);
    expect(isLocalNetworkHost("172.32.0.1")).toBe(false);
    expect(isLocalNetworkHost("9.9.9.9")).toBe(false);
    expect(isLocalNetworkHost("fc00::1")).toBe(true);
    expect(isLocalNetworkHost("fd12:3456::1")).toBe(true);
  });
});
