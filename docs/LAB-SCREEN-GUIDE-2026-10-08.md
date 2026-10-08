# LAB — Screen guide on a PC, 2026-10-08

Question (owner): can a local vision model look at the screen, say where to click
and what to do next, without taking control? Measured: **Gemma 4 E4B** (Q4_K_M +
its Q8_0 projector) and **LFM2.5-VL-3B** (Q8_0 + projector), on the same 20 public
screenshots, at native and two downscaled widths.

Verdict up front: **does not work as "click here" guidance from model coordinates.**
Gemma names the right visible element reliably and gets its grid cell about half the
time at 1920 px; its exact point is inside the target 8–15 % of the time (23–46 %
within 2 %). LFM2.5-VL-3B does not work at all. Short text reading works for Gemma
on clean dialogs. Details and the product implication below.

## Setup

- Machine: Mac, M1 Max 64 GB. Engine `kalsa-server-v1.1.5` (`GET /props` →
  `b11596-63a51b6d6`), run from its own directory, app argv plus `--mmproj`, port
  127.0.0.1:8150. Drafter omitted (answers at temp 0 are identical with it, per
  LAB-VISION test 3). **The GPU is shared with the owner's running app: latencies are an
  upper bound.**
- Models: Gemma E4B from `runtime/models` (sha256 `85a896a0…`, catalog pin, read in
  place). Projector `mmproj-gemma-4-E4B-it-Q8_0.gguf` (sha `197f49a9…`, pin
  `ggml-org/gemma-4-E4B-it-GGUF@b8093469`). LFM2.5-VL-3B-Q8_0 (sha `69b49ced…`) and
  `mmproj-LFM2.5-VL-3B-Q8_0` (sha `ecbbe709…`), repo `LiquidAI/LFM2.5-VL-3B-GGUF@6f730e9a`,
  the catalog pins. Downloads deleted at the end (see Cleanup).
- Requests: `POST /v1/chat/completions`, one image as a data URI, `temperature: 0`,
  `chat_template_kwargs.enable_thinking: false` (thinking-on run excepted),
  `max_tokens` 300 (1500 thinking-on), non-streaming.
- **Every call is cold**: slot 0 is erased first (`POST /slots/0?action=erase`), so
  `prompt_ms` is a real prefill. The only warm call is the deliberate cache check.
- Output format asked of the model: JSON `{label, grid, x, y, instruction}` for task A,
  `{text}` or `{lines:[…]}` for task B. Grid = one of nine cells. Coordinates 0–1 of the frame.

## Privacy

No screen of the owner's was captured. All 20 frames were made by headless Chrome from
public pages or taken from Wikimedia Commons. Two Commons Windows screenshots were
**excluded** because they show a third party's desktop with personal names: a Windows 11
desktop with a user name on screen, and a Windows 10 Start menu with real app names
(partly redacted). No images are committed; the sources are listed below and their
sha256 are in `dev/lab-screen/ground-truth.json`.

## Dataset (20 images, 22 tasks)

