/**
 * Harness for extractDocxTextFromBytes (pure) + pickKind.
 * Imports the TypeScript source via Node type-stripping. Exit 1 on fail.
 */
import { zipSync } from "fflate";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");

let pass = 0;
let fail = 0;
function check(name, cond, detail = "") {
  if (cond) {
    console.log(`PASS ${name}`);
    pass++;
  } else {
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    fail++;
  }
}

function encodeXml(xml) {
  return new TextEncoder().encode(xml);
}

function minimalDocx(documentXml, extra = {}) {
  return zipSync({
    "word/document.xml": encodeXml(documentXml),
    ...extra,
  });
}

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Hello &amp; world</w:t></w:r></w:p>
    <w:p><w:r><w:t>Line</w:t><w:br/><w:t>two</w:t></w:r></w:p>
    <w:p><w:r><w:tab/><w:t>tabbed</w:t></w:r></w:p>
  </w:body>
</w:document>`;

async function loadModules() {
  const extractUrl = pathToFileURL(
    path.join(projectRoot, "src/documents/docxToText.ts"),
  ).href;
  const kindsUrl = pathToFileURL(
    path.join(projectRoot, "src/documents/documentKinds.ts"),
  ).href;
  const extractMod = await import(extractUrl);
  const kindsMod = await import(kindsUrl);
  return { extractMod, kindsMod };
}

async function main() {
  const { extractMod, kindsMod } = await loadModules();
  const { extractDocxTextFromBytes, MAX_DOCX_PART_BYTES } = extractMod;
  const { pickKind, sniffDocxOrLegacy, shouldSniffPickedKind } = kindsMod;

  const bytes = minimalDocx(SAMPLE_XML);
  let text = "";
  let threw = false;
  try {
    text = extractDocxTextFromBytes(bytes);
  } catch (err) {
    threw = true;
    console.log("FAIL extract threw", err);
  }
  check("extract returns string", !threw && typeof text === "string");
  check(
    "extract decodes entity + breaks",
    text === "Hello & world\nLine\ntwo\n\ttabbed",
    `got=${JSON.stringify(text)}`,
  );

  let randomCode = "";
  try {
    extractDocxTextFromBytes(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
  } catch (err) {
    randomCode = err && typeof err === "object" && "code" in err ? String(err.code) : "";
  }
  check("random buffer throws DOCX_NOT_ZIP", randomCode === "DOCX_NOT_ZIP", `code=${randomCode}`);

  let missingCode = "";
  try {
    extractDocxTextFromBytes(zipSync({ "foo.txt": encodeXml("hi") }));
  } catch (err) {
    missingCode = err && typeof err === "object" && "code" in err ? String(err.code) : "";
  }
  check(
    "zip without document.xml throws DOCX_NO_DOCUMENT",
    missingCode === "DOCX_NO_DOCUMENT",
    `code=${missingCode}`,
  );

  let emptyCode = "";
  try {
    extractDocxTextFromBytes(
      minimalDocx(
        `<w:document><w:body><w:p></w:p></w:body></w:document>`,
      ),
    );
  } catch (err) {
    emptyCode = err && typeof err === "object" && "code" in err ? String(err.code) : "";
  }
  check("empty document throws DOCX_EMPTY", emptyCode === "DOCX_EMPTY", `code=${emptyCode}`);

  check("pickKind .docx by name", pickKind(undefined, "Contract.docx") === "docx");
  check(
    "pickKind openxml mime",
    pickKind(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "",
    ) === "docx",
  );
  check("pickKind .doc legacy", pickKind(undefined, "old.doc") === "doc_legacy");
  check("pickKind msword mime", pickKind("application/msword", "x") === "doc_legacy");
  check("pickKind .docx is not .doc", pickKind(undefined, "file.DOCX") === "docx");
  check("pickKind missing name is not pdf", pickKind(undefined, undefined) === null);
  check("pickKind pdf still works", pickKind("application/pdf", "") === "pdf");
  check(
    "pickKind strips mime params",
    pickKind(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document; charset=utf-8",
      "",
    ) === "docx",
  );

  const altXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">
  <w:body>
    <w:p>
      <mc:AlternateContent>
        <mc:Choice Requires="wps"><w:r><w:t>Once</w:t></w:r></mc:Choice>
        <mc:Fallback><w:r><w:t>Once</w:t></w:r></mc:Fallback>
      </mc:AlternateContent>
    </w:p>
  </w:body>
</w:document>`;
  let altText = "";
  let altThrew = false;
  try {
    altText = extractDocxTextFromBytes(minimalDocx(altXml));
  } catch (err) {
    altThrew = true;
    console.log("FAIL AlternateContent extract threw", err);
  }
  const onceCount = (altText.match(/Once/g) || []).length;
  check(
    "AlternateContent Choice+Fallback emits text once",
    !altThrew && onceCount === 1,
    `got=${JSON.stringify(altText)} count=${onceCount}`,
  );

  let headerOnlyCode = "";
  try {
    extractDocxTextFromBytes(
      zipSync({
        "word/document.xml": encodeXml(
          `<w:document><w:body><w:p></w:p></w:body></w:document>`,
        ),
        "word/header1.xml": encodeXml(
          `<w:hdr><w:p><w:r><w:t>Only header</w:t></w:r></w:p></w:hdr>`,
        ),
      }),
    );
  } catch (err) {
    headerOnlyCode =
      err && typeof err === "object" && "code" in err ? String(err.code) : "";
  }
  check(
    "empty body with header throws DOCX_EMPTY",
    headerOnlyCode === "DOCX_EMPTY",
    `code=${headerOnlyCode}`,
  );

  let tooLargeCode = "";
  try {
    const huge = "A".repeat(MAX_DOCX_PART_BYTES + 1);
    extractDocxTextFromBytes(
      minimalDocx(
        `<w:document><w:body><w:p><w:r><w:t>${huge}</w:t></w:r></w:p></w:body></w:document>`,
      ),
    );
  } catch (err) {
    tooLargeCode =
      err && typeof err === "object" && "code" in err ? String(err.code) : "";
  }
  check(
    "oversize document.xml throws DOCX_TOO_LARGE",
    tooLargeCode === "DOCX_TOO_LARGE",
    `code=${tooLargeCode}`,
  );

  check(
    "sniff PK zip is docx",
    sniffDocxOrLegacy(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])) ===
      "docx",
  );
  check(
    "sniff OLE is doc_legacy",
    sniffDocxOrLegacy(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0])) ===
      "doc_legacy",
  );
  check(
    "sniff unknown is null",
    sniffDocxOrLegacy(new Uint8Array([1, 2, 3, 4])) === null,
  );
  check(
    "shouldSniff when nameless + msword",
    shouldSniffPickedKind("doc_legacy", "") === true,
  );
  check(
    "should not sniff .doc extension",
    shouldSniffPickedKind("doc_legacy", "old.doc") === false,
  );
  check(
    "should not sniff .pdf",
    shouldSniffPickedKind(null, "file.pdf") === false,
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
