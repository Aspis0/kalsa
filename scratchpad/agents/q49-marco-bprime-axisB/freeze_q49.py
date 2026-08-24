#!/usr/bin/env python3
"""Write prompts.json then PREREG.md with sha. Must run BEFORE any generation."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent

PROMPTS = [
    # --- factual IT (5) ---
    {"id": "fact_it_01", "cat": "factual", "lang": "it", "n_predict": 512,
     "text": "In quale città italiana si trova la Cappella degli Scrovegni? Rispondi in italiano con il nome della città e una frase di contesto."},
    {"id": "fact_it_02", "cat": "factual", "lang": "it", "n_predict": 512,
     "text": "Chi fu il primo Presidente della Repubblica Italiana? Rispondi in italiano, nome e cognome."},
    {"id": "fact_it_03", "cat": "factual", "lang": "it", "n_predict": 512,
     "text": "In che anno si tenne il referendum istituzionale che portò alla nascita della Repubblica Italiana? Rispondi in italiano con l'anno."},
    {"id": "fact_it_04", "cat": "factual", "lang": "it", "n_predict": 512,
     "text": "Qual è il fiume più lungo interamente in territorio italiano? Rispondi in italiano."},
    {"id": "fact_it_05", "cat": "factual", "lang": "it", "n_predict": 512,
     "text": "Chi ha composto l'opera 'La traviata'? Rispondi in italiano, nome e cognome del compositore."},
    # --- factual EN (5) ---
    {"id": "fact_en_01", "cat": "factual", "lang": "en", "n_predict": 512,
     "text": "What is the chemical symbol for tungsten? Answer in English in one or two sentences."},
    {"id": "fact_en_02", "cat": "factual", "lang": "en", "n_predict": 512,
     "text": "Which planet in the Solar System has the Great Red Spot? Answer in English."},
    {"id": "fact_en_03", "cat": "factual", "lang": "en", "n_predict": 512,
     "text": "In which year did the Berlin Wall fall? Answer in English with the year and a short clause of context."},
    {"id": "fact_en_04", "cat": "factual", "lang": "en", "n_predict": 512,
     "text": "Who wrote the novel Pride and Prejudice? Answer in English with the author's name."},
    {"id": "fact_en_05", "cat": "factual", "lang": "en", "n_predict": 512,
     "text": "What is the capital city of New Zealand? Answer in English."},
    # --- factual ES (5) ---
    {"id": "fact_es_01", "cat": "factual", "lang": "es", "n_predict": 512,
     "text": "¿Quién escribió la novela Cien años de soledad? Responde en español con el nombre del autor."},
    {"id": "fact_es_02", "cat": "factual", "lang": "es", "n_predict": 512,
     "text": "¿Cuál es la capital de Ecuador? Responde en español."},
    {"id": "fact_es_03", "cat": "factual", "lang": "es", "n_predict": 512,
     "text": "¿En qué año llegó Cristóbal Colón a América en su primer viaje? Responde en español con el año."},
    {"id": "fact_es_04", "cat": "factual", "lang": "es", "n_predict": 512,
     "text": "¿Qué río atraviesa la ciudad de Sevilla? Responde en español."},
    {"id": "fact_es_05", "cat": "factual", "lang": "es", "n_predict": 512,
     "text": "¿Quién pintó el cuadro Las Meninas? Responde en español con el nombre del pintor."},
    # --- factual FR (5) ---
    {"id": "fact_fr_01", "cat": "factual", "lang": "fr", "n_predict": 512,
     "text": "Qui a écrit le roman Les Misérables ? Réponds en français avec le nom de l'auteur."},
    {"id": "fact_fr_02", "cat": "factual", "lang": "fr", "n_predict": 512,
     "text": "Quelle est la capitale de la Belgique ? Réponds en français."},
    {"id": "fact_fr_03", "cat": "factual", "lang": "fr", "n_predict": 512,
     "text": "En quelle année a eu lieu la prise de la Bastille ? Réponds en français avec l'année."},
    {"id": "fact_fr_04", "cat": "factual", "lang": "fr", "n_predict": 512,
     "text": "Quel est le plus haut sommet des Alpes ? Réponds en français."},
    {"id": "fact_fr_05", "cat": "factual", "lang": "fr", "n_predict": 512,
     "text": "Qui a peint Impression, soleil levant ? Réponds en français avec le nom du peintre."},
    # --- factual ZH (5) ---
    {"id": "fact_zh_01", "cat": "factual", "lang": "zh", "n_predict": 512,
     "text": "中国的首都是哪座城市？请用中文回答。"},
    {"id": "fact_zh_02", "cat": "factual", "lang": "zh", "n_predict": 512,
     "text": "《红楼梦》的作者是谁？请用中文回答姓名。"},
    {"id": "fact_zh_03", "cat": "factual", "lang": "zh", "n_predict": 512,
     "text": "世界上最高的高原是哪个高原？请用中文回答。"},
    {"id": "fact_zh_04", "cat": "factual", "lang": "zh", "n_predict": 512,
     "text": "圆周率π大约等于多少？请用中文回答，并写出小数点后至少四位。"},
    {"id": "fact_zh_05", "cat": "factual", "lang": "zh", "n_predict": 512,
     "text": "孔子大约生活在中国的哪个历史时期（朝代）？请用中文回答。"},
    # --- instruction-following (10): 5 EN + 5 IT ---
    {"id": "inst_en_01", "cat": "instruction", "lang": "en", "n_predict": 256,
     "format": "json_ok_n",
     "text": "Reply with ONLY a JSON object with exactly two keys: \"ok\" (boolean true) and \"n\" (integer 7). No markdown, no extra keys, no other text."},
    {"id": "inst_en_02", "cat": "instruction", "lang": "en", "n_predict": 256,
     "format": "three_lines_ready",
     "text": "Output exactly three lines and nothing else. Line 1 must be the word READY. Line 2 must be the integer 3. Line 3 must be the word END."},
    {"id": "inst_en_03", "cat": "instruction", "lang": "en", "n_predict": 256,
     "format": "csv_two_rows",
     "text": "Return a CSV with header name,year and exactly two data rows: Ada,1815 and Alan,1912. No extra lines, no commentary."},
    {"id": "inst_en_04", "cat": "instruction", "lang": "en", "n_predict": 256,
     "format": "xml_answer_42",
     "text": "Wrap your entire answer in <answer>...</answer> tags and put nothing outside the tags. Inside the tags, write only the integer 42."},
    {"id": "inst_en_05", "cat": "instruction", "lang": "en", "n_predict": 256,
     "format": "hash_protocol",
     "text": "Your reply must start with the two characters hash-space (the '#' character, then a space), then the word PROTOCOL, then a newline, then the word OK. Nothing else."},
    {"id": "inst_it_01", "cat": "instruction", "lang": "it", "n_predict": 256,
     "format": "four_numbered_colors",
     "text": "Rispondi con ESATTAMENTE quattro voci numerate che iniziano con '1. ' '2. ' '3. ' '4. ' e nient'altro. Le quattro voci, in quest'ordine, devono essere: rosso, blu, giallo, verde."},
    {"id": "inst_it_02", "cat": "instruction", "lang": "it", "n_predict": 256,
     "format": "posneg_plus_sentence",
     "text": "La prima riga deve essere SOLO la parola POSITIVO in maiuscolo. La seconda riga deve essere una frase in italiano che afferma che due più due fa quattro. Nient'altro."},
    {"id": "inst_it_03", "cat": "instruction", "lang": "it", "n_predict": 256,
     "format": "yaml_torino",
     "text": "Output: un blocco YAML che inizia con la riga --- e contiene solo la chiave citta: con valore Torino. Nient'altro prima o dopo."},
    {"id": "inst_it_04", "cat": "instruction", "lang": "it", "n_predict": 256,
     "format": "three_bullets_abg",
     "text": "Scrivi tre righe bullet che iniziano ciascuna con '- ' (trattino seguito da uno spazio). Il testo delle tre voci deve essere esattamente alfa, beta, gamma in quest'ordine. Nient'altro."},
    {"id": "inst_it_05", "cat": "instruction", "lang": "it", "n_predict": 256,
     "format": "data_moon",
     "text": "Rispondi con una sola riga nel formato DATA=YYYY-MM-DD usando la data del primo sbarco umano sulla Luna (20 luglio 1969). Nient'altro."},
    # --- code EN (5) ---
    {"id": "code_en_01", "cat": "code", "lang": "en", "n_predict": 512,
     "text": "Write a Python function is_palindrome(s: str) -> bool that ignores case and spaces. Code only, no explanation, no markdown fences."},
    {"id": "code_en_02", "cat": "code", "lang": "en", "n_predict": 512,
     "text": "Write a SQL query that selects email from a table named users where active = 1, ordered by created_at DESC, limited to 10 rows. SQL only, no explanation."},
    {"id": "code_en_03", "cat": "code", "lang": "en", "n_predict": 512,
     "text": "Write a JavaScript function sumEvens(arr) that returns the sum of even numbers in an array of integers. Code only, no explanation, no markdown fences."},
    {"id": "code_en_04", "cat": "code", "lang": "en", "n_predict": 256,
     "text": "Write a Python list comprehension that produces the squares of the integers from 1 through 10 inclusive, assigned to a variable named squares. One line of code only."},
    {"id": "code_en_05", "cat": "code", "lang": "en", "n_predict": 512,
     "text": "Write a POSIX sh function named die that prints all its arguments to stderr and exits with status 1. Shell code only, no explanation."},
    # --- reasoning/math (8): 4 IT + 4 EN ---
    {"id": "math_it_01", "cat": "reasoning", "lang": "it", "n_predict": 512,
     "text": "Una scatola contiene 3 cassetti. In ciascun cassetto ci sono 4 scatole più piccole, e in ciascuna di queste ci sono 5 biglie. Quante biglie ci sono in totale? Rispondi in italiano mostrando i passaggi e il numero finale."},
    {"id": "math_it_02", "cat": "reasoning", "lang": "it", "n_predict": 512,
     "text": "Un treno parte alle 09:10 e arriva alle 11:05. Quanto dura il viaggio in minuti? Rispondi in italiano con i passaggi."},
    {"id": "math_it_03", "cat": "reasoning", "lang": "it", "n_predict": 512,
     "text": "Quanto fa il 15 percento di 80? Rispondi in italiano mostrando il calcolo."},
    {"id": "math_it_04", "cat": "reasoning", "lang": "it", "n_predict": 512,
     "text": "Un triangolo ha lati 3, 4 e 5. È un triangolo rettangolo? Rispondi in italiano e spiega perché sì o no."},
    {"id": "math_en_01", "cat": "reasoning", "lang": "en", "n_predict": 512,
     "text": "A tank is 3/4 full. You drain 1/3 of the current contents. What fraction of the tank's capacity remains? Answer in English with steps."},
    {"id": "math_en_02", "cat": "reasoning", "lang": "en", "n_predict": 512,
     "text": "Solve for x: x + 3 = 2x - 5. Answer in English showing the algebra and the value of x."},
    {"id": "math_en_03", "cat": "reasoning", "lang": "en", "n_predict": 512,
     "text": "How many distinct permutations are there of the letters in the word BOOK? Answer in English showing the counting argument."},
    {"id": "math_en_04", "cat": "reasoning", "lang": "en", "n_predict": 512,
     "text": "A clock shows 3:15. What is the angle in degrees between the hour hand and the minute hand? Answer in English with steps."},
    # --- long-form IT (6) ---
    {"id": "long_it_01", "cat": "longform", "lang": "it", "n_predict": 1024,
     "text": "Scrivi una lettera formale di circa 200 parole a un Comune italiano per chiedere il permesso di occupare suolo pubblico sabato prossimo con un banchetto di libri usati in una piazza. Italiano, registro burocratico-civile, con destinatario fittizio ma realistico."},
    {"id": "long_it_02", "cat": "longform", "lang": "it", "n_predict": 1024,
     "text": "Spiega a un quindicenne, in italiano, come funziona un vaccino a mRNA. Circa 250 parole, tono calmo, senza allarmismo e senza slogan."},
    {"id": "long_it_03", "cat": "longform", "lang": "it", "n_predict": 1024,
     "text": "Narra in prima persona un pomeriggio d'estate a Bologna, circa 300 parole, tono realistico, niente elementi fantastici. Tutto in italiano."},
    {"id": "long_it_04", "cat": "longform", "lang": "it", "n_predict": 1024,
     "text": "Redigi un verbale di riunione di condominio di circa 200 parole in cui i condomini decidono di riparare il tetto e di ripartire la spesa per millesimi. Italiano, forma da verbale."},
    {"id": "long_it_05", "cat": "longform", "lang": "it", "n_predict": 1024,
     "text": "Scrivi un'email di reclamo, civile ma ferma, a un e-commerce per un pacco arrivato con la confezione schiacciata e un oggetto incrinato. Circa 180 parole, in italiano, con richiesta concreta."},
    {"id": "long_it_06", "cat": "longform", "lang": "it", "n_predict": 1024,
     "text": "Descrivi passo-passo come preparare un risotto allo zafferano per un cuoco principiante, in italiano, con quantità per 4 persone. Circa 250 parole."},
    # --- language-fidelity traps (6) ---
    {"id": "trap_it_01", "cat": "langfid", "lang": "it", "n_predict": 512,
     "text": "Spiega in italiano, senza usare parole inglesi, che cos'è un buffer overflow in informatica. Se ti viene in mente un termine inglese, traducilo o circoscrivilo."},
    {"id": "trap_fr_01", "cat": "langfid", "lang": "fr", "n_predict": 512,
     "text": "Réponds uniquement en français. Qu'est-ce que le machine learning ? N'écris aucun mot anglais."},
    {"id": "trap_es_01", "cat": "langfid", "lang": "es", "n_predict": 512,
     "text": "Contesta solo en español. ¿Qué es un pull request en git? No uses palabras en inglés."},
    {"id": "trap_zh_01", "cat": "langfid", "lang": "zh", "n_predict": 512,
     "text": "请只用中文回答，不要夹杂英文字母或英文单词。什么是开源软件？"},
    {"id": "trap_it_02", "cat": "langfid", "lang": "it", "n_predict": 512,
     "text": "Rispondi solo in italiano. Riassumi in cinque frasi la trama del film Il Padrino (il primo film della trilogia). Non scrivere titoli in inglese."},
    {"id": "trap_fr_02", "cat": "langfid", "lang": "fr", "n_predict": 512,
     "text": "Uniquement en français. Explique ce qu'est un téléphone intelligent à un grand-parent qui n'a jamais utilisé Internet. Aucun mot anglais."},
]


def main() -> None:
    assert len(PROMPTS) == 60, len(PROMPTS)
    ids = [p["id"] for p in PROMPTS]
    assert len(ids) == len(set(ids))
    cats = {}
    for p in PROMPTS:
        cats.setdefault(p["cat"], 0)
        cats[p["cat"]] += 1
    blob = json.dumps({"n": len(PROMPTS), "prompts": PROMPTS}, ensure_ascii=False, indent=2)
    blob += "\n"
    raw = blob.encode("utf-8")
    sha = hashlib.sha256(raw).hexdigest()
    (HERE / "prompts.json").write_bytes(raw)

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    prereg = f"""# q49 — Marco B′ axis-B behavioral certification (PREREG)

