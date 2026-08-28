/**
 * Harness for src/util/pdfBridgeProtocol.ts (+ end-to-end with pdfText.ts).
 *
 * Compiles pure modules into scripts/.build, runs plain-Node asserts,
 * prints named PASS/FAIL lines, process.exit(0|1).
 *
 * Mutation-sensitive: each hostile input asserts an exact reason; cap
 * invariants are relational; F1 (oversized page) must fail-closed.
 */
import { spawnSync } from "node:child_process";
import { existsSync, unlinkSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");
const fixturesDir = path.join(projectRoot, "scripts/fixtures/pdf");

function deleteStaleBuild() {
  const owned = [
    path.join(projectRoot, "scripts/.build/util/pdfBridgeProtocol.js"),
    path.join(projectRoot, "scripts/.build/src/util/pdfBridgeProtocol.js"),
    path.join(projectRoot, "scripts/.build/util/pdfText.js"),
    path.join(projectRoot, "scripts/.build/src/util/pdfText.js"),
    path.join(projectRoot, "scripts/.build/pdfBridgeProtocol.js"),
    path.join(projectRoot, "scripts/.build/pdfText.js"),
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
      "src/util/pdfBridgeProtocol.ts",
      "src/util/pdfText.ts",
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

function loadFixture(name) {
  const fp = path.join(fixturesDir, `${name}.json`);
  if (!existsSync(fp)) throw new Error(`Missing golden fixture: ${fp}`);
  return JSON.parse(readFileSync(fp, "utf8"));
}

/**
 * Simulate component handleMessage classification for parse failures.
 * Returns "fail_cap" | "ignore_malformed" | "ok".
 */
function classifyParse(parsed) {
  if (parsed.ok) return "ok";
  if (parsed.category === "cap") return "fail_cap";
  return "ignore_malformed";
}

async function main() {
  compile();

  const bridgePath = resolveBuilt("pdfBridgeProtocol.js");
  const pdfPath = resolveBuilt("pdfText.js");

  const {
    parseBridgeMessage,
    PdfBridgeAccumulator,
    buildTextChunkMessages,
    buildImageChunkMessages,
    splitIntoChunks,
    parseTextItemsJson,
    projectTextItem,
    reconcileTextPassPages,
    sanitizePdfSourceId,
    clampMaxPages,
    maxChunksForPayload,
    MAX_PDF_PAGES,
    MAX_ITEMS_PER_PAGE,
    MAX_ITEM_STR_CHARS,
    MAX_TOTAL_TEXT_BYTES,
    MAX_PAGE_PAYLOAD_BYTES,
    MAX_CHUNKS_PER_PAGE,
    CHUNK_SIZE,
    PAGE_TIMEOUT_MS,
    TOTAL_EXTRACTION_TIMEOUT_MS,
  } = await import(pathToFileURL(bridgePath).href);

  const { buildPdfPageTexts, reconstructPageText } = await import(
    pathToFileURL(pdfPath).href
  );

  // ── Cap relation invariants (not literal equality of constants) ──────────
  check(
    "invariant_chunks_cover_payload",
    MAX_CHUNKS_PER_PAGE * CHUNK_SIZE >= MAX_PAGE_PAYLOAD_BYTES,
    `chunks=${MAX_CHUNKS_PER_PAGE} size=${CHUNK_SIZE} payload=${MAX_PAGE_PAYLOAD_BYTES}`,
  );
  check(
    "invariant_max_chunks_matches_derivation",
    MAX_CHUNKS_PER_PAGE === maxChunksForPayload(MAX_PAGE_PAYLOAD_BYTES, CHUNK_SIZE),
  );
  check(
    "invariant_image_jpeg_budget",
    // Legitimate ~4 MB base64 JPEG must fit under payload + chunk transport.
    MAX_PAGE_PAYLOAD_BYTES >= 4_000_000 &&
      Math.ceil(4_000_000 / CHUNK_SIZE) <= MAX_CHUNKS_PER_PAGE,
    `payload=${MAX_PAGE_PAYLOAD_BYTES} chunks=${MAX_CHUNKS_PER_PAGE}`,
  );
  check(
    "invariant_item_str_vs_payload",
    MAX_ITEM_STR_CHARS > 0 && MAX_ITEM_STR_CHARS < MAX_PAGE_PAYLOAD_BYTES,
  );
  check(
    "invariant_total_text_lt_sum_page_caps",
    MAX_TOTAL_TEXT_BYTES <= MAX_PAGE_PAYLOAD_BYTES * MAX_PDF_PAGES,
  );
  check(
    "invariant_ranges",
    MAX_PDF_PAGES >= 1 &&
      MAX_ITEMS_PER_PAGE >= 1000 &&
      CHUNK_SIZE >= 1000 &&
      PAGE_TIMEOUT_MS >= 1000 &&
      TOTAL_EXTRACTION_TIMEOUT_MS >= PAGE_TIMEOUT_MS,
  );

  // ── Per-input hostile assertions (exact reason) ──────────────────────────
  const hostileCases = [
    { name: "null", raw: null, category: "malformed", reason: "non_string" },
    { name: "undefined", raw: undefined, category: "malformed", reason: "non_string" },
    { name: "number", raw: 42, category: "malformed", reason: "non_string" },
    { name: "empty", raw: "", category: "malformed", reason: "non_string" },
    { name: "half_json", raw: "{", category: "malformed", reason: "invalid_json" },
    { name: "array", raw: "[]", category: "malformed", reason: "not_object" },
    { name: "json_string", raw: '"string"', category: "malformed", reason: "not_object" },
    { name: "json_null", raw: "null", category: "malformed", reason: "not_object" },
    {
      name: "unknown_shape",
      raw: JSON.stringify({ weird: true }),
      category: "malformed",
      reason: "unknown_shape",
    },
    {
      name: "page_string",
      raw: JSON.stringify({ page: "1", chunk: 0, total: 1, data: "x" }),
      category: "malformed",
      reason: "bad_page",
    },
    {
      name: "page_zero",
      raw: JSON.stringify({ page: 0, chunk: 0, total: 1, data: "x" }),
      category: "malformed",
      reason: "bad_page",
    },
    {
      name: "page_over_cap",
      raw: JSON.stringify({ page: 99, chunk: 0, total: 1, data: "x" }),
      category: "cap",
      reason: "page_cap",
    },
    {
      name: "chunk_neg",
      raw: JSON.stringify({ page: 1, chunk: -1, total: 1, data: "x" }),
      category: "malformed",
      reason: "bad_chunk_index",
    },
    {
      name: "total_zero",
      raw: JSON.stringify({ page: 1, chunk: 0, total: 0, data: "x" }),
      category: "malformed",
      reason: "bad_chunk_total",
    },
    {
      name: "chunk_ge_total",
      raw: JSON.stringify({ page: 1, chunk: 5, total: 2, data: "x" }),
      category: "malformed",
      reason: "chunk_out_of_range",
    },
    {
      name: "empty_error",
      raw: JSON.stringify({ error: "" }),
      category: "malformed",
      reason: "bad_error",
    },
    {
      name: "error_number",
      raw: JSON.stringify({ error: 123 }),
      category: "malformed",
      reason: "bad_error",
    },
    {
      name: "text_chunk_no_data",
      raw: JSON.stringify({ kind: "textChunk", page: 1, chunk: 0, total: 1 }),
      category: "malformed",
      reason: "bad_data",
    },
    {
      name: "unknown_kind",
      raw: JSON.stringify({ kind: "nope" }),
      category: "malformed",
      reason: "unknown_shape",
    },
  ];

  let hostileThrew = false;
  for (const c of hostileCases) {
    try {
      const r = parseBridgeMessage(c.raw);
      check(
        `hostile_${c.name}_rejected`,
        r.ok === false && r.category === c.category && r.reason === c.reason,
        r.ok
          ? "accepted"
          : `got category=${r.category} reason=${r.reason} expected ${c.category}/${c.reason}`,
      );
    } catch (e) {
      hostileThrew = true;
      check(`hostile_${c.name}_rejected`, false, String(e));
    }
  }
  check("hostile_never_throws", !hostileThrew);

  // message_too_large is a CAP (fail-closed), not ignore
  {
    const huge = "x".repeat(MAX_PAGE_PAYLOAD_BYTES + 5000);
    const r = parseBridgeMessage(huge);
    check(
      "message_too_large_is_cap",
      r.ok === false && r.category === "cap" && r.reason === "message_too_large",
    );
    check("message_too_large_fail_closed", classifyParse(r) === "fail_cap");
  }

  // ── Guard contracts that mutation previously left green ──────────────────

  // chunk_too_large
  {
    const r = parseBridgeMessage(
      JSON.stringify({
        page: 1,
        chunk: 0,
        total: 1,
        data: "y".repeat(CHUNK_SIZE + 2000),
      }),
    );
    check(
      "guard_chunk_too_large",
      r.ok === false && r.category === "cap" && r.reason === "chunk_too_large",
    );
  }

  // chunk >= total (already in hostile, but named guard)
  {
    const r = parseBridgeMessage(
      JSON.stringify({ page: 1, chunk: 3, total: 3, data: "x" }),
    );
    check(
      "guard_chunk_ge_total",
      r.ok === false && r.reason === "chunk_out_of_range",
    );
  }

  // Accumulator page cap
  {
    const acc = new PdfBridgeAccumulator({ maxPages: 2 });
    const e = acc.feed({
      kind: "textChunk",
      page: 3,
      chunk: 0,
      total: 1,
      data: "[]",
    });
    check(
      "guard_acc_page_cap",
      e.type === "cap_exceeded" && e.reason === "page_out_of_range",
    );
  }

  // ambiguous {page, done, chunk}
  {
    const r = parseBridgeMessage(
      JSON.stringify({ page: 1, done: true, chunk: 0, total: 1, data: "x" }),
    );
    check(
      "guard_ambiguous_page_done",
      r.ok === false && r.reason === "ambiguous_page_done",
    );
  }

  // chunk_total_mismatch
  {
    const acc = new PdfBridgeAccumulator();
    acc.feed({
      kind: "textChunk",
      page: 1,
      chunk: 0,
      total: 2,
      data: "aa",
    });
    const e = acc.feed({
      kind: "textChunk",
      page: 1,
      chunk: 1,
      total: 3,
      data: "bb",
    });
    check(
      "guard_chunk_total_mismatch",
      e.type === "cap_exceeded" && e.reason === "chunk_total_mismatch",
    );
  }

  // double textPassDone
  {
    const acc = new PdfBridgeAccumulator();
    const e1 = acc.feed({ kind: "textPassDone", pageCount: 1 });
    const e2 = acc.feed({ kind: "textPassDone", pageCount: 1 });
    check("guard_double_text_pass_first", e1.type === "text_pass_done" && e1.pageCount === 1);
    check("guard_double_text_pass_second_noop", e2.type === "noop");
  }

  // meta itemCount clamp
  {
    const r = parseBridgeMessage(
      JSON.stringify({
        kind: "textPageDone",
        page: 1,
        getTextContentMs: 1,
        itemCount: MAX_ITEMS_PER_PAGE + 999,
        projectedBytes: 10,
      }),
    );
    check(
      "guard_item_count_clamp",
      r.ok && r.message.kind === "textPageDone" && r.message.itemCount === MAX_ITEMS_PER_PAGE,
    );
  }

  // projectedBytes clamp
  {
    const r = parseBridgeMessage(
      JSON.stringify({
        kind: "textPageDone",
        page: 1,
        getTextContentMs: 1,
        itemCount: 1,
        projectedBytes: MAX_PAGE_PAYLOAD_BYTES + 1,
      }),
    );
    check(
      "guard_projected_bytes_clamp",
      r.ok &&
        r.message.kind === "textPageDone" &&
        r.message.projectedBytes === MAX_PAGE_PAYLOAD_BYTES,
    );
  }

  // Valid messages still parse
  {
    const r = parseBridgeMessage(JSON.stringify({ error: "boom" }));
    check("parse_error_ok", r.ok === true && r.message.error === "boom");
  }
  {
    const r = parseBridgeMessage(
      JSON.stringify({ page: 1, chunk: 0, total: 1, data: "abc" }),
    );
    check(
      "parse_image_chunk_ok",
      r.ok && !("kind" in r.message) && r.message.page === 1 && r.message.data === "abc",
    );
  }
  {
    const r = parseBridgeMessage(
      JSON.stringify({
        kind: "textChunk",
        page: 1,
        chunk: 0,
        total: 1,
        data: "[]",
      }),
    );
    check("parse_text_chunk_ok", r.ok && r.message.kind === "textChunk");
  }

  // ── F1 regression: oversize page must FAIL, never silent success ─────────
  {
    // Text: total chunks beyond cap → parse category cap on first message
    const overTotal = MAX_CHUNKS_PER_PAGE + 1;
    const textMsg = {
      kind: "textChunk",
      page: 1,
      chunk: 0,
      total: overTotal,
      data: "x",
    };
    const parsedText = parseBridgeMessage(JSON.stringify(textMsg));
    check(
      "f1_text_oversize_parse_cap",
      parsedText.ok === false &&
        parsedText.category === "cap" &&
        parsedText.reason === "chunk_total_cap",
    );
    check("f1_text_oversize_fail_closed", classifyParse(parsedText) === "fail_cap");

    // Even if parser were bypassed, accumulator fails
    const acc = new PdfBridgeAccumulator();
    const ev = acc.feed({
      kind: "textChunk",
      page: 1,
      chunk: 0,
      total: overTotal,
      data: "x",
    });
    check(
      "f1_text_oversize_acc_cap",
      ev.type === "cap_exceeded" && ev.reason === "chunk_total_cap",
    );
    check("f1_text_oversize_not_complete", !acc.isTextPageComplete(1));
  }

  {
    // Image mode variant: same silent-drop regression
    const overTotal = MAX_CHUNKS_PER_PAGE + 1;
    const imgMsg = {
      page: 1,
      chunk: 0,
      total: overTotal,
      data: "AA",
    };
    const parsedImg = parseBridgeMessage(JSON.stringify(imgMsg));
    check(
      "f1_image_oversize_parse_cap",
      parsedImg.ok === false &&
        parsedImg.category === "cap" &&
        parsedImg.reason === "chunk_total_cap",
    );
    check("f1_image_oversize_fail_closed", classifyParse(parsedImg) === "fail_cap");

    const acc = new PdfBridgeAccumulator();
    // Feed as if parser accepted (mutation would) — still cap in acc
    const ev = acc.feed({
      page: 1,
      chunk: 0,
      total: overTotal,
      data: "AA",
    });
    check(
      "f1_image_oversize_acc_cap",
      ev.type === "cap_exceeded" && ev.reason === "chunk_total_cap",
    );
    check("f1_image_oversize_not_complete", !acc.isImagePageComplete(1));
  }

  {
    // Legitimate multi-MB image under the raised payload must succeed
    const size = 4_000_000;
    const b64 = "A".repeat(size);
    const msgs = buildImageChunkMessages(1, b64, CHUNK_SIZE);
    check(
      "f1_legit_jpeg_chunk_count_ok",
      msgs.length <= MAX_CHUNKS_PER_PAGE && msgs.length >= 1,
      `n=${msgs.length} max=${MAX_CHUNKS_PER_PAGE}`,
    );
    const acc = new PdfBridgeAccumulator();
    let completed = false;
    let lastType = null;
    for (const m of msgs) {
      const parsed = parseBridgeMessage(JSON.stringify(m));
      if (!parsed.ok) {
        lastType = `parse_${parsed.reason}`;
        break;
      }
      const ev = acc.feed(parsed.message);
      lastType = ev.type;
      if (ev.type === "image_page") {
        completed = ev.base64.length === size;
      }
    }
    check("f1_legit_jpeg_delivers", completed, `last=${lastType}`);
  }

  // ── X1: per-page done is NOT global done ─────────────────────────────────
  {
    const pageDone = parseBridgeMessage(JSON.stringify({ page: 1, done: true }));
    check(
      "x1_page_done_has_page",
      pageDone.ok &&
        "page" in pageDone.message &&
        pageDone.message.done === true &&
        pageDone.message.page === 1,
    );
    const globalDone = parseBridgeMessage(JSON.stringify({ done: true }));
    check(
      "x1_global_done_no_page",
      globalDone.ok &&
        !("page" in globalDone.message) &&
        globalDone.message.done === true,
    );

    const acc = new PdfBridgeAccumulator();
    const e1 = acc.feed(pageDone.message);
    check("x1_feed_page_done_not_global", e1.type === "noop" && !acc.hasGlobalDone());
    const e2 = acc.feed(globalDone.message);
    check("x1_feed_global_done", e2.type === "global_done" && acc.hasGlobalDone());
  }

  // ── Out-of-order chunks ──────────────────────────────────────────────────
  {
    const acc = new PdfBridgeAccumulator();
    const items = [{ str: "hello" }, { str: " world" }];
    const json = JSON.stringify(items);
    const parts = splitIntoChunks(json, 4);
    check("split_multi_chunks", parts.length >= 2, `n=${parts.length}`);

    const events = [];
    for (let i = parts.length - 1; i >= 0; i--) {
      const msg = {
        kind: "textChunk",
        page: 1,
        chunk: i,
        total: parts.length,
        data: parts[i],
      };
      const parsed = parseBridgeMessage(JSON.stringify(msg));
      check(`ooo_parse_${i}`, parsed.ok);
      events.push(acc.feed(parsed.message));
    }
    const completed = events.filter((e) => e.type === "text_page");
    check("ooo_chunks_complete_once", completed.length === 1);
    check(
      "ooo_text_matches",
      completed[0] &&
        JSON.stringify(completed[0].items.map((it) => it.str)) ===
          JSON.stringify(items.map((it) => it.str)),
    );
    check("ooo_is_complete", acc.isTextPageComplete(1));
  }

  // ── Duplicated chunk index (first-write-wins) ────────────────────────────
  {
    const acc = new PdfBridgeAccumulator();
    const a = parseBridgeMessage(
      JSON.stringify({
        kind: "textChunk",
        page: 1,
        chunk: 0,
        total: 2,
        data: '[{"str":"A"',
      }),
    );
    const b = parseBridgeMessage(
      JSON.stringify({
        kind: "textChunk",
        page: 1,
        chunk: 0,
        total: 2,
        data: "HOSTILE",
      }),
    );
    const c = parseBridgeMessage(
      JSON.stringify({
        kind: "textChunk",
        page: 1,
        chunk: 1,
        total: 2,
        data: "}]",
      }),
    );
    acc.feed(a.message);
    const dup = acc.feed(b.message);
    check("dup_chunk_noop", dup.type === "noop");
    const done = acc.feed(c.message);
    check("dup_chunk_first_wins", done.type === "text_page");
    check(
      "dup_chunk_payload_intact",
      done.type === "text_page" && done.items.length === 1 && done.items[0].str === "A",
    );
  }

  // ── Missing chunk: page never completes ──────────────────────────────────
  {
    const acc = new PdfBridgeAccumulator();
    acc.feed(
      parseBridgeMessage(
        JSON.stringify({
          kind: "textChunk",
          page: 1,
          chunk: 0,
          total: 3,
          data: "aaa",
        }),
      ).message,
    );
    acc.feed(
      parseBridgeMessage(
        JSON.stringify({
          kind: "textChunk",
          page: 1,
          chunk: 2,
          total: 3,
          data: "ccc",
        }),
      ).message,
    );
    check("missing_chunk_not_ready", !acc.isTextPageReady(1));
    check("missing_chunk_not_complete", !acc.isTextPageComplete(1));
    const pageDone = acc.feed(
      parseBridgeMessage(JSON.stringify({ page: 1, done: true })).message,
    );
    check("missing_chunk_page_done_noop", pageDone.type === "noop");
    check("missing_chunk_still_incomplete", !acc.isTextPageComplete(1));
    const passEv = acc.feed(
      parseBridgeMessage(
        JSON.stringify({ kind: "textPassDone", pageCount: 1 }),
      ).message,
    );
    check("missing_chunk_pass_done_ok", passEv.type === "text_pass_done");
    check("missing_chunk_still_not_complete_after_pass", !acc.isTextPageComplete(1));

    // Reconcile surfaces missing page for image fallback
    const rec = reconcileTextPassPages(acc.getCompletedTextPages(), 1);
    check(
      "missing_chunk_reconcile",
      rec.missing.length === 1 && rec.missing[0] === 1,
    );
  }

  // ── Per-page / total payload caps ────────────────────────────────────────
  {
    const acc = new PdfBridgeAccumulator({
      maxPagePayloadBytes: 100,
      maxChunksPerPage: 4,
    });
    const e1 = acc.feed({
      kind: "textChunk",
      page: 1,
      chunk: 0,
      total: 2,
      data: "a".repeat(60),
    });
    check("page_payload_first_ok", e1.type === "noop");
    const e2 = acc.feed({
      kind: "textChunk",
      page: 1,
      chunk: 1,
      total: 2,
      data: "b".repeat(60),
    });
    check(
      "page_payload_cap",
      e2.type === "cap_exceeded" && e2.reason === "page_payload_cap",
    );
  }
  {
    const acc = new PdfBridgeAccumulator({
      maxTotalTextBytes: 50,
      maxPagePayloadBytes: 10_000,
      maxChunksPerPage: 8,
      maxPages: 5,
    });
    acc.feed({
      kind: "textChunk",
      page: 1,
      chunk: 0,
      total: 1,
      data: "x".repeat(40),
    });
    const e2 = acc.feed({
      kind: "textChunk",
      page: 2,
      chunk: 0,
      total: 1,
      data: "y".repeat(20),
    });
    check(
      "total_text_bytes_cap",
      e2.type === "cap_exceeded" && e2.reason === "total_text_bytes_cap",
    );
  }

  // ── Items not an array ───────────────────────────────────────────────────
  {
    const nullParse = parseTextItemsJson(JSON.stringify({ not: "array" }));
    check("items_not_array_null", nullParse === null);

    const acc = new PdfBridgeAccumulator();
    const bad = JSON.stringify({ foo: 1 });
    const ev = acc.feed({
      kind: "textChunk",
      page: 1,
      chunk: 0,
      total: 1,
      data: bad,
    });
    check(
      "items_not_array_empty_page",
      ev.type === "text_page" && Array.isArray(ev.items) && ev.items.length === 0,
    );
  }

  check("project_null", projectTextItem(null) === null);
  check("project_no_str", projectTextItem({ width: 1 }) === null);
  check(
    "project_ok",
    projectTextItem({
      str: "hi",
      hasEOL: true,
      width: 3,
      transform: [1, 0, 0, 1, 2, 3],
      fontName: "X",
    })?.str === "hi",
  );
  check(
    "project_str_cap",
    projectTextItem({ str: "z".repeat(MAX_ITEM_STR_CHARS + 10) })?.str.length ===
      MAX_ITEM_STR_CHARS,
  );

  // ── MAX_ITEMS_PER_PAGE slice (memory guard — mutation-sensitive) ──────────
  {
    const over = MAX_ITEMS_PER_PAGE + 100;
    const many = [];
    for (let i = 0; i < over; i++) {
      many.push({ str: "x" + (i % 10) });
    }
    // Direct parse path (the Math.min in parseTextItemsJson).
    const parsed = parseTextItemsJson(JSON.stringify(many));
    check(
      "guard_item_slice_parse",
      Array.isArray(parsed) && parsed.length === MAX_ITEMS_PER_PAGE,
      parsed == null
        ? "null"
        : `len=${parsed.length} expected=${MAX_ITEMS_PER_PAGE}`,
    );

    // Through accumulator (defense-in-depth slice in emitTextPage).
    const msgs = buildTextChunkMessages(1, many, CHUNK_SIZE);
    const acc = new PdfBridgeAccumulator();
    let emitted = null;
    let lastType = null;
    for (const m of msgs) {
      const ev = acc.feed(m);
      lastType = ev.type;
      if (ev.type === "text_page") emitted = ev.items;
    }
    check(
      "guard_item_slice_acc",
      emitted !== null && emitted.length === MAX_ITEMS_PER_PAGE,
      emitted == null
        ? `no text_page last=${lastType} chunks=${msgs.length}`
        : `len=${emitted.length} expected=${MAX_ITEMS_PER_PAGE}`,
    );
    // Reconstruction must still succeed on the capped page.
    let reconstructOk = false;
    try {
      const text = reconstructPageText(emitted ?? []);
      reconstructOk = typeof text === "string";
    } catch {
      reconstructOk = false;
    }
    check("guard_item_slice_reconstruct", reconstructOk);

    // Accumulator-only option: custom max smaller than global parse cap.
    const smallMax = 7;
    const smallItems = [];
    for (let i = 0; i < 20; i++) smallItems.push({ str: "s" + i });
    const acc2 = new PdfBridgeAccumulator({ maxItemsPerPage: smallMax });
    let emitted2 = null;
    for (const m of buildTextChunkMessages(1, smallItems, 64)) {
      const ev = acc2.feed(m);
      if (ev.type === "text_page") emitted2 = ev.items;
    }
    check(
      "guard_item_slice_acc_opt",
      emitted2 !== null && emitted2.length === smallMax,
      emitted2 == null ? "null" : `len=${emitted2.length}`,
    );
  }

  // ── Image path complete ──────────────────────────────────────────────────
  {
    const acc = new PdfBridgeAccumulator();
    const e1 = acc.feed({ page: 1, chunk: 1, total: 2, data: "BB" });
    check("img_partial", e1.type === "noop");
    const e2 = acc.feed({ page: 1, chunk: 0, total: 2, data: "AA" });
    check("img_complete", e2.type === "image_page" && e2.base64 === "AABB");
  }

  // ── Error closes accumulator ─────────────────────────────────────────────
  {
    const acc = new PdfBridgeAccumulator();
    const e = acc.feed({ error: "fail" });
    check("error_event", e.type === "error" && e.error === "fail");
    const after = acc.feed({ done: true });
    check("error_closes", after.type === "noop");
  }

  // ── Determinism ──────────────────────────────────────────────────────────
  {
    const items = [
      { str: "Line A", hasEOL: true, width: 10, transform: [12, 0, 0, 12, 0, 100] },
      { str: "Line B", width: 10, transform: [12, 0, 0, 12, 0, 80] },
    ];
    const msgs = buildTextChunkMessages(1, items, 8);
    function run() {
      const acc = new PdfBridgeAccumulator();
      const events = [];
      for (const m of msgs) events.push(acc.feed(m));
      events.push(
        acc.feed({
          kind: "textPageDone",
          page: 1,
          getTextContentMs: 1.5,
          itemCount: 2,
          projectedBytes: 99,
        }),
      );
      events.push(acc.feed({ kind: "textPassDone", pageCount: 1 }));
      events.push(acc.feed({ done: true }));
      return events.map((e) => {
        if (e.type === "text_page") {
          return {
            type: e.type,
            page: e.page,
            strs: e.items.map((i) => i.str),
            meta: e.meta,
          };
        }
        if (e.type === "text_pass_done") {
          return { type: e.type, pageCount: e.pageCount };
        }
        return { type: e.type };
      });
    }
    const a = JSON.stringify(run());
    const b = JSON.stringify(run());
    check("determinism", a === b, a !== b ? `a=${a} b=${b}` : "");
  }

  // ── meta before chunks ───────────────────────────────────────────────────
  {
    const acc = new PdfBridgeAccumulator();
    acc.feed({
      kind: "textPageDone",
      page: 1,
      getTextContentMs: 12.5,
      itemCount: 1,
      projectedBytes: 10,
    });
    const ev = acc.feed({
      kind: "textChunk",
      page: 1,
      chunk: 0,
      total: 1,
      data: JSON.stringify([{ str: "z" }]),
    });
    check(
      "meta_before_chunks",
      ev.type === "text_page" &&
        ev.meta.getTextContentMs === 12.5 &&
        ev.items[0].str === "z",
    );
  }

  // ── Reconcile + sanitize + clamp ─────────────────────────────────────────
  {
    const r = reconcileTextPassPages([1, 3], 3);
    check(
      "reconcile_missing_middle",
      r.missing.length === 1 && r.missing[0] === 2 && r.expected.length === 3,
    );
  }
  {
    const sid = sanitizePdfSourceId(
      "file:///data/user/0/com.app/cache/doc%20x.pdf",
    );
    check(
      "sanitize_source_no_path",
      !sid.includes("/") && !sid.includes("file:") && sid.includes("doc"),
      `sid=${sid}`,
    );
    check(
      "sanitize_explicit",
      sanitizePdfSourceId("file:///x", "my-doc") === "my-doc",
    );
  }
  {
    check("clamp_max_pages_zero", clampMaxPages(0) === MAX_PDF_PAGES);
    check("clamp_max_pages_neg", clampMaxPages(-3) === MAX_PDF_PAGES);
    check("clamp_max_pages_ok", clampMaxPages(3) === 3);
    check("clamp_max_pages_over", clampMaxPages(99) === MAX_PDF_PAGES);
  }

  // ── End-to-end: real frozen fixture through accumulator ──────────────────
  {
    const fixture = loadFixture("ascii");
    const pages = (fixture.pages || []).map((p) => ({
      pageNumber: p.pageNumber,
      items: p.items || [],
    }));
    const direct = buildPdfPageTexts(pages);

    const acc = new PdfBridgeAccumulator();
    const rebuilt = [];
    for (const p of pages) {
      const msgs = buildTextChunkMessages(p.pageNumber, p.items, 32);
      for (const m of msgs) {
        const ev = acc.feed(m);
        if (ev.type === "text_page") {
          rebuilt.push({ pageNumber: ev.page, items: ev.items });
        }
      }
      acc.feed({
        kind: "textPageDone",
        page: p.pageNumber,
        getTextContentMs: 0,
        itemCount: p.items.length,
        projectedBytes: JSON.stringify(p.items).length,
      });
    }
    const passEv = acc.feed({
      kind: "textPassDone",
      pageCount: pages.length,
    });
    check(
      "e2e_pass_page_count",
      passEv.type === "text_pass_done" && passEv.pageCount === pages.length,
    );

    const viaBridge = buildPdfPageTexts(rebuilt);
    check(
      "e2e_fixture_page_count",
      viaBridge.length === direct.length && viaBridge.length >= 1,
      `bridge=${viaBridge.length} direct=${direct.length}`,
    );
    for (let i = 0; i < direct.length; i++) {
      check(
        `e2e_fixture_text_p${direct[i].pageNumber}`,
        viaBridge[i]?.text === direct[i].text,
        viaBridge[i]?.text !== direct[i].text
          ? `bridge=${JSON.stringify(viaBridge[i]?.text)} direct=${JSON.stringify(direct[i].text)}`
          : "",
      );
      check(
        `e2e_fixture_layer_p${direct[i].pageNumber}`,
        viaBridge[i]?.hasTextLayer === direct[i].hasTextLayer,
      );
    }

    const p1 = pages[0];
    if (p1) {
      const msgs = buildTextChunkMessages(p1.pageNumber, p1.items, 16);
      const acc2 = new PdfBridgeAccumulator();
      let items = null;
      for (const m of msgs) {
        const ev = acc2.feed(m);
        if (ev.type === "text_page") items = ev.items;
      }
      const tDirect = reconstructPageText(p1.items);
      const tBridge = reconstructPageText(items);
      check("e2e_reconstruct_match", tDirect === tBridge);
    }
  }

  {
    const fixture = loadFixture("tracemonkey");
    const p1 = fixture.pages?.[0];
    if (p1 && p1.items?.length) {
      const directText = reconstructPageText(p1.items);
      const msgs = buildTextChunkMessages(1, p1.items, CHUNK_SIZE);
      const acc = new PdfBridgeAccumulator();
      let items = null;
      let lastType = null;
      for (const m of msgs) {
        const ev = acc.feed(m);
        lastType = ev.type;
        if (ev.type === "text_page") items = ev.items;
      }
      check(
        "e2e_tracemonkey_via_bridge",
        items !== null && reconstructPageText(items) === directText,
        items === null
          ? `no text_page (last=${lastType}, chunks=${msgs.length})`
          : "text mismatch",
      );
    } else {
      check("e2e_tracemonkey_via_bridge", false, "missing fixture page");
    }
  }

  // ── Image mode X1 multi-page ─────────────────────────────────────────────
  {
    const acc = new PdfBridgeAccumulator();
    acc.feed({ page: 1, chunk: 0, total: 1, data: "img1" });
    const pd1 = acc.feed({ page: 1, done: true });
    check("img_x1_page1_done_noop", pd1.type === "noop");
    check("img_x1_not_global_yet", !acc.hasGlobalDone());
    const img2 = acc.feed({ page: 2, chunk: 0, total: 1, data: "img2" });
    check("img_page2", img2.type === "image_page");
    acc.feed({ page: 2, done: true });
    const g = acc.feed({ done: true });
    check("img_global_after_pages", g.type === "global_done");
  }

  // ── reset ────────────────────────────────────────────────────────────────
  {
    const acc = new PdfBridgeAccumulator();
    acc.feed({
      kind: "textChunk",
      page: 1,
      chunk: 0,
      total: 1,
      data: "[]",
    });
    check("pre_reset_complete", acc.isTextPageComplete(1));
    acc.reset();
    check("post_reset_clear", !acc.isTextPageComplete(1) && acc.getTotalTextBytes() === 0);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
