#!/usr/bin/env node
/**
 * benchPreflight.mjs — HEAD every model URL the bench workflow can select,
 * fail fast if any is unreachable or wrong-size.
 *
 * Single source of truth: reads src/engine/ModelRegistry.ts as text and
 * derives URLs mechanically (hfRepo + revision + file → URL). The workflow
 * YAML never contains a hardcoded URL — drift is structurally impossible.
 *
 * Usage:
 *   node scripts/benchPreflight.mjs              # check all models
 *   node scripts/benchPreflight.mjs --env MODEL  # print env vars for download step
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

// ── Parse ModelRegistry.ts ────────────────────────────────────────────────
/**
 * Extract model entries from ModelRegistry.ts by regex. The structure is:
 *   { id: "...", hfRepo: "...", revision: "...", file: "...", sizeBytes: ...,
 *     mmproj?: { file: "...", sizeBytes: ..., hfRepo: "...", revision: "..." } }
 * We parse each model block and extract these fields.
 */
function parseModelRegistry() {
  const registryPath = path.join(projectRoot, "src/engine/ModelRegistry.ts");
  const content = readFileSync(registryPath, "utf8");
  const registryStart = content.indexOf("export const MODEL_REGISTRY: ModelInfo[] = [");
  const registryEnd = content.indexOf("\n];", registryStart);
  if (registryStart < 0 || registryEnd < 0) {
    throw new Error("MODEL_REGISTRY array not found");
  }
  const registryContent = content.slice(registryStart, registryEnd);

  const models = [];
  // Match each model object in MODEL_REGISTRY array
  // Pattern: find blocks starting with { id: and ending with },
  const modelBlockRegex = /\{\s*id:\s*"([^"]+)",[\s\S]*?^\s{2}\},?/gm;
  let match;
  while ((match = modelBlockRegex.exec(registryContent)) !== null) {
    const block = match[0];
    const id = match[1];

    // Extract fields
    const hfRepoMatch = block.match(/hfRepo:\s*"([^"]+)"/);
    const revisionMatch = block.match(/revision:\s*"([^"]+)"/);
    const fileMatch = block.match(/file:\s*"([^"]+)"/);
    const sizeBytesMatch = block.match(/sizeBytes:\s*([\d_]+)/);

    if (!hfRepoMatch || !revisionMatch || !fileMatch || !sizeBytesMatch) continue;

    const model = {
      id,
      hfRepo: hfRepoMatch[1],
      revision: revisionMatch[1],
      file: fileMatch[1],
      sizeBytes: parseInt(sizeBytesMatch[1].replace(/_/g, ""), 10),
      listed: !/listed:\s*false/.test(block),
    };

    // Check for mmproj
    const mmprojMatch = block.match(/mmproj:\s*\{([^}]+)\}/);
    if (mmprojMatch) {
      const mmprojBlock = mmprojMatch[1];
      const mmFileMatch = mmprojBlock.match(/file:\s*"([^"]+)"/);
      const mmSizeMatch = mmprojBlock.match(/sizeBytes:\s*([\d_]+)/);
      const mmRepoMatch = mmprojBlock.match(/hfRepo:\s*"([^"]+)"/);
      const mmRevMatch = mmprojBlock.match(/revision:\s*"([^"]+)"/);

      if (mmFileMatch && mmSizeMatch) {
        model.mmproj = {
          file: mmFileMatch[1],
          sizeBytes: parseInt(mmSizeMatch[1].replace(/_/g, ""), 10),
          hfRepo: mmRepoMatch ? mmRepoMatch[1] : model.hfRepo,
          revision: mmRevMatch ? mmRevMatch[1] : model.revision,
        };
      }
    }

    models.push(model);
  }

  return models;
}

/**
 * Construct the HuggingFace URL from model data.
 * Format: https://huggingface.co/{hfRepo}/resolve/{revision}/{file}?download=true
 */
function buildUrl(hfRepo, revision, file) {
  return `https://huggingface.co/${hfRepo}/resolve/${revision}/${file}?download=true`;
}

/**
 * HEAD a URL with redirect following, return {status, xLinkedSize}.
 * Retries transient failures (network errors, 5xx) up to maxRetries times.
 * Fails immediately on 4xx (no retry — it won't heal).
 */