**Locked {now}, BEFORE any generation.** Frozen prompt file: `prompts.json`
sha256 `{sha}` ({len(PROMPTS)} prompts, {len(raw)} bytes). Do not edit
`prompts.json` after this lock. Generations may start only after this file
exists on disk with this hash.

PC-only, CPU (`-ngl 0`). No devices. No git. #30 discipline: criteria first.

## Question

Is the last surviving B′ candidate — **Q8_0 trunk** (attn/trunk requantized from
the Q8_0 source, experts byte-identical Q2_K+Q3_K) — behaviorally equivalent to
the shipped KEXP control on instruction-following / language / degeneration?
q43 already PASS 5/5 on multilingual PPL. q37's N=1 factual suite was declared
**non-discriminating** (noise ranked Q8_0 below Q4_0 on one item) and is **not
reused**. This cell is a fresh ~60-prompt multilingual set.

## Arms

| arm | file | sha256 (full, locked) |
|---|---|---|
| control | `scratchpad/agents/q37-bprime-from-source/gguf/marco/Marco-Mini-Instruct-KEXP-fromsrc-trunk-control.gguf` | `f3e2826f78c78452afa0765613875c806f1ca3976f1f59ff4e8ff85bea5782ea` |
| q8_0 (B′) | `…/Marco-Mini-Instruct-KEXP-fromsrc-trunk-q8_0.gguf` | `bd63fc0f21a8c3aab4b7531ee30aa37f8e6320dfb65e85de74a9056e2feeb419` |

