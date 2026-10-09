import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = process.env.KALSA_TELEMETRY_SPEC ?? path.join(root, "../kalsa/workers/telemetry/contract-v2.ts");
const text = readFileSync(source, "utf8");
const spec = JSON.parse(text.slice(text.indexOf("= ") + 2, text.lastIndexOf(" as const;")));
const quote = s => JSON.stringify(s);
const lines = [
  "// Generated from workers/telemetry/contract-v2.ts; regenerate with dev/generate-telemetry-spec.mjs.",
  "pub(super) fn values(key: &str) -> Option<&'static [&'static str]> {", "    match key {",
];
for (const [key, values] of Object.entries(spec.enums)) lines.push(`        ${quote(key)} => Some(&[${values.map(quote).join(", ")}]),`);
for (const [key, b] of Object.entries(spec.buckets)) if (key !== "deviceBucket") lines.push(`        ${quote(key)} => Some(&[${b.labels.map(quote).join(", ")}]),`);
lines.push("        _ => None,", "    }", "}", "pub(super) fn bucket(key: &str, value: f64) -> Option<&'static str> {", "    match key {");
for (const [key, b] of Object.entries(spec.buckets)) {
  lines.push(`        ${quote(key)} => Some(if value < ${b.edges[0]}.0 { ${quote(b.labels[0])} } else if value < ${b.edges[1]}.0 { ${quote(b.labels[1])} }${b.edges.length === 3 ? ` else if value < ${b.edges[2]}.0 { ${quote(b.labels[2])} }` : ""} else { ${quote(b.labels.at(-1))} }),`);
}
lines.push("        _ => None,", "    }", "}", "pub(super) fn gpu_pattern(vendor: &str) -> Option<&'static str> {", "    match vendor {");
for (const [vendor, pattern] of Object.entries(spec.patterns.gpuModel)) lines.push(`        ${quote(vendor)} => Some(r#${quote(pattern).replaceAll("\\\\", "\\")}#),`);
lines.push("        _ => None,", "    }", "}");
for (const [key, pattern] of Object.entries(spec.patterns)) if (typeof pattern === "string") lines.push(`pub(super) const ${key.replace(/[A-Z]/g, s => "_"+s).toUpperCase()}_PATTERN: &str = r#${quote(pattern).replaceAll("\\\\", "\\")}#;`);
for (const [key, value] of Object.entries(spec.limits)) lines.push(`pub(super) const ${key.replace(/[A-Z]/g, s => "_"+s).toUpperCase()}: i64 = ${value};`);
const output = path.join(root, "src-tauri/src/telemetry/spec.rs");
const formatted = spawnSync("rustfmt", ["--emit", "stdout", "--edition", "2024"], { input: lines.join("\n") + "\n", encoding: "utf8" });
if (formatted.status !== 0) throw new Error(formatted.stderr);
const generated = formatted.stdout;
if (process.argv.includes("--check")) {
  if (readFileSync(output, "utf8") !== generated) throw new Error("Desktop telemetry spec differs; regenerate it");
} else writeFileSync(output, generated);
