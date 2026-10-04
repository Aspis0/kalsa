# LAB LFM TOOLS — 2026-10-04 — LFM2.5-2.6B vs LFM2.5-VL-3B at tool decisions, on the M1 Max

Lab measurement for the question left open by `docs/LAB-VISION-2026-10-03.md` Test 7:
**is LFM2.5-VL-3B actually worse at tools than LFM2.5-2.6B on this app's prompt and
tools** — as a public card's BFCLv4 claim suggested (VL-3B 32.5 vs 2.6B 56.88) — or
was the earlier 15-prompt sample (2.6B 11/15, VL-3B 13/15) too small to say? Both
models ran the chat's exact request shape — its system prompt, its two tools,
`tool_choice:"auto"`, the row's sampling — against a fixed set of **50 prompts
(25 English, 25 Italian; per language 12 search-needed, 8 no-tool, 5 borderline),
each prompt 2× per model on GPU (seeds 1, 2), the full set once per model CPU-only,
and a 10-prompt subset with VL-3B's projector loaded.**

**Verdict: equal on tool decisions, and the BFCLv4 claim does not transfer to this
app's prompt/tools.** LFM2.5-2.6B 82/100 (Wilson 95% [73.3%, 88.3%]), LFM2.5-VL-3B
80/100 ([71.1%, 86.7%]); paired difference −2/100, Newcombe interval [−8.9%, +12.9%],
exact McNemar on the 12 discordant pairs (7 LFM-only right vs 5 VL-only right)
p = 0.77. Both models called a tool on **every** search-needed prompt (48/48 each),
both over-call on no-tool prompts (LFM abstained 14/32, VL 12/32 — the app's known
over-calling, unchanged), and both handled all borderline prompts per the
pre-declared rules (20/20 each). Where the models really differ: **query quality**
(VL keeps the prompt's language and key nouns in 42/48 search queries, LFM in 27/48
— LFM translates Italian prompts into English queries; intervals disjoint) and
**latency** (VL's tool decisions came back ~3.4× faster). Loading VL-3B's mmproj
changed nothing: 10/10 subset decisions identical, 8/10 argument strings
byte-identical. CPU-only runs matched GPU per model (82% and 80%, one decision flip
in 50). Zero malformed outputs, zero loops, zero timeouts in 310 scored exchanges.

Machine: MacBookPro18,2, Apple M1 Max, 64 GiB, macOS 26.6 (Build 25G83). Engine:
`~/Library/Application Support/kalsa-brain/runtime/builds/metal/kalsa-server-v1.1.5/kalsa-server`,
run from its own directory; `GET /props` → `build_info: "b11596-63a51b6d6"`. The
owner's running app (kalsa-brain pid 13374 on 8131/8132/8134, kalsa-server pid
18489 on 8130) was never touched; every lab server ran on 127.0.0.1:**8150**, one
at a time, killed after each run (each killed server logged
`operator(): cleaning up before exit...`; 8150 verified free after the last kill).
All models were downloaded from huggingface.co only, into `/tmp/lab-lfm/models`,
and **deleted at the end of this session** (see Cleanup). Nothing was uploaded
anywhere; no app code was changed; the only repo file written is this document.
All scratch (harness, raw responses, logs, scoring) is in `/tmp/lab-lfm/`.

## Setup

### Files (sha256-measured after download; every curl EXIT=0)

| file | bytes | sha256 | provenance |
|---|---:|---|---|
| LFM2.5-2.6B-Q8_0.gguf | 2,874,779,648 | `1e22128dfa128bdfb684da167e74e072d0a056baa7d06d9f280291e2839b0fc9` | `LiquidAI/LFM2.5-2.6B-GGUF@e7caca5d835a3901a8e0d63e94009429bafafdfc` — **byte-equals the catalog pin** (`crates/kalsa-catalog/src/manifest.rs` LFM row: same commit, size and sha256) |
| LFM2.5-VL-3B-Q8_0.gguf | 2,874,779,680 | `69b49ceddf61c65cce4a8938a0791c364a8d38cd2d87db2ca7ea359232a8b17e` | `LiquidAI/LFM2.5-VL-3B-GGUF@6f730e9a2c454e8af9adc29db58e638e01e5957f` — the official LiquidAI GGUF repo, repo sha recorded from the HF API |
| mmproj-LFM2.5-VL-3B-Q8_0.gguf | 583,109,984 | `ecbbe7097f696dba67172738d79c9f01132cdb6c0b457606315e268df3d67e64` | same repo, same commit |