On-disk sha256 (Python hashlib) of both GGUF files must match **before the first
generation**. Mismatch = STOP.

## Prompts (frozen)

`prompts.json` sha256 `{sha}`. Counts by `cat`: {json.dumps(cats, sort_keys=True)}.

| cat | n | languages | n_predict |
|---|---:|---|---|
| factual | 25 | 5 each IT/EN/ES/FR/ZH | 512 |
| instruction | 10 | 5 EN + 5 IT | 256 |
| code | 5 | EN | 256–512 |
| reasoning | 8 | 4 IT + 4 EN | 512 |
| longform | 6 | IT | 1024 |
| langfid | 6 | IT/FR/ES/ZH traps | 512 |

**Judging categories** (same `cat` field): factual, instruction, code, reasoning,
longform, langfid. No prompt from q37 (Spa 2000, tabellina 9, gift, vocali
armadio) is reused.

## Locked generation settings

```
build-llama-pc/bin/llama-cli.exe
  -m MODEL -f prompt.txt -o out.txt
  -n <per-prompt n_predict>
  --temp 0 --seed 42
  -c 4096 -t 16 -ngl 0
  -cnv --single-turn --no-display-prompt --log-disable
  --no-warmup --reasoning off
```

CPU only. One llama-cli process at a time. UTF-8 via `--file` / `-o` (not argv).
Same sampler both arms. Seed 42 both arms.

