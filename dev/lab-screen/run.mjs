// Runs the screen-guide set against one running lab engine (one responsibility:
// walk ground-truth.json, call the engine, write raw rows). Scoring lives in
// score.mjs; the tables come from report.mjs.
// usage: node run.mjs --name gemma-default --model gemma-4-E4B-it-Q4_K_M --widths 1920,1280,896
//        [--thinking on|off] [--langs it,en] [--zoom on|off] [--cachecheck on|off]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ask, eraseSlot, imageDataUrl, replyText, timingsOf } from "./engine.mjs";
import {
  GUIDE_SYSTEM_EN, GUIDE_SYSTEM_IT, ZOOM_NOTE_IT,
  guideUserEn, guideUserIt, READ_LINES_SYSTEM_IT, READ_LINES_USER_IT, READ_SYSTEM_IT, READ_USER_IT,
} from "./prompts.mjs";
import { parseReply, replyPoint, scoreGuide, scoreLines, scoreRead } from "./score.mjs";
import { cellOf, unzoom, zoomWindow } from "./geometry.mjs";
import { cropZoom } from "./crop.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const flag = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const name = flag("name", "run");
const model = flag("model", "gemma-4-E4B-it-Q4_K_M");
const base = flag("base", "http://127.0.0.1:8150");
const widths = flag("widths", "1920,1280,896").split(",").map(Number);
const thinking = flag("thinking", "off") === "on";
const langs = flag("langs", "it,en").split(",");
const zoomOn = flag("zoom", "on") === "on";
const taskTypes = flag("tasks", "A,B").split(",");
const cacheCheck = flag("cachecheck", "off") === "on";
const out = join(here, "results", `${name}.json`);

const truth = JSON.parse(readFileSync(join(here, "ground-truth.json"), "utf8"));
const shots = "/tmp/lab-screen/shots";
const cropsDir = "/tmp/lab-screen/crops";
mkdirSync(cropsDir, { recursive: true });
mkdirSync(join(here, "results"), { recursive: true });

const maxTokens = thinking ? 1500 : 300;
const rows = [];
const save = () => writeFileSync(out, JSON.stringify({ name, model, base, widths, thinking, langs, zoom: zoomOn, rows }, null, 2) + "\n");

// Frames: the native capture, plus each requested width below it (never upscaled).
const framesFor = (img) => [...new Set([img.native[0], ...widths.filter((w) => w < img.native[0])])];
const framePath = (img, width) => (width === img.native[0] ? join(shots, img.file) : `/tmp/lab-screen/variants/${width}/${img.file}`);

const requestRecord = (system, user, hasImage) => ({
  model,
  temperature: 0,
  max_tokens: maxTokens,
  chat_template_kwargs: { enable_thinking: thinking },
  system,
  user,
  image: hasImage ? "data:image/…(base64 truncated)" : null,
});

// Every call is cold (slot erased first) so prompt_ms is a real prefill; only the
// cache-repeat check keeps the cache, to measure the reuse on purpose.
async function call(label, img, width, system, user, dataUrl, { warm = false } = {}) {
  if (!warm) await eraseSlot(base);
  const result = await ask({ base, model, system, user, dataUrl, thinking, maxTokens });
  const reply = replyText(result);
  const timings = timingsOf(result);
  console.log(`${img.id} ${label} w${width} HTTP ${result.status} wall ${Math.round(result.wallMs)} ms prompt_ms ${timings.promptMs} total ${timings.totalN}`);
  return { reply, parsed: parseReply(reply), timings, wallMs: Math.round(result.wallMs), status: result.status };
}

const baseRow = (img, task, variant, width, extra) => ({
  image: img.id, file: img.file, class: img.class, dense: img.dense, sha256: img.sha256,
  native: img.native, task: task.id, variant, width, ...extra,
});

async function runGuide(img, task, width, lang, frame) {
  const system = lang === "it" ? GUIDE_SYSTEM_IT : GUIDE_SYSTEM_EN;
  const user = lang === "it" ? guideUserIt(task.goal_it) : guideUserEn(task.goal_en);
  const first = await call(`A-${lang}`, img, width, system, user, imageDataUrl(frame));
  rows.push(baseRow(img, task, `A-${lang}`, width, {
    request: requestRecord(system, user, true), status: first.status, wallMs: first.wallMs,
    timings: first.timings, reply: first.reply, score: scoreGuide(first.parsed, task.expected, img.native),
  }));
  if (lang === "it" && zoomOn) await runZoom(img, task, width, system, user, first);
}