function headWithRetry(url, maxRetries = 2) {
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      // curl -sIL: silent, follow redirects, headers only
      const output = execSync(`curl -sIL "${url}"`, {
        encoding: "utf8",
        timeout: 30000,
      });

      // Parse status code from final response (last "HTTP/" line)
      // Format: "HTTP/2 302" or "HTTP/1.1 200" — extract the status code after the version
      const httpLines = output.match(/^HTTP\/[\d.]+\s+\d+/gm);
      if (!httpLines || httpLines.length === 0) {
        throw new Error("No HTTP status found");
      }
      // Take the last HTTP line and extract the status code
      const lastHttpLine = httpLines[httpLines.length - 1];
      const statusMatch = lastHttpLine.match(/HTTP\/[\d.]+\s+(\d+)/);
      if (!statusMatch) {
        throw new Error("Could not parse status code");
      }
      const finalStatus = parseInt(statusMatch[1], 10);

      // Parse x-linked-size from headers (case-insensitive)
      const xLinkedSizeMatch = output.match(/x-linked-size:\s*(\d+)/i);
      const xLinkedSize = xLinkedSizeMatch ? parseInt(xLinkedSizeMatch[1], 10) : null;

      // 4xx: fail immediately, no retry
      if (finalStatus >= 400 && finalStatus < 500) {
        return { status: finalStatus, xLinkedSize, error: null };
      }

      // 2xx: success
      if (finalStatus >= 200 && finalStatus < 300) {
        return { status: finalStatus, xLinkedSize, error: null };
      }

      // 5xx or other: retry if attempts remain
      if (attempt <= maxRetries) {
        console.error(`  Attempt ${attempt} failed (status ${finalStatus}), retrying...`);
        continue;
      }
      return { status: finalStatus, xLinkedSize, error: `HTTP ${finalStatus}` };
    } catch (err) {
      // Network error or timeout: retry if attempts remain
      if (attempt <= maxRetries) {
        console.error(`  Attempt ${attempt} failed (${err.message}), retrying...`);
        continue;
      }
      return { status: 0, xLinkedSize: null, error: err.message };
    }
  }
  return { status: 0, xLinkedSize: null, error: "Max retries exceeded" };
}

/**
 * Check a single model (main file + mmproj if present).
 * Returns {ok: boolean, errors: string[]}.
 */
function checkModel(model) {
  const errors = [];
  const url = buildUrl(model.hfRepo, model.revision, model.file);

  console.log(`\n[${model.id}]`);
  console.log(`  URL: ${url}`);

  const result = headWithRetry(url);
  console.log(`  Status: ${result.status}`);
  if (result.xLinkedSize !== null) {
    console.log(`  x-linked-size: ${result.xLinkedSize}`);
  }

  if (result.error) {
    errors.push(`${model.id}: ${result.error} (status ${result.status})`);
  } else if (result.status !== 200) {
    errors.push(`${model.id}: unexpected status ${result.status}`);
  }

  // Size check
  if (result.xLinkedSize !== null && result.xLinkedSize !== model.sizeBytes) {
    errors.push(
      `${model.id}: size mismatch (x-linked-size=${result.xLinkedSize}, expected=${model.sizeBytes})`
    );
  }

  // mmproj check (if present)
  if (model.mmproj) {
    const mmUrl = buildUrl(model.mmproj.hfRepo, model.mmproj.revision, model.mmproj.file);
    console.log(`  mmproj URL: ${mmUrl}`);

    const mmResult = headWithRetry(mmUrl);
    console.log(`  mmproj status: ${mmResult.status}`);
    if (mmResult.xLinkedSize !== null) {
      console.log(`  mmproj x-linked-size: ${mmResult.xLinkedSize}`);
    }

    if (mmResult.error) {
      errors.push(`${model.id} mmproj: ${mmResult.error} (status ${mmResult.status})`);
    } else if (mmResult.status !== 200) {
      errors.push(`${model.id} mmproj: unexpected status ${mmResult.status}`);
    }

    if (mmResult.xLinkedSize !== null && mmResult.xLinkedSize !== model.mmproj.sizeBytes) {
      errors.push(
        `${model.id} mmproj: size mismatch (x-linked-size=${mmResult.xLinkedSize}, expected=${model.mmproj.sizeBytes})`
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Print env vars for the workflow download step.
 * Output format: KEY=VALUE (one per line, for >> $GITHUB_ENV).
 */
function printEnvVars(modelId, models) {
  const model = models.find((m) => m.id === modelId && m.listed !== false);
  if (!model) {
    console.error(`Model ${modelId} not found in registry`);
    process.exit(1);
  }

  const url = buildUrl(model.hfRepo, model.revision, model.file);
  console.log(`MODEL_FILE=${model.file}`);
  console.log(`MODEL_DIR=${model.id}`);
  console.log(`EXPECTED_BYTES=${model.sizeBytes}`);
  console.log(`MODEL_URL=${url}`);

  if (model.mmproj) {
    const mmUrl = buildUrl(model.mmproj.hfRepo, model.mmproj.revision, model.mmproj.file);
    console.log(`MMPROJ_FILE=${model.mmproj.file}`);
    console.log(`MMPROJ_BYTES=${model.mmproj.sizeBytes}`);
    console.log(`MMPROJ_URL=${mmUrl}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

if (args[0] === "--env") {
  const modelId = args[1];
  if (!modelId) {
    console.error("Usage: node scripts/benchPreflight.mjs --env <modelId>");
    process.exit(1);
  }
  const models = parseModelRegistry();
  printEnvVars(modelId, models);
  process.exit(0);
}

// Default: check every listed model in the registry. The catalog is the only
// source of truth; adding/removing a listed entry automatically changes this
// preflight set.
const models = parseModelRegistry();
const workflowModels = models.filter((m) => m.listed !== false);

console.log(`Preflight: checking ${workflowModels.length} models...\n`);

const allErrors = [];
for (const model of workflowModels) {
  const { ok, errors } = checkModel(model);
  if (!ok) {
    allErrors.push(...errors);
  }
}

console.log("\n" + "=".repeat(60));
if (allErrors.length > 0) {
  console.log(`FAILED: ${allErrors.length} error(s)`);
  for (const err of allErrors) {
    console.log(`  - ${err}`);
  }
  process.exit(1);
} else {
  console.log("OK: all models reachable and sizes match");
  process.exit(0);
}
