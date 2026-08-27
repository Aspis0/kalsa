---
name: measurement-ceiling-method
description: "Come si calcola il tetto di un offload (NPU/GPU) senza farsi refutare: wall/max(I/O floor, compute/k) in wall-secondi, mai Amdahl 1/(1-share); floor self-consistent = tautologia; per-processo vs per-prompt"
metadata:
  type: feedback
---

Tre audit DeepSeek in due giorni (q60, q60b, q61) hanno demolito tre mie regole di prereg:
1. **Mai `1/(1−quota_calcolo)`**: I/O e calcolo si sovrappongono (readahead) → il tetto è
   `wall / max(I/O_floor, compute/k)`.
2. **Unità**: compute in WALL-secondi (utime+stime diviso i thread), mai CPU-secondi sommati
   sui thread → tetti <1 sono un artefatto, non un risultato.
3. **Floor "self-consistent" = tautologia** se MB/s è derivato dallo stesso read/wall (floor ≡
   wall). Convenzioni informative: banda migliore osservata nel cell, o io_gate del device.
4. **Etichette**: ΔT/wall di llama-bench sono per-PROCESSO (includono load/tiling); il dato
   per-prompt va deconfuso dai timestamp stderr. "Warm" su file > RAM = quasi nulla in cache.
5. **Regime**: un modello < MemTotal NON è streaming (borderline): si registra, non si decide.
6. Il pattern conta più del flash: mmap page-fault 0.2-0.4 GB/s vs prefetch 1.8 GB/s sullo
   stesso file/UFS 4.0.

**How to apply**: nelle prereg scrivere il mapping corretto e le convenzioni PRIMA di misurare;
far ricalcolare le tabelle a Reviewer Math (DeepSeek) sempre; non emettere "settling statement"
da bracci non licenziati dalla prereg.