## Machine checks (computed here, not judgment)

1. **Loop / degeneration:** a 20-gram (20 whitespace-separated tokens, or 20 CJK
   chars for zh) that occurs ≥ 3 times in the response, OR a 20-token run that
   repeats consecutively ≥ 2 extra times. Column `loop=1/0`.
2. **Language of response:** script / stopword heuristic (CJK ratio for zh;
   function-word hits for it/en/es/fr). Column `lang_ok=1` iff detected language
   matches `prompts[].lang`. Ambiguous short format-only replies (instruction
   cat, < 20 letters) are `lang_ok=1` if they satisfy the format (language N/A).
3. **Format compliance:** instruction cat only, per `format` id, regex/structure
   checks. Column `format_ok=1/0`. Non-instruction rows: empty.

## Blind pairwise judge (separate agent; this cell does not self-judge quality)

For each prompt, `pairs/<id>.md` has Prompt + Response A + Response B.
A/B assignment is randomized per prompt; the map is `key.json` (judge must not
read it). Judge marks `winner=A|B|tie|undecidable` and a one-line reason.

**Decided pair** = winner is A or B (not tie, not undecidable).
`control_pref = n_control_wins / n_decided` after `key.json` is applied.

## Gate (frozen)

Cell **FAIL** if any of:

**(i) Loops.** Any B′ (`q8_0`) row with `loop=1`. Control loops are recorded but
do not alone FAIL B′ (they do invalidate that pair for (iii)).

**(ii) Language.** Any B′ row with `lang_ok=0` (must follow the **prompt**
language 100% of the time; the LFM failure mode). Instruction rows with
format-only short replies are exempt as defined above.

**(iii) Blind preference.** After the blind judge returns:

- Overall: `control_pref > 0.60` among decided pairs → FAIL.
- Per judging category: FAIL that category (and the cell) if
  `n_decided_cat ≥ 5` AND `control_wins_cat / n_decided_cat > 2/3`
  (the 8/12-style cap: 8/12 = 0.666…; 4/5 fails, 3/5 does not; 17/25 fails).

Cell **PASS** iff (i) and (ii) hold on the machine checks **and** the blind
judge does not trigger (iii). Ties do not count in the denominator.

No ship of t/s. No quality adjectives in REPORT.md before the blind judge.

## Hygiene

Python hashlib sha256 (never Get-FileHash). One process at a time. Disk: abort
if the run cannot write `gen/`. SESSION_LOG timestamps must show freeze before
the first `llama-cli` spawn.
"""
    (HERE / "PREREG.md").write_text(prereg, encoding="utf-8")
    log = HERE / "SESSION_LOG.md"
    prev = log.read_text(encoding="utf-8")
    prev += (
        f"\n## {now} — FREEZE\n\n"
        f"- wrote `prompts.json` n={len(PROMPTS)} bytes={len(raw)} sha256=`{sha}`\n"
        f"- wrote `PREREG.md` citing that sha. Categories={json.dumps(cats, sort_keys=True)}\n"
        f"- no llama-cli has been spawned yet.\n"
    )
    log.write_text(prev, encoding="utf-8")
    print("prompts.json", sha, "n", len(PROMPTS), "bytes", len(raw))
    print("PREREG locked", now)


if __name__ == "__main__":
    main()