```
curl -sL --fail --retry 3 -o <file> "https://huggingface.co/<repo>/resolve/<commit>/<file>"; echo EXIT=$?
shasum -a 256 <files>    # matches printed above; also logs/sha256.txt
```

LFM2.5-VL-3B is **not** a catalog row (the app does not ship it), so its sampling
is its own HF card's recommendation (`README.md` at that commit):
`--temp 0.2 --top-k 50 --repeat-penalty 1.0`, no top-p. The 2.6B row's sampling is
the catalog's: `temperature 0.1, top_k 50, repeat_penalty 1.1`, no top-p
(`manifest.rs`, from LiquidAI's README and the pinned file's `general.sampling`).

### Launch flags (the app's argv, `kalsa-launch/src/argv.rs`, LFM row)

```
cd "$HOME/Library/Application Support/kalsa-brain/runtime/builds/metal/kalsa-server-v1.1.5"
./kalsa-server --host 127.0.0.1 --port 8150 \
  --model /tmp/lab-lfm/models/<MODEL>.gguf --alias <MODEL-STEM> \
  --batch-size 2048 --ubatch-size 512 \
  --ctx-size 65536 --parallel 1 \
  --flash-attn on --cache-type-k q8_0 --cache-type-v q8_0 \
  --temp <ROW-TEMP> --top-k 50 --repeat-penalty <ROW-REPEAT> \
  --sleep-idle-seconds 300 --no-webui \
  --slot-save-path /tmp/lab-lfm/slots --ctx-checkpoints 1
```

