/**
 * Generate the Metal embed assembly files (ggml-metal-embed-*.s) inside the
 * installed llama.rn vendor tree.
 *
 * Why this exists: the llama-rn podspec compiles
 * vendor/llama.cpp/ggml/src/ggml-metal/*.{h,m,cpp,s} from source, and the
 * podspec defines GGML_METAL_EMBED_LIBRARY=1, so ggml-metal-device.m links
 * ggml_metallib_<kind>_{start,end} symbols that only these .s files provide.
 * The .s files are gitignored upstream, so a git install of the binding never
 * has them. The binding regenerates them in scripts/bootstrap.sh (its own
 * checkout); an npm git dependency ships no scripts/, so the app must
 * generate them itself — this script, invoked from the generated ios/Podfile
 * by plugins/withLlamaIosSourceBuild.js. It deliberately runs ONLY on the iOS
 * path: a root package.json postinstall would also run on Android CI and
 * write these .s files into the installed binding, where
 * scripts/assert-engine-provenance.sh counts every extra file as divergence.
 *
 * Flattening semantics follow the vendored engine's own build definition
 * (ggml/src/ggml-metal/CMakeLists.txt), NOT bootstrap.sh: the per-kernel
 * sources may quote-include fa_common.metal / fa_vec_common.metal, and the
 * embedded data is compiled at runtime with no filesystem, so every quoted
 * include must be inlined here. The asm encoding (od-style .byte lines, 16
 * per line) matches bootstrap.sh so the output is compatible with the same
 * Apple assembler the binding targets.
 *
 * Run: node scripts/gen-metal-embed.js  (idempotent; exits non-zero when the
 * vendored tree is missing or an expected input is absent)
 */
"use strict";

const fs = require("fs");
const path = require("path");

const APP_ROOT = path.resolve(__dirname, "..");
const METAL_DIR = path.join(
  APP_ROOT,
  "node_modules",
  "llama.rn",
  "vendor",
  "llama.cpp",
  "ggml",
  "src",
  "ggml-metal",
);

// Mach-O section names are limited to 16 characters; the upstream section
// name stays shared and only the per-kind symbols vary (see bootstrap.sh).
const ASM_HEADER = ".section __DATA,__ggml_metallib";

// The authoritative kind list is the engine's own X-macro table in
// ggml-metal-device.m (GGML_METAL_LIBS): parsing it keeps fa_common /
// fa_vec_common — header-only sources, not in the table — out of the embeds
// and tracks the vendored engine instead of a directory glob.
function metalLibKinds(deviceSource) {
  const kinds = [];
  const re = /^\s*X\(\s*[A-Z0-9_]+\s*,\s*([a-z0-9_]+)\s*\)/gm;
  let match;
  while ((match = re.exec(deviceSource)) !== null) {
    kinds.push(match[1]);
  }
  if (kinds.length === 0) {
    throw new Error("no GGML_METAL_LIBS entries found in ggml-metal-device.m");
  }
  return kinds;
}

// Optional headers each kernel may pull in, prepended in the same order as
// CMakeLists.txt: common.h, dequantize.h, quantize.h, fa_common, fa_vec_common.
const OPTIONAL_HEADERS = [
  "dequantize.h",
  "quantize.h",
  "fa_common.metal",
  "fa_vec_common.metal",
];

// Lines dropped from the flattened source: the quote-includes now satisfied
// by the prepended headers, and #pragma once (single TU).
const DROP_PATTERNS = [
  /^#include "common\.h"$/,
  /^#include "dequantize\.h"$/,
  /^#include "quantize\.h"$/,
  /^#include "fa_common\.metal"$/,
  /^#include "fa_vec_common\.metal"$/,
  /^#pragma once$/,
];

// Replace one line with the full contents of a file (sed e/r + d semantics:
// file content takes the line's place, in order).
function inlineAtLine(lines, matcher, fileLines) {
  const out = [];
  let inlined = false;
  for (const line of lines) {
    if (matcher.test(line.trim())) {
      out.push(...fileLines);
      inlined = true;
    } else {
      out.push(line);
    }
  }
  return { lines: out, inlined };
}

// File contents as cat sees them: the final newline terminates the last line
// instead of starting an empty one, so it never becomes a phantom "" element.
function readCatLines(file) {
  const content = fs.readFileSync(file, "utf8");
  const lines = content.split("\n");
  if (content.endsWith("\n")) {
    lines.pop();
  }
  return lines;
}