// Second pass on a 2x crop around the first answer; the answer maps back to the frame.
async function runZoom(img, task, width, system, user, first) {
  const point = replyPoint(first.parsed.value ?? {});
  if (!point || !first.parsed.value?.label) {
    rows.push(baseRow(img, task, "A-it-zoom", width, { skipped: "no point in first pass" }));
    return;
  }
  const win = zoomWindow(point, img.native);
  const began = performance.now();
  const crop = cropZoom(join(shots, img.file), win, join(cropsDir, `${img.id}-${task.id}-w${width}.png`));
  const cropMs = Math.round(performance.now() - began);
  const zoomSystem = `${system}\n${ZOOM_NOTE_IT}`;
  const second = await call("A-it-zoom", img, width, zoomSystem, user, imageDataUrl(crop));
  const z = second.parsed.value ?? {};
  const zp = replyPoint(z);
  let mapped = { label: z.label, grid: null, x: null, y: null };
  if (zp) {
    const [fx, fy] = unzoom(zp, win, img.native);
    mapped = { label: z.label, grid: cellOf(fx, fy), x: fx, y: fy };
  }
  rows.push(baseRow(img, task, "A-it-zoom", width, {
    request: requestRecord(zoomSystem, user, true),
    zoom: { window_px: win, crop_px: [win.cw * 2, win.ch * 2], cropMs, firstWallMs: first.wallMs },
    status: second.status, wallMs: second.wallMs, timings: second.timings,
    reply: second.reply, mappedFrame: mapped,
    score: scoreGuide({ ok: second.parsed.ok, value: mapped }, task.expected, img.native),
  }));
}

async function runTwin(img, task, width, system, user) {
  const twin = await call("twin", img, width, system, user, null);
  rows.push(baseRow(img, task, `twin-${task.type}`, width, { timings: twin.timings, wallMs: twin.wallMs, status: twin.status }));
}

async function runRead(img, task, width, frame) {
  const dataUrl = imageDataUrl(frame);
  const std = await call("B-std", img, width, READ_SYSTEM_IT, READ_USER_IT, dataUrl);
  rows.push(baseRow(img, task, "B-std", width, {
    request: requestRecord(READ_SYSTEM_IT, READ_USER_IT, true), status: std.status, wallMs: std.wallMs,
    timings: std.timings, reply: std.reply, score: scoreRead(std.parsed, task.expected.text),
  }));
  const lines = await call("B-lines", img, width, READ_LINES_SYSTEM_IT, READ_LINES_USER_IT, dataUrl);
  rows.push(baseRow(img, task, "B-lines", width, {
    request: requestRecord(READ_LINES_SYSTEM_IT, READ_LINES_USER_IT, true), status: lines.status, wallMs: lines.wallMs,
    timings: lines.timings, reply: lines.reply, score: scoreLines(lines.parsed, task.expected.text),
  }));
  await runTwin(img, task, width, READ_SYSTEM_IT, READ_USER_IT);
}

// Same image, same request, twice: does the server reuse the image's KV?
if (cacheCheck) {
  const img = truth.images[0];
  const task = img.tasks[0];
  const dataUrl = imageDataUrl(join(shots, img.file));
  for (const label of ["cache-repeat-1", "cache-repeat-2"]) {
    const r = await call(label, img, img.native[0], GUIDE_SYSTEM_IT, guideUserIt(task.goal_it), dataUrl, { warm: label === "cache-repeat-2" });
    rows.push(baseRow(img, task, label, img.native[0], { status: r.status, wallMs: r.wallMs, timings: r.timings }));
  }
}

for (const img of truth.images) {
  for (const width of framesFor(img)) {
    const frame = framePath(img, width);
    for (const task of img.tasks.filter((t) => taskTypes.includes(t.type))) {
      if (task.type === "A") {
        for (const lang of langs) await runGuide(img, task, width, lang, frame);
        if (langs.includes("it")) await runTwin(img, task, width, GUIDE_SYSTEM_IT, guideUserIt(task.goal_it));
      } else {
        await runRead(img, task, width, frame);
      }
    }
    save();
  }
}
save();
console.log(`wrote ${out} (${rows.length} rows)`);