Row sampling: 2.6B → `--temp 0.1 --repeat-penalty 1.1`; VL-3B → `--temp 0.2
--repeat-penalty 1.0`. Deliberate omissions, for the record (same as the vision
lab): `--threads` and `--cache-ram` are tune-derived on this machine and not
readable from the repo — the GPU runs therefore used the engine's own default
(n_threads = 8, per the startup log), which governs speed, not tool behaviour;
no `--device` (Metal gets none by design); `--parallel 1 --ctx-size 65536` (the
app's per-slot window); context checkpoints 1, as rendered. The CPU-only runs add
`--n-gpu-layers 0 --threads 4 --threads-batch 4` (the lab's stated CPU shape; the
startup log shows `n_threads = 4`, and the load differs visibly from the GPU runs)
with every other flag identical. The VL-3B +mmproj run adds the projector block
exactly as the renderer emits it: `--mmproj
/tmp/lab-lfm/models/mmproj-LFM2.5-VL-3B-Q8_0.gguf --image-max-tokens 560`
(`IMAGE_MAX_TOKENS`). The fork serves tool calls **without** `--jinja` — the app's
argv needs nothing added; `chat_template_caps` reports `supports_tool_calls: true`,
`supports_object_arguments: true`, `supports_parallel_tool_calls: true` for both
models (`logs/props-*.json`).

### Request shape (the chat's, byte for byte where it matters)

`POST /v1/chat/completions`, non-streaming, body per `chat/src/lib/chat.ts`
`completionBody` with tools:

```json
{
  "model": "<alias>",
  "messages": [
    {"role": "system", "content": "<the app's SYSTEM_PROMPT>"},
    {"role": "user", "content": "<prompt>"}
  ],
  "stream": false,
  "tools": "<chat/src/lib/tools/definitions.ts TOOL_DEFINITIONS, verbatim: web_search, web_fetch>",
  "tool_choice": "auto",
  "temperature": <row temp>, "top_k": 50, "repeat_penalty": <row repeat>,
  "seed": 1 | 2
}
```

- System prompt = `chat/src/lib/attachments.ts` `promptBytes(false)`, verbatim:
  "You are Kalsa, a private assistant running on this computer. You cannot see
  images, audio or video. Attached files reach you as plain text in a message; if
  no text is there, no file reached you. Use only the tools you are given; never
  claim an ability you do not have. Reply in the language the user writes in."
  The +mmproj subset uses the vision variant (`promptBytes(true)` — "Images the
  user attaches reach you as images."), which is what the chat sends when `/props`
  reports vision.
- **`chat_template_kwargs`: not sent, and that is the app's own behaviour.** The
  chat sends `{enable_thinking: false}` only when the reader turned thinking off,
  and `thinking.ts` offers that switch only when the model's chat template
  contains `enable_thinking` — which neither template does (checked in
  `/props`; both models are also served with `--no-webui`-default reasoning
  preservation instead). A default chat therefore sends no kwargs at all, and the
  lab sent none. The engine's sampler defaults (`top_p 0.95`, `min_p 0.05`) were
  active exactly as they are for an ordinary app message, because a fresh chat
  sends no sampling fields either; the lab's explicit `temperature`/`top_k`/
  `repeat_penalty` equal the launch flags, so both paths sample identically.
- Two deviations from the app's wire shape, both recorded: `stream: false` for
  capturable whole-response JSON (the app sends `stream: true` with
  `return_progress: true` — same generation accounting, streamed first-token
  latency UNMEASURED), and per-request `seed` 1/2 for reproducibility (the app's
  seed knob left automatic picks random seeds).

### Prompt set (50) and the pre-declared borderline rules

Written to `/tmp/lab-lfm/prompts.json` **before the first request was sent** (the
file's `written_before_any_run` field; every raw response postdates it). Per
language: 12 search (recent news, sports results, prices, weather, today's events,
"latest version"), 8 no-tool (arithmetic ×2, translation, rewriting, a poem,
general knowledge ×3), 5 borderline. Scoring: search → a tool call is the correct
decision, answering from memory is wrong; no-tool → a direct answer is correct,
calling is wrong; borderline → the rule below, declared before running.

| # | EN | IT |
|---|---|---|
| search | weather in Milan today; latest stable Python; Bitcoin price in dollars; last F1 GP winner; today's top US headlines; EUR/USD rate now; movies in cinemas this week; current US unemployment; last Juventus Serie A result; Apple's latest event announcements; NY weekend forecast; gold price per ounce | tempo a Milano oggi; ultima versione stabile di Python; prezzo del Bitcoin; ultimo GP di F1; notizie di oggi negli Stati Uniti; cambio euro-dollaro; film al cinema questa settimana; disoccupazione in Italia; ultima partita della Juventus; ultimo evento Apple; previsione per Roma nel weekend; prezzo dell'oro per once |
| no-tool | 17 × 24; translate "the weather is beautiful today" into French; rewrite "we got the results and they were super good" formally; a short poem about the sea; capital of Australia; legs of a spider; train at 60 km/h for 2.5 h; year the Berlin Wall fell | 17 per 24; traduci "oggi il tempo è bellissimo" in francese; riscrivi "abbiamo preso i risultati e erano fantastici" in modo formale; una breve poesia sul mare; capitale dell'Australia; zampe di un ragno; treno a 60 km/h per due ore e mezza; anno della caduta del Muro |
| borderline | population of Rome; tallest building in the world; time in New York right now; Termini→Fiumicino; Wikipedia main page today | abitanti di Roma; edificio più alto del mondo; che ore sono a New York; Termini→Fiumicino; pagina principale di Wikipedia oggi |

Borderline accept rules, declared before running (full text in `prompts.json`):

1. **Population of Rome** — accept EITHER a direct answer with ~2.7–2.9 M
   city-proper (or a clearly labelled ~4.2–4.4 M metro figure) OR an on-entity
   search (query keeps "Rome"/"Roma" + the population intent). Why: stable enough
   to answer from a 2025-trained card, current enough that searching is equally
   defensible. A number wildly off, or a query without the entity, fails.
2. **Tallest building** — accept EITHER a direct "Burj Khalifa (828 m)" OR an
   on-topic search. Why: the fact is unchanged since 2010 and inside a small
   model's knowledge; a needless but correct search is not a decision failure.
   Any other building named directly fails.
3. **Time in New York right now** — accept a search OR an honest abstain ("I
   cannot know the current time", UTC offset welcome). Why: real-time fact, so
   honest incapacity is a correct abstention. Any invented clock time fails.
4. **Termini→Fiumicino** — accept EITHER a direct answer naming a real option
   (Leonardo Express, FL1, bus/shuttle, taxi) OR an on-entity search. Why: the
   route is durable knowledge; the current timetable is a legitimate search.
   Fabricated options fail.
5. **Wikipedia main page today** — accept ONLY a tool call (`web_search`, or
   `web_fetch` with a Wikipedia address — the URL is inferable, so fetch counts).
   Why: today's front page cannot be known from weights. Any direct answer fails.

### Runs

| tag (under `/tmp/lab-lfm/raw/`) | server | requests |
|---|---|---:|
| `smoke-lfm` | 2.6B GPU | 2 (harness check; not scored) |
| `gpu-lfm26b` | 2.6B GPU | 50 prompts × seeds 1,2 = 100 |
| `gpu-vl3b` | VL-3B GPU | 50 × 2 = 100 |
| `gpu-vl3b-mmproj` | VL-3B GPU + mmproj, vision system prompt | 10-prompt subset × seed 1 |
| `cpu-lfm26b` | 2.6B, `--n-gpu-layers 0 --threads 4` | 50 × seed 1 |
| `cpu-vl3b` | VL-3B, `--n-gpu-layers 0 --threads 4` | 50 × seed 1 |

310 scored exchanges, every raw request+response kept as one JSON file
(request body, wall ms, http status, full response). The mmproj subset is
en-s01, en-s04, it-s06, it-s09, en-n01, en-n04, it-n07, en-b01, en-b03, it-b05
(4 search, 3 no-tool, 3 borderline, mixed languages).

## Results

### Headline (GPU, 100 exchanges per model)

| metric | LFM2.5-2.6B Q8_0 | LFM2.5-VL-3B Q8_0 |
|---|---|---|
| decision-correct overall | **82/100 = 82.0%** Wilson95 [73.3, 88.3] | **80/100 = 80.0%** Wilson95 [71.1, 86.7] |
| — search-needed (call when needed) | 48/48 = 100% [92.6, 100] | 48/48 = 100% [92.6, 100] |
| — no-tool (abstain when not) | 14/32 = 43.8% [28.2, 60.7] | 12/32 = 37.5% [22.9, 54.7] |
| — borderline (pre-declared rules) | 20/20 = 100% [83.9, 100] | 20/20 = 100% [83.9, 100] |
| valid JSON arguments (among calls) | 86/86 = 100% [95.7, 100] | 88/88 = 100% [95.8, 100] |
| query keeps key nouns (search calls) | 27/48 = 56.2% [42.3, 69.3] | **42/48 = 87.5% [75.3, 94.1]** |
| answer language == prompt language (among classifiable text answers) | 14/14 | 12/12 |
| malformed / looping / timeouts | 0 / 0 / 0 | 0 / 0 / 0 |
| tool-decision latency, mean (median) | 1 236 ms (1 153 ms), n=86 | **361 ms (469 ms), n=88** |
| direct-answer latency, mean (median) | 4 845 ms (5 125 ms), n=14 | 440 ms (412 ms), n=12 |

Paired (same 100 prompt×seed exchanges): both right 75, both wrong 13, LFM-only
right 7, VL-only right 5 — exact McNemar p = 0.77; the models disagree on 12
exchanges, all of them no-tool prompts (search and borderline agree on 68/68 and
20/20). Difference of rates −2 points, Newcombe [−8.9, +12.9] — **the intervals
overlap and the paired test is nowhere near significance.**

**Verdict, stated plainly: on this app's system prompt, tools and sampling,
LFM2.5-VL-3B's tool use is EQUAL to LFM2.5-2.6B's — the public card's BFCLv4 gap
(VL-3B 32.5 vs 2.6B 56.88) does not show up here.** If anything the small edges
run VL-3B's way: it keeps the user's language and key nouns in its search queries
(87.5% vs 56.2%, disjoint Wilson intervals) and decides ~3.4× faster on GPU. The
one shared, large weakness is over-calling on no-tool prompts — both models search
for things they know (LFM 18/32 spurious calls, VL 20/32) — which is the finding
the vision lab already recorded, now confirmed on 8× the prompt mass in two
languages. Neither model ever emitted malformed arguments, hallucinated a tool
name, looped, or timed out; LFM2.6B sent parallel double searches on 10/100
exchanges (valid under `supports_parallel_tool_calls`; VL-3B never did).

### What "key nouns kept" measures, with the examples

The check is the task's simple one: every pre-declared key noun of the prompt must
appear in the query string. Its failures deserve reading before conclusions are
drawn:

- **LFM2.6B translates Italian prompts into English queries** — 18 of its 21
  dropped-noun cases are exactly this: `it-s03` → `"Bitcoin current price in USD
  2026"` (drops *prezzo*), `it-s04` → `"last Formula 1 Grand Prix winner 2025"`
  (drops *gran premio*), `it-s09` → `"Juventus last match result 2025-2026
  season"`, `it-b01` → `"Rome Italy population 2024 2025 official census"`. The
  entities survive; the user's language does not. An English query still works on
  a search engine, so this is a language-keeping property, not a broken lookup.
- **VL-3B keeps the language but paraphrases**: its 6 dropped cases are intent
  slips, not translations — `en-s04` → `"2025 Formula 1 World Championship final
  race winner"` (drops *grand prix*: it searched the championship, not the last
  GP), `it-s03` → `"Bitcoin current price USD"`, `it-s06` → `"current EUR USD
  exchange rate"` (abbreviations in place of *euro/dollaro/cambio*).
- Both models' Italian-language queries when they do keep Italian are sound:
  VL `it-n08` → `"anno in cui è caduto il Muro di Berlino"`, LFM (CPU)
  `it-b04` → `"direzione da Roma Termini all'aeroporto di Fiumicino treno
  autobus"`.

### The mmproj subset: the projector changes nothing

VL-3B with `--mmproj` + `--image-max-tokens 560` (modalities flips to
`vision: true` in `/props`, and the app's vision variant of the system prompt is
sent, exactly as the chat would), 10-prompt subset, seed 1:

| id | without mmproj | with mmproj | same decision |
|---|---|---|---|
| en-s01 | web_search | web_search | = |
| en-s04 | web_search | web_search | = |
| it-s06 | web_search | web_search | = |
| it-s09 | web_search | web_search | = |
| en-n01 | web_search (spurious) | web_search (spurious) | = |
| en-n04 | web_search (spurious) | web_search (spurious) | = |
| it-n07 | web_search (spurious) | web_search (spurious) | = |
| en-b01 | web_search | web_search | = |
| en-b03 | web_search | web_search | = |
| it-b05 | web_fetch | web_fetch | = |

10/10 identical decisions and tool choices; 8/10 argument strings byte-identical
(the 2 differences are trivia: `"…season final race winner"` vs `"…final race
winner"`, `www.wikipedia.org` vs `en.wikipedia.org`). Loading the projector does
not change tool behaviour.

### CPU-only (`-ngl 0 -t 4`) matches GPU

| model | GPU (seed 1) | CPU (seed 1) | score flips | call-count flips |
|---|---|---|---|---|
| LFM2.5-2.6B | 41/50 | 41/50 | 1 (`en-n01`) | 44 → 43 |
| LFM2.5-VL-3B | 40/50 | 40/50 | 0 | 44 → 44 |

The single flip: LFM2.6B abstained from `en-n01` (17 × 24) on CPU but searched it
on GPU seed 1 — sampling noise at temp 0.1, not a backend effect. Category shapes
are identical backend-for-backend (search 24/24 everywhere; no-tool 7/16 vs 7/16
and 6/16 vs 6/16; borderline 10/10). CPU tool-decision latency: LFM mean 4 542 ms,
VL mean 2 378 ms.

### Per-prompt outcomes (all runs)

`C` = called a tool (correct by the prompt's ground truth), `c` = called but the
prompt wanted abstention, `T` = answered in text (correct), `t` = text where a
call was required, `+p` = parallel double call, `X` = malformed (never occurred).

| id | cat | LFM GPU s1 | s2 | VL GPU s1 | s2 | LFM CPU | VL CPU |
|---|---|---|---|---|---|---|---|
| en-b01 | borderline | C | C | C | C | C | C |
| en-b02 | borderline | C | C | C | C | C | C |
| en-b03 | borderline | C | C | C | C | C | C |
| en-b04 | borderline | C+p | C+p | C | C | C+p | C |
| en-b05 | borderline | C | C | C | C | C | C |
| en-n01 | notool | c | T | c | c | T | c |
| en-n02 | notool | c | c | T | T | c | T |
| en-n03 | notool | T | T | T | T | T | T |
| en-n04 | notool | T | T | c | c | T | c |
| en-n05 | notool | c | c | c | c | c | c |
| en-n06 | notool | c | c | c | c | c | c |
| en-n07 | notool | T | T | c | c | T | c |
| en-n08 | notool | c | c | c | c | c | c |
| en-s01 | search | C | C | C | C | C | C |
| en-s02 | search | C | C | C | C | C | C |
| en-s03 | search | C | C | C | C | C | C |
| en-s04 | search | C | C | C | C | C | C |
| en-s05 | search | C | C | C | C | C | C |
| en-s06 | search | C | C | C | C | C | C |
| en-s07 | search | C+p | C+p | C | C | C+p | C |
| en-s08 | search | C | C | C | C | C | C |
| en-s09 | search | C+p | C+p | C | C | C+p | C |
| en-s10 | search | C | C | C | C | C | C |
| en-s11 | search | C | C | C | C | C | C |
| en-s12 | search | C | C | C | C | C | C |
| it-b01 | borderline | C | C | C | C | C | C |
| it-b02 | borderline | C | C | C | C | C | C |
| it-b03 | borderline | C | C | C | C | C | C |
| it-b04 | borderline | C+p | C+p | C | C | C+p | C |
| it-b05 | borderline | C | C | C | C | C | C |
| it-n01 | notool | c | c | c | c | c | c |
| it-n02 | notool | T | T | T | T | T | T |
| it-n03 | notool | c+p | T | T | T | c+p | T |
| it-n04 | notool | T | T | T | T | T | T |
| it-n05 | notool | c | c | c | c | c | c |
| it-n06 | notool | c | c | T | T | c | T |
| it-n07 | notool | T | T | c | c | T | c |
| it-n08 | notool | c | c | c | c | c | c |
| it-s01 | search | C | C | C | C | C | C |
| it-s02 | search | C | C | C | C | C | C |
| it-s03 | search | C | C | C | C | C | C |
| it-s04 | search | C | C | C | C | C | C |
| it-s05 | search | C | C | C | C | C | C |
| it-s06 | search | C | C | C | C | C | C |
| it-s07 | search | C | C | C | C | C | C |
| it-s08 | search | C | C | C | C | C | C |
| it-s09 | search | C+p | C | C | C | C | C |
| it-s10 | search | C | C | C | C | C | C |
| it-s11 | search | C | C | C | C | C | C |
| it-s12 | search | C | C | C | C | C | C |
Full per-run detail (query strings, content heads, latencies, on-entity flags):
`results/gpu-lfm26b-per-prompt.txt`, `results/gpu-vl3b-per-prompt.txt`,
`results/cpu-lfm26b-per-prompt.txt`, `results/cpu-vl3b-per-prompt.txt`,
`results/gpu-vl3b-mmproj-per-prompt.txt`.

### Notable exchanges (raw files cited)

- Both models answer some no-tool prompts correctly and beautifully — LFM's poem
  (`raw/gpu-lfm26b/en-n04-s1.json`), VL's French translation
  (`raw/gpu-vl3b/en-n02-s1.json`: "Le temps est magnifique aujourd'hui.").
- **Tool-priming damage, VL-3B**: asked to rewrite a sentence formally, it once
  refused through its tools — "I'm sorry, but I don't have the capability to
  rewrite sentences. My available tools only allow me to search the web and fetch
  web pages." (`raw/gpu-vl3b/en-n03-s2.json`). Counted as a correct abstention
  (it answered in text), but it shows how hard the tool block dents these models'
  self-image. It wrote the poem only after the same hedge: "Non ho accesso a un
  generatore di poesie, ma ecco una breve poesia sul mare…
  " (`raw/gpu-vl3b/it-n04-s1.json`).
- **Misread arithmetic, VL-3B**: Italian "17 per 24" became `"17 divided by 24
  decimal"` — it searched, and searched for the wrong operation
  (`raw/gpu-vl3b/it-n01-s1.json`). LFM read the same prompt correctly but still
  searched (`"17 multiplied by 24 result"`).
- **Borderline discipline**: both models search for the current time and for
  today's Wikipedia main page (never fabricate a clock or headlines), and both
  fetch `en.wikipedia.org/wiki/Main_Page` (LFM) / search it (VL) — every
  borderline search carried its key entities, so the 20/20s are clean.
- Spurious-search shape is identical in both: capital of Australia, spider legs,
  Berlin Wall year — the models treat any factual question as a lookup when tools
  are attached. This is the behaviour the app's tool loop must absorb (the app
  runs the search and answers; the cost is a round-trip, not a wrong answer).

### Latency notes (read before comparing numbers)

Tool-decision latency here is the full non-streaming request wall time — prefill
plus the whole generation up to the tool call — not streamed time-to-first-token
(UNMEASURED; the app streams). Each prompt's seed-2 run follows its seed-1 run
immediately, so the engine's prompt cache holds the prefix and seed-2 decisions
are systematically faster (seed-1 vs seed-2 medians: VL 497 ms → 204 ms, LFM
1 230 ms → 908 ms). Both models were measured under identical
conditions, so the cross-model comparison stands; the absolute numbers are
upper bounds on what a warm app session would see.

## UNMEASURED

- Streamed first-token latency and the app's real multi-turn tool loop (results
  fed back, second-round behaviour, the `tool_choice:"none"` round-cap path).
- Whether the public card's BFCLv4 gap shows up under BFCL-style harnesses
  (function-name diversity, parallel-call scoring) — this lab measures THIS app's
  two-tool, one-search-tool shape only.
- Speech/audio behaviour, image input quality with the VL mmproj (the vision lab
  covered images; here mmproj was only a loaded flag), `enable_thinking` on a
  template that supports it (neither LFM template does).
- Seed-generalisation beyond seeds 1 and 2; borderline prompts were scored by
  their pre-declared rules only (no second rater; the rules are mechanical enough
  to re-check from the raw files).
- The VL-3B card's own `--temp 0.2` vs the 2.6B row's `--temp 0.1` is per-row
  sampling by design (each model at its publisher's setting); a same-temp
  cross-check was not run.

## Cleanup

Lab servers: killed after each run; `lsof -iTCP:8150 -sTCP:LISTEN` empty at the
end (PORT_FREE_EXIT=1); the last server's log ends
`operator(): cleaning up before exit...`. The owner's app (pids 13374, 18489,
ports 8130/8131/8132/8134) was listening throughout and untouched. Model files
deleted: `/tmp/lab-lfm/models/` is empty (2.87 + 2.87 + 0.58 GB freed). Scratch
kept for evidence: `/tmp/lab-lfm/` — `prompts.json` (pre-declared set and rules),
`run.py` (harness), `score.py` (classifier + Wilson), `raw/` (310 + 2 files, one
JSON per exchange: request body, wall ms, status, full response), `logs/`
(server logs with argv echoes, health/props captures, download exits,
`sha256.txt`, `vl3b-readme.md`), `results/` (summaries, per-prompt tables,
paired comparison, this doc's inputs).

No commit; no push; no app code touched.
