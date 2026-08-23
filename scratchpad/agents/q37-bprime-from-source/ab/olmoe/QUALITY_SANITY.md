# OLMoE from-source sanity (llama-cli; bmoe-cli has no `olmoe` recipe)

Texts: `ab/olmoe/sanity/ANSWERS_CLI.md`. Binary: `build-llama-pc/bin/llama-cli.exe`.

**Floor effect.** Control itself fails the suite. OLMoE-1B-7B KEXP is not a quality discriminator for this battery. Trunk type still *moves* the text (0/12 identical).

| prompt | control | Q8_0 | IQ4_NL | Q4_0 |
|---|---|---|---|---|
| q1 Spa 2000 | Schumacher (wrong); "britannico", "Spagna" | word salad (Schumacher then Serena Williams / tennis) | Schumacher (wrong), shorter | **Nico Rosberg** (wrong) |
| q2 tabellina | lists 9…90 then invents a formula | does not know what a tabellina is | "gioco di azioni" / financial advisor | table of "avvocatessa" questions |
| q3 regalo | weakly discourages | No, then loops the same paragraph | confused bowls; not a clear No | **"Certo, non esitare!"** — FAIL |
| q4 vocali | 1 vowel / "r is a vowel" | 7 vowels | **loop** "7 parole, nessuna vocale" ×10 | 7 "parole", no vowels |

Conservative: **do not pick a B′ default from OLMoE quality.** Size + NPU still count (verify `all_ok True`, trunk share 12.2 %).
