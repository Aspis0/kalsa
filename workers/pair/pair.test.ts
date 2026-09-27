import { createHash } from "node:crypto";

import worker from "./index";
import {
  CSP_HEADER,
  PAGE_SCRIPT,
  PAGE_STYLE,
  SCRIPT_HASH,
  STYLE_HASH,
  pairPageHtml,
} from "./page";
import { SHA256_CERT_FINGERPRINT, assetLinksResponse } from "./assetlinks";

const ORIGIN = "https://kalsa.io";

function sha256B64(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("base64");
}

type Stub = {
  hidden: boolean;
  href: string | null;
  setAttribute(name: string, value: string): void;
};

/** Evaluate the pinned inline script against a fake document/location. */
function runPageScript(hash: string): Record<string, Stub> {
  const els: Record<string, Stub> = {
    invite: { hidden: true, href: null, setAttribute: () => {} },
    incomplete: { hidden: true, href: null, setAttribute: () => {} },
    open: {
      hidden: false,
      href: null,
      setAttribute(name, value) {
        this.href = value;
      },
    },
  };
  const doc = { getElementById: (id: string) => els[id] };
  // Params shadow the globals the script expects (location, document).
  new Function("location", "document", PAGE_SCRIPT)({ hash }, doc);
  return els;
}

describe("routes", () => {
  test("GET /pair serves the invite page", async () => {
    const res = await worker.fetch(new Request(ORIGIN + "/pair"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const html = await res.text();
    expect(html).toContain("Open in Kalsa");
    expect(html).toContain("Ask the person who invited you for the Kalsa app.");
    expect(html).toContain("This invite link is incomplete.");
  });

  test("GET /.well-known/assetlinks.json serves the statement list", async () => {
    const res = await worker.fetch(new Request(ORIGIN + "/.well-known/assetlinks.json"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    const body = JSON.parse(await res.text());
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0].relation).toEqual(["delegate_permission/common.handle_all_urls"]);
    expect(body[0].target).toEqual({
      namespace: "android_app",
      package_name: "com.kalsa.app",
      sha256_cert_fingerprints: [SHA256_CERT_FINGERPRINT],
    });
    expect(SHA256_CERT_FINGERPRINT).toMatch(/^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/);
  });

  test("any other path is 404", async () => {
    for (const path of ["/", "/pairfoo", "/pairing", "/PAIR", "/.well-known/assetlinks.jsonx"]) {
      const res = await worker.fetch(new Request(ORIGIN + path));
      expect(res.status).toBe(404);
    }
  });

  test("a foreign host is 404 even on our paths", async () => {
    const res = await worker.fetch(new Request("https://other.example/pair"));
    expect(res.status).toBe(404);
  });
});

describe("strict headers", () => {
  test("page carries the full header set", async () => {
    const res = await worker.fetch(new Request(ORIGIN + "/pair"));
    expect(res.headers.get("content-security-policy")).toBe(CSP_HEADER);
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  test("CSP directives and pinned hashes match the inline sources", () => {
    expect(SCRIPT_HASH).toBe(sha256B64(PAGE_SCRIPT));
    expect(STYLE_HASH).toBe(sha256B64(PAGE_STYLE));
    expect(CSP_HEADER).toBe(
      "default-src 'none'" +
        `; script-src 'sha256-${SCRIPT_HASH}'` +
        `; style-src 'sha256-${STYLE_HASH}'` +
        "; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
  });
});

describe("the page cannot exfiltrate the fragment", () => {
  const html = pairPageHtml();

  test("no network or exfiltration APIs", () => {
    expect(html).not.toMatch(/fetch\s*\(/);
    expect(html).not.toContain("sendBeacon");
    expect(html).not.toContain("XMLHttpRequest");
    expect(html).not.toContain("innerHTML");
    expect(html).not.toContain("<form");
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/https?:\/\//); // no third-party assets, no analytics
  });
});

describe("client-side fragment handling", () => {
  test("valid base64url fragment is linked verbatim", () => {
    const els = runPageScript("#Abc-DEF_0123");
    expect(els.open.href).toBe("kalsa://pair#Abc-DEF_0123");
    expect(els.invite.hidden).toBe(false);
    expect(els.incomplete.hidden).toBe(true);
  });

  test("invalid fragment is not linked", () => {
    for (const hash of ["#bad/news", "#sp ace", "#a+b", "#<script>", "#"]) {
      const els = runPageScript(hash);
      expect(els.open.href).toBeNull();
      expect(els.invite.hidden).toBe(true);
      expect(els.incomplete.hidden).toBe(false);
    }
  });

  test("no fragment shows the incomplete message", () => {
    const els = runPageScript("");
    expect(els.open.href).toBeNull();
    expect(els.incomplete.hidden).toBe(false);
  });
});

describe("assetlinks response", () => {
  test("carries nosniff and no-store next to the JSON type", () => {
    const res = assetLinksResponse();
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