function flattenKernel(kind, kernelDir, ggmlCommonLines, implLines) {
  const kernelPath = path.join(kernelDir, `${kind}.metal`);
  if (!fs.existsSync(kernelPath)) {
    throw new Error(`missing kernel source: ${kernelPath}`);
  }
  const kernelLines = readCatLines(kernelPath);
  const uses = (name) =>
    kernelLines.some((l) => l.includes(`#include "${name}"`));

  // Prepend in CMake order: common.h first, then the optional headers this
  // kernel actually includes. Everything is a line array — includes inside
  // prepended headers must go through the same drop pass as the kernel's.
  let flattened = [...readCatLines(path.join(kernelDir, "common.h"))];
  for (const name of OPTIONAL_HEADERS) {
    if (uses(name)) {
      flattened.push(...readCatLines(path.join(kernelDir, name)));
    }
  }
  flattened.push(...kernelLines);

  flattened = flattened.filter(
    (line) => !DROP_PATTERNS.some((re) => re.test(line.trim())),
  );

  // ggml-common.h rides in at the __embed_ggml-common.h__ sentinel (it lives
  // in dequantize.h upstream), ggml-metal-impl.h at its include line (which
  // is inside common.h).
  const withCommon = inlineAtLine(
    flattened,
    /^__embed_ggml-common\.h__$/,
    ggmlCommonLines,
  );
  if (uses("dequantize.h") && !withCommon.inlined) {
    throw new Error(`${kind}: __embed_ggml-common.h__ sentinel not found`);
  }

  const withImpl = inlineAtLine(
    withCommon.lines,
    /^#include "ggml-metal-impl\.h"$/,
    implLines,
  );
  if (!withImpl.inlined) {
    throw new Error(`${kind}: ggml-metal-impl.h include not found`);
  }

  // Restore the final-newline byte the last file contributed (cat semantics).
  return withImpl.lines.join("\n") + "\n";
}

function toAsm(kind, source) {
  const lines = [ASM_HEADER];
  lines.push(`.globl _ggml_metallib_${kind}_start`);
  lines.push(`_ggml_metallib_${kind}_start:`);
  const bytes = Buffer.from(source, "utf8");
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const chunk = bytes.subarray(offset, offset + 16);
    lines.push(
      `.byte 0x${chunk[0].toString(16).padStart(2, "0")}` +
        Array.from(chunk.subarray(1))
          .map((b) => `,0x${b.toString(16).padStart(2, "0")}`)
          .join(""),
    );
  }
  lines.push(`.globl _ggml_metallib_${kind}_end`);
  lines.push(`_ggml_metallib_${kind}_end:`);
  return lines.join("\n") + "\n";
}

function main() {
  if (!fs.existsSync(METAL_DIR)) {
    throw new Error(
      `llama.rn vendor tree not found at ${METAL_DIR} — run npm install first`,
    );
  }
  const kernelDir = path.join(METAL_DIR, "kernels");
  const deviceSource = fs.readFileSync(
    path.join(METAL_DIR, "ggml-metal-device.m"),
    "utf8",
  );

  const kinds = metalLibKinds(deviceSource);
  const ggmlCommonLines = readCatLines(
    path.join(METAL_DIR, "..", "ggml-common.h"),
  );
  const implLines = readCatLines(path.join(METAL_DIR, "ggml-metal-impl.h"));
  let written = 0;
  let unchanged = 0;
  for (const kind of kinds) {
    const asm = toAsm(
      kind,
      flattenKernel(kind, kernelDir, ggmlCommonLines, implLines),
    );
    const outPath = path.join(METAL_DIR, `ggml-metal-embed-${kind}.s`);
    if (fs.existsSync(outPath) && fs.readFileSync(outPath, "utf8") === asm) {
      unchanged += 1;
      continue;
    }
    fs.writeFileSync(outPath, asm);
    written += 1;
  }
  console.log(
    `gen-metal-embed: ${kinds.length} kinds (${written} written, ${unchanged} unchanged) in ${path.relative(APP_ROOT, METAL_DIR)}`,
  );
}

try {
  main();
} catch (error) {
  console.error(`gen-metal-embed: ${error.message}`);
  process.exit(1);
}
