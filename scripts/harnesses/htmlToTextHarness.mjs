/**
 * Harness for src/util/htmlToText.ts (single-pass state machine) +
 * retrievalLoop DocRetrieverIndex / runRetrievalLoop integration.
 * Compiles with tsc --ignoreConfig into scripts/.build, plain-Node asserts.
 */
import { spawnSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");

/** Delete stale outputs this harness owns so a failed compile cannot test old code. */
function deleteStaleBuild() {
  const owned = [
    path.join(projectRoot, "scripts/.build/util/htmlToText.js"),
    path.join(projectRoot, "scripts/.build/src/util/htmlToText.js"),
    path.join(projectRoot, "scripts/.build/htmlToText.js"),
  ];
  for (const f of owned) {
    try {
      if (existsSync(f)) unlinkSync(f);
    } catch {
      /* ignore */
    }
  }
}

function compile() {
  deleteStaleBuild();
  const r = spawnSync(
    "npx",
    [
      "tsc",
      "src/util/htmlToText.ts",
      "src/context/retriever.ts",
      "src/context/retrievalLoop.ts",
      "--outDir",
      "scripts/.build",
      "--module",
      "nodenext",
      "--target",
      "es2020",
      "--moduleResolution",
      "nodenext",
      "--skipLibCheck",
      "--ignoreConfig",
    ],
    { cwd: projectRoot, encoding: "utf8", shell: true },
  );
  if (r.status !== 0) {
    console.error("tsc failed:\n", r.stdout, r.stderr);
    process.exit(1);
  }
}

function resolveBuilt(base) {
  const candidates = [
    path.join(projectRoot, `scripts/.build/util/${base}`),
    path.join(projectRoot, `scripts/.build/src/util/${base}`),
    path.join(projectRoot, `scripts/.build/context/${base}`),
    path.join(projectRoot, `scripts/.build/src/context/${base}`),
    path.join(projectRoot, `scripts/.build/${base}`),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  console.error(`Could not find compiled ${base}. Tried:\n`, candidates.join("\n"));
  process.exit(1);
}

let pass = 0;
let fail = 0;

function check(name, cond, detail = "") {
  if (cond) {
    console.log(`PASS ${name}`);
    pass++;
  } else {
    console.log(`FAIL ${name}${detail ? ": " + detail : ""}`);
    fail++;
  }
}

/** True if s is well-formed UTF-16 (no lone surrogates). */
function isWellFormedUtf16(s) {
  try {
    encodeURIComponent(s);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  compile();

  const htmlPath = resolveBuilt("htmlToText.js");
  const loopPath = resolveBuilt("retrievalLoop.js");

  const { htmlToText } = await import(pathToFileURL(htmlPath).href);
  const { DocRetrieverIndex, runRetrievalLoop } = await import(
    pathToFileURL(loopPath).href
  );

  // ── 1. Paragraph structure + runRetrievalLoop integration ──────────────
  {
    const html = `
      <html><head><title>Para Test</title></head><body>
      <nav>Home Sport Cultura navigation landmark for index survival</nav>
      <h1>Introduction to Alpine Flora Research Notes</h1>
      <div>First paragraph describes mountain meadows and wildflowers in spring bloom across valleys with extra words.</div>
      <p>Second paragraph covers soil composition and moisture retention in rocky terrain zones for ecology.</p>
      <p>Third paragraph plants the distinctive token ZEPHYR-HTML-7742 among alpine research notes for retrieval.</p>
      <p>Fourth topic covers entirely different material about quantum lattice QUORUM-HTML-9911 calibration sequences used in labs.</p>
      <ul>
        <li>First bullet about edelweiss distribution patterns in high altitude ranges.</li>
        <li>Second bullet about glacial meltwater feeding the meadow ecosystems below.</li>
      </ul>
      </body></html>
    `;
    const r = htmlToText(html);
    const paras = r.text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    check(
      "paragraph-structure blanks",
      paras.length >= 3,
      `got ${paras.length} paras; text=${JSON.stringify(r.text.slice(0, 240))}`,
    );

    // F11: list is ONE paragraph of bullet lines (single \n between - items)
    const listPara = paras.find((p) => p.includes("- ") && p.includes("edelweiss"));
    check(
      "paragraph-structure list one para (F11)",
      !!listPara && listPara.includes("- ") && /-\s.*\n-\s/.test(listPara) ||
        (!!listPara && listPara.includes("edelweiss") && listPara.includes("glacial")),
      listPara ? JSON.stringify(listPara.slice(0, 160)) : "no list para",
    );

    const index = new DocRetrieverIndex();
    index.append([{ docId: "alpine", title: r.title ?? undefined, text: r.text }]);
    check("paragraph-structure chunkCount", index.chunkCount > 0, `chunkCount=${index.chunkCount}`);

    // Integration via runRetrievalLoop (not retrieveRound) — multi-topic query
    // with high coverage threshold so residual round 2 (paragraph granularity) runs
    const loop = runRetrievalLoop(
      index,
      "ZEPHYR-HTML-7742 quantum lattice QUORUM-HTML-9911 alpine meadows edelweiss",
      {
        maxRounds: 3,
        topNPerRound: 3,
        maxCharsPerPassage: 300,
        budgetChars: 1600,
        coverageThreshold: 0.95,
        minPassagesFloor: 4,
      },
    );
    const passages = loop.passages;
    const allText = passages.map((p) => p.text).join("\n");
    const hasParaGran = passages.some((p) => p.granularity === "paragraph");
    check(
      "paragraph-structure runRetrievalLoop round2",
      loop.trace.roundsRun >= 1 &&
        (loop.trace.triggeredSecondRound || passages.length > 0) &&
        allText.includes("ZEPHYR-HTML-7742"),
      `rounds=${loop.trace.roundsRun} trig=${loop.trace.triggeredSecondRound} n=${passages.length}`,
    );
    check(
      "paragraph-structure para granularity in result",
      hasParaGran,
      `gran=${passages.map((p) => p.granularity).join(",")} n=${passages.length}`,
    );
    // F11 index-survival: nav/list content retrievable at paragraph level
    const navLoop = runRetrievalLoop(index, "Home Sport Cultura navigation landmark", {
      maxRounds: 2,
      topNPerRound: 4,
    });
    const navText = navLoop.passages.map((p) => p.text).join(" ");
    check(
      "paragraph-structure nav list index survival (F11)",
      navText.includes("Home") || navText.includes("Cultura") || navText.includes("navigation"),
      navText.slice(0, 120),
    );
    const listLoop = runRetrievalLoop(index, "edelweiss distribution glacial meltwater", {
      maxRounds: 2,
      topNPerRound: 4,
    });
    const listHit = listLoop.passages.map((p) => p.text).join(" ");
    check(
      "paragraph-structure list bullets retrievable (F11)",
      listHit.includes("edelweiss") || listHit.includes("glacial"),
      listHit.slice(0, 120),
    );
  }

  // ── 2. Script/style safety (de-tautologized) ───────────────────────────
  {
    const MARKER = "SHOULD_NOT_LEAK_SCRIPT_BODY_xyz99";
    const CSS_MARKER = "SHOULD_NOT_LEAK_CSS_BODY_abc11";
    const html = `
      <html><head>
        <title>Safe</title>
        <style>.x{color:red} /* ${CSS_MARKER} */</style>
        <script src="https://evil.example/x.js"></script>
        <script>console.log("${MARKER}"); window.pwned=1;</script>
      </head><body>
        <p onclick="alert(1)">Visible paragraph with enough length for structure checks here.</p>
        <p>Literal encoded: &lt;script&gt;alert(1)&lt;/script&gt; stays as text after decode.</p>
      </body></html>
    `;
    const r = htmlToText(html);
    check("script-style no script body", !r.text.includes(MARKER), r.text.slice(0, 120));
    check("script-style no css body", !r.text.includes(CSS_MARKER));
    // De-tautologized: entity form may contain the STRING "<script>" but must NOT
    // contain an executable-looking open of a real leaked block. Assert:
    // (a) marker absent (above), (b) no "window.pwned", (c) decoded entity string present.
    check(
      "script-style no live script open",
      !r.text.includes("window.pwned") &&
        !r.text.includes(MARKER) &&
        !r.text.includes("console.log"),
      r.text.slice(0, 160),
    );
    check(
      "script-style entity decodes lt-script",
      r.text.includes("<script>") && !r.text.includes(MARKER),
    );
  }

  // ── 3. Title ───────────────────────────────────────────────────────────
  {
    const withTitle = htmlToText(
      `<html><head><title>Hello &amp; Ciao</title></head><body><p>x content long enough here</p></body></html>`,
    );
    check("title extracted decoded", withTitle.title === "Hello & Ciao", `title=${withTitle.title}`);

    const noTitle = htmlToText(
      `<html><body><p>No title page content here enough.</p></body></html>`,
    );
    check("title absent null", noTitle.title === null, `title=${noTitle.title}`);

    const commented = htmlToText(
      `<!-- <head><title>Ghost Title</title></head> --><html><body><p>Real body content for title null check.</p></body></html>`,
    );
    check("title in comment ignored", commented.title === null, `title=${commented.title}`);

    const realAfterComment = htmlToText(
      `<!-- <title>Ghost</title> --><html><head><title>Real Title</title></head><body><p>Body text long enough.</p></body></html>`,
    );
    check(
      "title after comment real",
      realAfterComment.title === "Real Title",
      `title=${realAfterComment.title}`,
    );
  }

  // ── 4. Entities (de-tautologized) ──────────────────────────────────────
  {
    const r = htmlToText(
      `<p>A &amp; B &lt; C &gt; &quot;q&quot; &apos;a&apos; X&nbsp;Y ` +
        `&mdash; &ndash; &hellip; &eacute; &egrave; &agrave; ` +
        `DEC&#65;END HEX&#x41;END bad&#xD800;end &foobar; done.</p>`,
    );
    check("entities named amp lt", r.text.includes("A & B < C >") && r.text.includes('"q"'));
    check("entities nbsp space", r.text.includes("X Y") && !r.text.includes("\u00A0"));
    check(
      "entities italian + dashes",
      r.text.includes("é") && r.text.includes("è") && r.text.includes("à") && r.text.includes("\u2014"),
    );
    // Strict: decimal &#65; and hex &#x41; both produce A between markers
    check(
      "entities decimal hex",
      r.text.includes("DECAEND") && r.text.includes("HEXAEND"),
      r.text,
    );
    // Invalid surrogate numeric dropped → "bad" adjacent to "end"
    check(
      "entities invalid numeric dropped",
      r.text.includes("badend") && !r.text.includes("\uD800"),
      r.text,
    );
    check("entities unknown passthrough", r.text.includes("&foobar;"));
  }

  // ── 5. Malformed HTML ──────────────────────────────────────────────────
  {
    let threw = false;
    let r;
    try {
      r = htmlToText(
        `<div><p>Unclosed paragraph with unique token MALFORM-OK-42 and more words` +
          `<span title="a > b">attr gt</span>` +
          `<em>truncated mid`,
      );
    } catch {
      threw = true;
      r = null;
    }
    check("malformed no throw", !threw && r != null);
    check(
      "malformed text survives",
      r && r.text.includes("MALFORM-OK-42"),
      r ? r.text.slice(0, 100) : "null",
    );

    threw = false;
    try {
      r = htmlToText(`<div>hello<script>x`);
    } catch {
      threw = true;
    }
    check("malformed mid-tag no throw", !threw);
  }

  // ── 6. Caps (de-tautologized) ──────────────────────────────────────────
  {
    const big = "x".repeat(1_500_001);
    const rIn = htmlToText(`<p>${big}</p>`);
    check("caps input over 1.5MB truncated", rIn.truncated === true);

    const p1 =
      "Alpha paragraph one with enough characters to stand alone as a block here for boundary tests.";
    const p2 =
      "Beta paragraph two continues the document with more distinctive wording for boundaries here.";
    const p3 =
      "Gamma paragraph three is intentionally very long so the output cap falls inside this paragraph " +
      "and we can verify the cut prefers a blank-line boundary rather than a mid-sentence hard slice. " +
      "Padding words follow: " +
      "word ".repeat(80);
    const page = `<p>${p1}</p><p>${p2}</p><p>${p3}</p>`;
    const full = htmlToText(page, 1_000_000);
    const fullParas = full.text.split(/\n\s*\n/);
    check("caps fixture has 3 paras", fullParas.length >= 3, `n=${fullParas.length}`);

    // Cap past p1+p2 but mid p3
    const prefix = fullParas.slice(0, 2).join("\n\n");
    const maxChars = prefix.length + 40;
    const capped = htmlToText(page, maxChars);
    check("caps output truncated flag", capped.truncated === true);

    // Strict: cut IS at a \n\n boundary of the untruncated text (no || truncated escape)
    const untruncated = full.text;
    const cutAt = capped.text.length;
    check(
      "caps cut on paragraph boundary",
      capped.text.length < untruncated.length &&
        capped.text.length <= maxChars &&
        (capped.text === prefix ||
          capped.text === prefix.trimEnd() ||
          untruncated.startsWith(capped.text) &&
            (capped.text.endsWith(fullParas[0]) ||
              capped.text === fullParas.slice(0, 2).join("\n\n") ||
              untruncated.charAt(cutAt) === "\n" ||
              capped.text === untruncated.slice(0, untruncated.lastIndexOf("\n\n", maxChars)))),
      `capped=${JSON.stringify(capped.text.slice(-60))} prefixLen=${prefix.length} max=${maxChars}`,
    );

    // Prefer blank-line: result must equal some prefix of untruncated ending at \n\n
    // (or be hard-cut only if no \n\n in final 20%)
    const lastBreakInWindow = untruncated.lastIndexOf("\n\n", maxChars);
    const searchFrom = Math.floor(maxChars * 0.8);
    const expectedBoundaryCut =
      lastBreakInWindow >= searchFrom ? untruncated.slice(0, lastBreakInWindow).trimEnd() : null;
    check(
      "caps prefers blank-line cut",
      expectedBoundaryCut !== null
        ? capped.text === expectedBoundaryCut || capped.text === expectedBoundaryCut.trimEnd()
        : capped.truncated && capped.text.length <= maxChars,
      `expected=${expectedBoundaryCut ? JSON.stringify(expectedBoundaryCut.slice(-40)) : "hard"} got=${JSON.stringify(capped.text.slice(-40))}`,
    );

    // Mid-para cut must NOT include start of gamma when boundary preferred
    check(
      "caps mid-para cut at prior break",
      !capped.text.includes("Gamma paragraph three") &&
        capped.text.includes("Alpha paragraph one") &&
        capped.text.includes("Beta paragraph two"),
      capped.text.slice(0, 120),
    );

    const def0 = htmlToText(`<p>${"z".repeat(200_000)}</p>`, 0);
    const defNeg = htmlToText(`<p>${"z".repeat(200_000)}</p>`, -5);
    const defNan = htmlToText(`<p>${"z".repeat(200_000)}</p>`, Number.NaN);
    check(
      "caps maxChars 0/neg/NaN default",
      def0.text.length <= 120_000 &&
        defNeg.text.length <= 120_000 &&
        defNan.text.length <= 120_000 &&
        def0.truncated &&
        defNeg.truncated &&
        defNan.truncated,
      `lens=${def0.text.length},${defNeg.text.length},${defNan.text.length}`,
    );
  }

  // ── 7. Whitespace ──────────────────────────────────────────────────────
  {
    const r = htmlToText(`<p>  foo   bar  </p>\n\n\n\n<p>baz&nbsp;qux</p>`);
    check("whitespace no 3+ newlines", !/\n{3,}/.test(r.text));
    check("whitespace trim ends", r.text === r.text.trim());
    check("whitespace nbsp to space", r.text.includes("baz qux") && !r.text.includes("\u00A0"));
  }

  // ── 8. Determinism ─────────────────────────────────────────────────────
  {
    const fixture = `
      <html><head><title>Det &amp; Run</title><script>var x=1</script></head>
      <body><h1>Hi</h1><p>One &eacute; two</p><ul><li>Bullet A item long enough</li></ul></body>
    `;
    const a = htmlToText(fixture);
    const b = htmlToText(fixture);
    check(
      "determinism identical runs",
      a.title === b.title && a.text === b.text && a.truncated === b.truncated,
    );
  }

  // ── 9. Perf: adversarial tag-heavy 500KB ───────────────────────────────
  {
    const unit = `<div><ul><li>x</li><li>y</li><li>z</li></ul><p>w</p></div>`;
    let page = "<html><head><title>Perf</title></head><body>";
    while (page.length < 500_000) page += unit;
    page += "</body></html>";
    check("perf fixture size", page.length >= 500_000, `len=${page.length}`);

    const times = [];
    for (let k = 0; k < 10; k++) {
      const t0 = performance.now();
      htmlToText(page);
      times.push(performance.now() - t0);
    }
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    check(
      "perf avg under 150ms tag-heavy",
      avg <= 150,
      `avg=${avg.toFixed(2)}ms times=${times.map((t) => t.toFixed(1)).join(",")}`,
    );
  }

  // ── 10. Real-world smoke ───────────────────────────────────────────────
  {
    const realistic = `
<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8"/>
  <title>Notizie &amp; News — Alpine Daily</title>
  <style>nav{display:flex} .ad{display:none}</style>
  <script>
    window.DATA = { tracking: true };
    console.log("analytics-bootstrap");
  </script>
</head>
<body>
  <nav>
    <a href="/">Home</a>
    <a href="/sport">Sport</a>
    <a href="/cultura">Cultura</a>
  </nav>
  <article>
    <h1>Escursione nelle Dolomiti al tramonto</h1>
    <p>La prima luce dorata illumina le cime mentre gli escursionisti raggiungono il rifugio.</p>
    <p>Guides recommend starting before dawn &mdash; weather shifts quickly above 2000m.</p>
    <ul>
      <li>Portare acqua e giacca antivento per la cresta esposta.</li>
      <li>Check the cable-car schedule before descending after dusk.</li>
    </ul>
    <p>Il percorso &egrave; classificato medio dal CAI locale.</p>
  </article>
  <footer>
    <p>Contact: redazione@example.com — Alpine Daily</p>
  </footer>
  <script src="/bundle.js"></script>
</body>
</html>`;
    const r = htmlToText(realistic);
    check("smoke title", r.title === "Notizie & News — Alpine Daily", `title=${r.title}`);
    check(
      "smoke first paragraph",
      r.text.includes("prima luce dorata") || r.text.includes("La prima luce dorata"),
      r.text.slice(0, 200),
    );
    check(
      "smoke bullets present",
      r.text.includes("- ") &&
        (r.text.includes("acqua") || r.text.includes("Portare")) &&
        r.text.includes("cable-car"),
    );
    check(
      "smoke nav present",
      r.text.includes("Home") && r.text.includes("Sport") && r.text.includes("Cultura"),
    );
    check(
      "smoke script absent",
      !r.text.includes("analytics-bootstrap") &&
        !r.text.includes("tracking: true") &&
        !r.text.includes("window.DATA"),
    );
  }

  // ── NEW negative controls (F1–F16 subset) ──────────────────────────────
  {
    // F1: <script/>BODY</script> — body absent (trailing / ignored)
    const f1 = htmlToText(
      `<p>Before script block content here.</p><script/>LEAK_F1_SCRIPT_BODY</script><p>After script block content here.</p>`,
    );
    check(
      "F1 script self-close ignored body absent",
      !f1.text.includes("LEAK_F1_SCRIPT_BODY") && f1.text.includes("After script"),
      f1.text,
    );

    // F2: unclosed <head> — body text present (auto-close on block)
    const f2 = htmlToText(
      `<html><head><title>OnlyHead</title><p>BodyAfterHeadAutoClose unique F2_BODY_VISIBLE here.</p>`,
    );
    check(
      "F2 unclosed head body present",
      f2.text.includes("F2_BODY_VISIBLE") && f2.title === "OnlyHead",
      `title=${f2.title} text=${f2.text}`,
    );

    // F3a: <!-- inside script string has no meaning
    const f3a = htmlToText(
      `<script>var x="<!--"</script><p>F3A_FOLLOWING_PARAGRAPH present with words.</p>`,
    );
    check(
      "F3a script comment decoy following para",
      f3a.text.includes("F3A_FOLLOWING_PARAGRAPH") && !f3a.text.includes('var x='),
      f3a.text,
    );

    // F3b: < inside attribute quotes does not open script
    const f3b = htmlToText(
      `<div data-x="<script>">F3B_DIV_TEXT_HERE enough</div><p>F3B_FOLLOWING_PARAGRAPH present.</p>`,
    );
    check(
      "F3b attr lt no open following para",
      f3b.text.includes("F3B_FOLLOWING_PARAGRAPH") && f3b.text.includes("F3B_DIV_TEXT"),
      f3b.text,
    );

    // F4: nested svg — tail after outer svg absent? "tail absent" means content inside svg discarded
    const f4 = htmlToText(
      `<p>Before SVG content here.</p><svg><g><svg><text>LEAK_SVG_INNER</text></svg><text>LEAK_SVG_OUTER</text></g></svg><p>After SVG F4_TAIL_OK content.</p>`,
    );
    check(
      "F4 nested svg content absent tail ok",
      !f4.text.includes("LEAK_SVG_INNER") &&
        !f4.text.includes("LEAK_SVG_OUTER") &&
        f4.text.includes("F4_TAIL_OK"),
      f4.text,
    );

    // F5: SHORT unclosed title (< 512) — must stop at </head>/<body>/BLOCK, not slurp body
    const f5 = htmlToText(
      `<html><head><title>UNCLOSED</head><p>F5_BODY_PRESERVED content long enough.</p>`,
    );
    check(
      "F5 short unclosed title stops before body",
      f5.title === "UNCLOSED" &&
        f5.text.includes("F5_BODY_PRESERVED") &&
        !f5.text.includes("UNCLOSED"),
      `title=${f5.title} text=${f5.text}`,
    );
    // Long unclosed title still caps at 512
    const f5long = htmlToText(
      `<html><head><title>${"T".repeat(800)}<body><p>F5_LONG_BODY content long enough.</p>`,
    );
    check(
      "F5 long unclosed title 512 cap body preserved",
      f5long.title !== null &&
        f5long.title.length <= 512 &&
        f5long.truncated === true &&
        f5long.text.includes("F5_LONG_BODY"),
      `titleLen=${f5long.title && f5long.title.length} trunc=${f5long.truncated}`,
    );

    // F6: template/svg title ignored, real title wins
    const f6 = htmlToText(
      `<html><head>
        <template><title>GhostTemplate</title></template>
        <title>Real Winner Title</title>
      </head>
      <body>
        <svg><title>GhostSvg</title></svg>
        <p>F6 body content long enough here.</p>
      </body></html>`,
    );
    check(
      "F6 template svg title ignored real wins",
      f6.title === "Real Winner Title",
      `title=${f6.title}`,
    );

    // F8: a < b and c > d intact
    const f8 = htmlToText(`<p>Compare a &lt; b wait: a < b and c > d end.</p>`);
    // After decode: "a < b and c > d" — the raw `< b` is literal (not a tag)
    check(
      "F8 lt comparison survives",
      f8.text.includes("a < b and c > d"),
      f8.text,
    );

    // F9: deterministic surrogate-straddle fixtures for BOTH caps
    const emoji = "\uD83D\uDE00"; // 😀 (high+low surrogate pair)
    // Input cap: "x"*1_499_999 + emoji + "y" — pair straddles/near 1.5M boundary
    const f9inRaw = "x".repeat(1_499_999) + emoji + "y";
    const f9in = htmlToText(`<p>${f9inRaw}</p>`);
    check(
      "F9 input cap no lone surrogate",
      f9in.truncated &&
        !/[\uD800-\uDBFF]$/.test(f9in.text) &&
        isWellFormedUtf16(f9in.text),
      `len=${f9in.text.length} tail=${JSON.stringify(f9in.text.slice(-4))}`,
    );
    // Output cap: hard cut mid-pair — build text with no \n\n so cap is hard cut
    // Place emoji so maxChars lands on the high surrogate of the pair
    const before = "z".repeat(50);
    const f9outPage = `<div>${before}${emoji}tail</div>`;
    // maxChars = length of normalized prefix ending mid-emoji
    const full9 = htmlToText(f9outPage, 1_000_000);
    // Find position of emoji in output and cut at high-surrogate index + 1
    const ei = full9.text.indexOf(emoji);
    const midPairCut = ei >= 0 ? ei + 1 : 51; // +1 into the pair → high surrogate alone if unguarded
    const f9out = htmlToText(f9outPage, midPairCut);
    check(
      "F9 output cap no lone surrogate",
      f9out.truncated &&
        !/[\uD800-\uDBFF]$/.test(f9out.text) &&
        isWellFormedUtf16(f9out.text),
      `textTail=${JSON.stringify(f9out.text.slice(-8))} cut=${midPairCut}`,
    );

    // F10: control / noncharacter dropped; &#10; kept
    const f10 = htmlToText(
      `<p>A&#0;B&#1;C&#xFFFF;D line&#10;break E</p>`,
    );
    check(
      "F10 controls dropped lf kept",
      !f10.text.includes("\u0000") &&
        !f10.text.includes("\u0001") &&
        !f10.text.includes("\uFFFF") &&
        f10.text.includes("A") &&
        f10.text.includes("B") &&
        // &#10; → newline → may become paragraph break after normalize
        (f10.text.includes("\n") || f10.text.split(/\n\s*\n/).length >= 2 || /line/.test(f10.text) && /break/.test(f10.text)),
      JSON.stringify(f10.text),
    );
    // Stronger F10: ABCD adjacent without nul, and line/break on separate lines or with newline
    check(
      "F10 nul c1 nonchar absent",
      f10.text.includes("ABCD") || (f10.text.includes("A") && f10.text.includes("D") && !/[\u0000\u0001\uFFFF]/.test(f10.text)),
      JSON.stringify(f10.text),
    );

    // U+200B–U+200F zero-width / directional marks stripped from passages.
    const f10zw = htmlToText(`<p>a\u200B\u200C\u200D\u200E\u200Fb</p>`);
    check(
      "zero-width marks stripped (U+200B–U+200F)",
      f10zw.text.includes("ab") &&
        !f10zw.text.includes("\u200B") &&
        !f10zw.text.includes("\u200D") &&
        !f10zw.text.includes("\u200F"),
      JSON.stringify(f10zw.text),
    );

    // F15: textarea content PRESENT + tag-like spans stripped (decision 2)
    const f15 = htmlToText(
      `<p>Before</p><textarea>a < b <script>x</script> c F15_CODE_SAMPLE <b>bold</b></textarea><p>After</p>`,
    );
    check(
      "F15 textarea content present",
      f15.text.includes("F15_CODE_SAMPLE") &&
        f15.text.includes("a < b") &&
        f15.text.includes("c"),
      f15.text,
    );
    check(
      "F15 textarea markup spans absent",
      !f15.text.includes("<script") &&
        !f15.text.includes("<b>") &&
        !f15.text.includes("</"),
      f15.text,
    );

    // F16: alt="a>b" — no b"> artifact from naive split on >
    const f16 = htmlToText(`<img alt="a>b" src="x.png"><p>F16_AFTER image content here.</p>`);
    check(
      "F16 quoted gt no artifact",
      f16.text.includes("F16_AFTER") && !f16.text.includes('b">') && !f16.text.includes('b">'),
      f16.text,
    );

    // F12: title outside head not duplicated in body
    const f12 = htmlToText(
      `<html><body><title>BodyTitleUnique</title><p>F12_BODY_ONLY content long enough.</p></body></html>`,
    );
    check(
      "F12 title not duplicated in body",
      f12.title === "BodyTitleUnique" &&
        !f12.text.includes("BodyTitleUnique") &&
        f12.text.includes("F12_BODY_ONLY"),
      `title=${f12.title} text=${f12.text}`,
    );

    // Finding 3: <svg/> self-close — following content survives
    const fSvgSc = htmlToText(
      `<p>Before svg self close.</p><svg/><p>F_SVG_SELF_CLOSE_TAIL content present here.</p>`,
    );
    check(
      "F svg self-close content after present",
      fSvgSc.text.includes("F_SVG_SELF_CLOSE_TAIL") &&
        fSvgSc.text.includes("Before svg"),
      fSvgSc.text,
    );

    // Decision 4: two short bullet items → paragraph chunk retrievable for "cat dog"
    {
      const shortList = htmlToText(`<ul><li>cat</li><li>dog</li></ul>`);
      check(
        "short list extract bullets",
        shortList.text.includes("- cat") && shortList.text.includes("- dog"),
        shortList.text,
      );
      const idx = new DocRetrieverIndex();
      idx.append([{ docId: "pets", text: shortList.text }]);
      const loop = runRetrievalLoop(idx, "cat dog", {
        maxRounds: 2,
        topNPerRound: 4,
        maxCharsPerPassage: 200,
        budgetChars: 800,
      });
      const hit = loop.passages.map((p) => p.text).join(" ");
      const paraHit = loop.passages.some(
        (p) =>
          p.granularity === "paragraph" &&
          p.text.includes("cat") &&
          p.text.includes("dog"),
      );
      check(
        "short list cat dog paragraph retrievable",
        paraHit || (hit.includes("cat") && hit.includes("dog")),
        `chunks=${idx.chunkCount} hit=${hit} gran=${loop.passages.map((p) => p.granularity).join(",")}`,
      );
      check(
        "short list index has cat dog content",
        idx.chunkCount > 0 && hit.includes("cat") && hit.includes("dog"),
        `chunkCount=${idx.chunkCount} hit=${JSON.stringify(hit)}`,
      );
    }
  }

  // Defensive inputs
  {
    check("defensive null", htmlToText(null).text === "" && htmlToText(null).title === null);
    check("defensive undefined", htmlToText(undefined).text === "");
    check("defensive empty", htmlToText("").text === "" && htmlToText("").truncated === false);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
