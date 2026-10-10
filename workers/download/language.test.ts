import { BASE, envWith, send, standardObjects } from "./fakes";
import { GUIDE_HTML_IT } from "./guide";
import { pickLang } from "./language";
import { downloadPageHtml } from "./page";

const KEY = "k".repeat(32);
const at = (query: string) => new URL(`https://kalsa.io/download/${KEY}${query}`);

describe("which language a request gets", () => {
  test.each([
    ["?lang=it wins over an English browser", "?lang=it", "en-US,en;q=0.9", "it"],
    ["?lang=en wins over an Italian browser", "?lang=en", "it-IT,it;q=0.9", "en"],
    ["an Italian browser", "", "it-IT,it;q=0.9,en;q=0.8", "it"],
    ["a bare it", "", "it", "it"],
    ["Italian only as a second choice", "", "en-GB,it;q=0.8", "en"],
    ["no header", "", null, "en"],
    ["an unknown ?lang= falls back to the browser", "?lang=fr", "it", "it"],
    ["a tag that only starts with it", "", "itl", "en"],
  ])("%s", (_, query, header, lang) => {
    expect(pickLang(at(query), header)).toBe(lang);
  });
});

describe("the Italian page", () => {
  const html = downloadPageHtml({ windows: null, mac: null }, KEY, "it");

  test("is marked Italian and links back to English on the same page", () => {
    expect(html).toContain('<html lang="it">');
    expect(html).toContain('<a href="?lang=en" hreflang="en" lang="en">English</a>');
    expect(html).toContain("Scarica per Windows: in arrivo");
    expect(html).toContain(GUIDE_HTML_IT);
  });

  test("the English page links to Italian", () => {
    expect(downloadPageHtml({ windows: null, mac: null }, KEY, "en")).toContain('<a href="?lang=it"');
  });

  test("the Italian guide keeps the same anchors and drops section 7", () => {
    const ids = [...GUIDE_HTML_IT.matchAll(/<h2 id="([^"]+)">/g)].map((m) => m[1]);
    expect(ids).toEqual(["requirements", "mac", "windows", "first-start", "phone", "problems", "uninstall"]);
    expect(GUIDE_HTML_IT).not.toContain("PHONE-APP-LINK");
    expect(GUIDE_HTML_IT).not.toMatch(/https?:\/\//);
  });
});

describe("the keyed page negotiates its language", () => {
  test("an Italian browser gets Italian, and 200 and 304 both vary on accept-language", async () => {
    const env = envWith(standardObjects());
    const headers = { "accept-language": "it-IT,it;q=0.9" };
    const first = await send(env, BASE, { headers });
    expect(await first.text()).toContain('<html lang="it">');
    expect(first.headers.get("vary")).toBe("accept-language");
    const etag = first.headers.get("etag")!;
    const second = await send(env, BASE, { headers: { ...headers, "if-none-match": etag } });
    expect(second.status).toBe(304);
    expect(second.headers.get("vary")).toBe("accept-language");
  });

  test("the English and Italian pages have different etags", async () => {
    const env = envWith(standardObjects());
    const en = await send(env, BASE);
    const it = await send(env, `${BASE}?lang=it`);
    expect(en.headers.get("etag")).not.toBe(it.headers.get("etag"));
  });
});