Scoring rules: each A task has **one** correct target on that frame; goals were
rewritten where a second element could be a legitimate first step (e.g. "Clipchamp
è bloccato" became "the first step to close it" = select the row).

| id | image | source | class | dense | task(s) |
|---|---|---|---|---|---|
| gh-llamacpp | github-llamacpp-1920.png | https://github.com/ggml-org/llama.cpp | web | | A: "Code" button |
| wiki-home | wiki-en-home-1920.png | https://en.wikipedia.org/wiki/Main_Page | web | | A: search input |
| wiki-404 | wiki-404-en-1920.png | https://en.wikipedia.org/wiki/Zzqxk_no_such_page_2026 | web | | B: main message |
| hn-front | hn-front-1920.png | https://news.ycombinator.com/ | web | ✔ | A: "new" link |
| saucedemo-login | saucedemo-login-1920.png | https://www.saucedemo.com/ | web | | A: Login button |
| webscraper-shop | webscraper-shop-1920.png | https://webscraper.io/test-sites/e-commerce/allinone | web | | A: "Cloud login" |
| wiki-edit-dense | wiki-edit-dense-1920.png | https://en.wikipedia.org/w/index.php?title=Italy&action=edit | web | ✔ | A: "Submit an edit request" |
| github-cpython | github-cpython-1920.png | https://github.com/python/cpython | web | | A: "Code" button |
| docs-python-funcs | docs-python-funcs-1920.png | https://docs.python.org/3/library/functions.html | web | ✔ | A: "Quick search" |
| wiki-italy | wiki-italy-1920.png | https://en.wikipedia.org/wiki/Italy | web | | A: "322 languages" |
| wiki-login | wiki-login-1920.png | https://en.wikipedia.org/wiki/Special:UserLogin | web | | A: form "Log in" |
| github-login | github-login-1920.png | https://github.com/login | web | | A: "Sign in" |
| python-home | python-home-1920.png | https://www.python.org/ | web | ✔ | A: "Downloads" (top menu) |
| mdn-button | mdn-button-1920.png | https://developer.mozilla.org/en-US/docs/Web/HTML/Element/button | web | ✔ | A: demo "Reset" |
| win11-taskmgr | win11-task-manager-1370.png | https://commons.wikimedia.org/wiki/File:File_Explorer_App_windows_11.png (file name says Explorer, picture is Task Manager; retouched) | windows | | A: Clipchamp row (first step) |
| win10-scale-settings | win10-scale-settings.jpg | https://commons.wikimedia.org/wiki/File:Windows_10_Scale_and_Layout_Settings.jpg | windows | | A: resolution box; A: "125%" box |
| win-generic-error | win-generic-error-dialog.png | https://commons.wikimedia.org/wiki/File:Generic_error_message.png | windows | | A: Cancel; B: "An error occurred." |
| win10-dhcp-config | win10-dhcp-config.png | https://commons.wikimedia.org/wiki/File:DHCP_Configuration_Setting_in_Windows_10.png | windows | | A: Save |
| win10-bsod-2020 | win10-bsod-2020.png | https://commons.wikimedia.org/wiki/File:BSoD_in_Windows_10_May_2020_Update_till_Windows_10_2022_Update.png | windows | | B: main message |
| win10-update-22h2 | win10-update-22h2.png | https://commons.wikimedia.org/wiki/File:Windows_10_version_22H2_Update_screen.png | windows | | B: three lines |

Not found on Commons without personal content: an Explorer window. Windows coverage is
therefore Task Manager, Settings, two dialogs, a BSOD and an update screen. The
"dense" class is five pages with many small targets.

Ground-truth boxes were read off pixel grids and checked on native-pixel crops. The
llama.cpp "Code" button measures **[1147, 265, 1256, 297]**. The owner's model point
(0.65, 0.24) is at y = 259 px, about 6 px (0.005) above the top edge: a strict
miss by 0.5 % of the frame, and a tolerant hit (within 2 %). Both metrics are reported.

## Method

- **Strict**: the point lies inside the target box. **Tolerant**: within 2 % of the frame
  (`TOL` in `geometry.mjs`) of the box. **Grid**: the cell of the reply equals the cell of
  the box centre. **Label**: lenient, a case-insensitive containment match, so "Search"
  is accepted for "Search Wikipedia". Refusal = empty label.
- Widths: native, 1280 and 896, never upscaled (narrower-than-1280 captures get native
  only).
- **Zoom second pass** (Italian only): crop a window half the frame each way, centred on
  the first answer, clamped, cut from the **native** capture and enlarged 2×, so it costs
  the same image tokens as the first pass. The same goal is asked again; the answer is
  mapped back to the frame.
- **Image tokens** = total prompt tokens with the image (prompt_n + cache_n) minus
  the same text request without the image.

## Results

### Gemma 4 E4B, thinking off — Task A, Italian first pass

| width | n | strict point | tolerant (±2 %) | grid cell | label | wrong element | prefill ms (median) | wall ms (median) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1920 | 13 | 8 % (1) | 23 % (3) | 54 % (7) | 100 % | 0 % | 3 702 | 5 062 |
| 1280 | 14 | 7 % (1) | 21 % (3) | 57 % (8) | 100 % | 0 % | 1 771 | 3 282 |
| 896 | 16 | 6 % (1) | 19 % (3) | 50 % (8) | 88 % | 13 % | 1 117 | 2 632 |

English, same items: 1920 strict 15 % / tolerant 38 % / grid 77 % / label 100 %;
1280 14 % / 29 % / 50 % / 93 %; 896 6 % / 13 % / 44 % / 81 %, wrong element 19 %.

### Gemma — zoom second pass (Italian)

| width | n | strict | tolerant | label | paired vs first pass (tolerant) | crop ms + 2nd-pass wall ms |
|---|---:|---:|---:|---:|---|---|
| 1920 | 13 | 23 % | 23 % | 100 % | 3 fixed / 3 broken | 144 + 5 127 |
| 1280 | 14 | 21 % | 21 % | 100 % | 2 fixed / 2 broken | 144 + 5 106 |
| 896 | 16 | 25 % | 25 % | 100 % | 3 fixed / 2 broken | 141 + 5 116 |

Zoom roughly doubles the latency and gives **no net gain** in point accuracy: it
fixes about as many items as it breaks. Not worth shipping as measured.

### Gemma — thinking on (Task A, Italian, 1920, n = 13, directional)

strict 15 % (2), tolerant **46 %** (6), grid 62 %, label 100 %; wall median
**7 838 ms** against 5 062 ms thinking off. English: strict 8 %, tolerant 31 %, grid 69 %.
Better on the point, slower. Thinking is not a fix.

### Gemma — high image budget (`--image-max-tokens 2240`)

**No effect at native width.** The 1920 frames come out at 1 119 total prompt tokens
with the default and with 2240; 62 of 62 native-width replies are byte-identical. The
default already covers these frames, so the flag does nothing here.

### Gemma — task B (reading)

| width | B-std exact | B-lines contains |
|---|---:|---:|
| 1920 (wiki-404, update screen) | 1 of 2 | 1 of 2 |
| 1280 | 1 of 2 | 1 of 2 |
| 1024 (BSOD) | 1 of 1 | 1 of 1 |
| 896 | 2 of 3 | 2 of 3 |
| 304 (error dialog) | 1 of 1 | 1 of 1 |

The one failure at every width is the 404 page: it reads the **heading** ("Zzqqx no such
page 2026", misspelt) rather than the message. Short, clean text reads exactly.
Line-level "similarity" is not meaningful (the joined reply carries extra lines); only
"contains" counts.

### Image tokens (Gemma)

| width | image tokens |
|---|---|
| 1920 | 922 (all 13) |
| 1370 (Task Manager) | 669 |
| 1280 | 407–569 |
| 1172 | 362 |
| 896 | 211–287 |
| 692 / 304 | 82 |

### Cache: the server reuses an unchanged frame

Same image, same request, cold then repeated: **prompt_n 1119 / prompt_ms 3 728** cold,
then **prompt_n 1 / cache_n 1118 / prompt_ms 26** on the repeat. The engine keeps the image's KV
while the frame is unchanged. Product consequence: a "watch" loop should hash the frame
and only send a changed one. An unchanged frame costs ~26 ms; a changed 1920 frame costs
~3.7 s of prefill.

### LFM2.5-VL-3B (Task A, Italian, thinking off)

| width | n | strict | tolerant | grid | label | wrong element | prefill ms (median) |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1920 | 13 | 0 % | 0 % | 31 % | 23 % | 77 % | 6 216 |
| 1280 | 14 | 0 % | 0 % | 43 % | 50 % | 50 % | 2 203 |
| 896 | 16 | 0 % | 0 % | 31 % | 31 % | 69 % | 867 |

English 1920: label 62 %, wrong element 38 %, strict 0 %. Zoom: 0 % strict at every
width. Its image cost is also higher: **2 311 tokens at 1920** against Gemma's 922.

LFM reading: B-std exact 50 % at 1920, 0 % at 1280, 33 % at 896; B-lines contains 50 %,
100 %, 67 %. It answers in Italian when told to copy text, and returns prose
instead of JSON for the BSOD.

### Format violations

Grid values outside the nine allowed names (e.g. `"center"`, `"centro"`): Gemma 8 of 96
Task A replies, LFM 5 of 95, Gemma thinking 0 of 36. Pixel-scale coordinates (x or y
above 1): 4 replies, all Gemma English. Both are guardable in code; the bigger problem
is placement, below.

## Worst examples (verbatim)

1. **Gemma IT, `saucedemo-login`**: `{"label": "Login", "grid": "center", "x": 0.5, "y": 0.45, …}`.
   The label is right; the grid name is invalid; the point is in the form body, but the
   button is at y≈0.30 (top-center).
2. **Gemma IT, `hn-front`**: `{"label": "new", "grid": "top-center", "x": 0.25, "y": 0.02, …}`.
   The target is at x≈0.15, top-left. The label is right, the cell and point are wrong.
3. **Gemma EN, `wiki-login`**: `{"label": "Log in", "grid": "middle-left", "x": 0.33, "y": 277, …}`.
   A pixel value in y. The label and cell are right, the point is nonsense.
4. **Gemma IT, `mdn-button`**: `{"label": "Reset", "grid": "top-right", "x": 0.83, "y": 0.48, …}`.
   The target is middle-right (x≈0.68). The label is right, the cell and point are wrong.
5. **Gemma reading, `wiki-404`**: `{"text": "Zzqqx no such page 2026"}`. The heading, misspelt;
   not the message.
6. **LFM IT, `gh-llamacpp`**: `{"label": "Go to file", "grid": "middle-right", "x": 980, "y": 500, …}`.
   A real element on the page, the wrong one, and pixel integers.
7. **LFM IT, `webscraper-shop`**: `{"label": "Web Scraper Cloud", "grid": "top-center", "x": 0, "y": 1, …}`.
   Integer coordinates, a label that is not the target.
8. **LFM IT, `wiki-edit-dense`**: `{"label": "Submit an edit request", "grid": "centro", "x": 6, "y": 8, …}`.
   The label is right; the rest is noise.
9. **LFM reading, `wiki-404`**: `{"text":"Zqqx no such page 2026"}` (the same heading failure, misspelt).

## Verdict

- **Does not work** as "click here" guidance from model coordinates, on either model.
  Gemma reaches the target's cell 50–77 % of the time at 1920 px and the point in 8–15 %.
  Thinking, zoom and a higher image budget do not change that in a useful way.
- **Works, only for naming**: Gemma recognises the visible element's **label** on
  81–100 % of frames at 896–1920 px (lenient match, Italian and English). That is
  "what is the button called", not "where is it".
- **Works, only for short clean text**: Gemma reads dialogs, a BSOD and an update
  screen exactly at 896–1024 px; it fails on a heading vs body distinction.
- **LFM2.5-VL-3B does not work**: invented labels, pixel-scale numbers, and 0 % point
  accuracy at every width. Its image costs 2.5× Gemma's tokens.

## What a product version would need

The lab says the model should not produce coordinates at all:

1. **Candidates from the OS, not from the model.** On Windows: UI Automation (or OCR
   where UIA is empty) supplies the element boxes; the model picks **one candidate id**
   by label and the code draws the box. The model's job shrinks to naming.
2. **Constrained output with validation in code**: a fixed enum of ids or grid names,
   and any coordinate outside 0–1 rejected. Gemma's 8 invalid grids in 96 replies would
   have been caught, not shown.
3. **Grid overlay drawn by code** only if coordinates are kept at all, with the model
   asked for a cell, not a point.
4. **Zoom only with a measured gain**. The second pass, as built here, is neutral and
   doubles latency. It is not in the product path.
5. **Watch mode by change**: hash the frame; send only changed frames (an unchanged
   frame costs ~26 ms, a changed 1920 frame ~3.7 s prefill, 1280 ~1.8 s, 896 ~1.1 s).
   "Every few seconds" is plausible at 896 only if the answer is a label and frames
   change rarely.
6. **Reading** short dialogs is in reach; long pages need a separate reader or OCR.

Next lab (not run): candidate-id selection on UIA/OCR boxes for these 20 frames, which
tests the product path directly.

## Not measured

- Task C (a three-step flow, the next step per frame): not built in this run.
- Task D as a full timing study: prefill per frame and the cache are measured; a streaming
  first-token time is not.
- The English reading prompt (B) was not run; the line-by-line variant was run in Italian only.
- Zoom and thinking at widths other than native for the thinking run (thinking ran at native only).
- No Windows machine in this lab: all frames are captured or public images, so the
  GPU-share latency is an upper bound and not a PC figure.
- Several cells have n = 1 or 2 (the 304, 692 and 1172 px frames, the 1370 Task Manager frame):
  read those rows as anecdotes, not rates.

## Harness history (for the record)

- Smoke (3 images, Gemma) → `results/smoke-gemma-w1920.json`. Superseded: its
  Clipchamp goal allowed two correct first steps, and it used the older harness.
- Two full Gemma attempts were **discarded**: the first ran with a warm cache (latencies
  contaminated); the second's "cold" erase silently failed because the engine lacked
  `--slot-save-path` (the erase returns 501; the client ignored the status). The client
  now throws on a non-200 erase. Only the third attempt's numbers appear here.

## Files

`dev/lab-screen/`: `capture-shot.sh`, `prep.sh`, `serve.sh`, `label-grid.py`,
`label-crop.py`, `ground-truth.json`, `geometry.mjs`, `crop.mjs`, `prompts.mjs`,
`engine.mjs`, `score.mjs`, `run.mjs`, `report.mjs`, `results/*.json` (raw replies,
image data truncated). Screenshots and crops are in `/tmp/lab-screen/` and not committed.

## Cleanup

Downloaded models (`/tmp/lab-screen/models`) deleted; lab server on 8150 stopped. The
owner's app on 8130/8131 was not touched.
