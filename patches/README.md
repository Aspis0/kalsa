# Le nostre modifiche al runtime, come patch

`BigMoeOnEdge` e il suo submodule `llama.cpp` sono repo di terzi: qui non ne teniamo una
copia, solo **il nostro contributo**, estratto con `git format-patch`. Quattro file, ~21 KB.

## Le basi esatte (senza queste le patch non si applicano)

| repo | base upstream | dove |
|---|---|---|
| `BigMoeOnEdge` | **`b0c4e5b`** | `github.com/Helldez/BigMoeOnEdge` |
| `third_party/llama.cpp` | **`5236140e5`** | submodule di cui sopra |

Le patch sono cumulative e vanno applicate **in ordine**, partendo esattamente da quelle basi.
Applicarle su un upstream più recente può funzionare o no: in quel caso è un merge, non un
apply, e va rifatto il gate di non-regressione.

## Cosa fa ciascuna

### `llama.cpp/0001` — `mmap_prefetch` in `llama_model_params`

Aggiunge un campo (**default `true`**, quindi nessun cambiamento per chi non lo tocca) che
controlla il `prefetch` passato a `init_mappings`. Prima era cablato a `true` in
`llama-model.cpp:1506`, cioè `MAP_POPULATE` + `MADV_WILLNEED` **sull'intero GGUF**, e nessun
parametro pubblico lo disattivava.

### `bigmoeonedge/0002` — spegnerlo quando si streamma

`session.cpp` mette `mmap_prefetch = false` **solo se lo streaming degli esperti è attivo**.
Con `--moe-stream` gli esperti si leggono via O_DIRECT quando servono e il trunk denso viene
copiato fuori dall'mmap: il prefault dell'intero file è I/O che non verrà mai usato.

**Effetto misurato** (stesso albero, solo il flag cambia, cache pagina fredda):

| | prefault | senza | Δ |
|---|---:|---:|---:|
| `read_bytes` al load | 22.72 GiB | **12.08 GiB** | −47% |
| `load_seconds` | 18.6 s | **10.6 s** | −8.0 s |
| `VmHWM` al load | 4536 MiB | **3786 MiB** | −750 MiB |

Non chiude sotto la soglia degli 8 GiB che ci eravamo dati: restano il fault del warm-up e il
doppio passaggio del dense (mandato separato). Diagnosi completa in
`reports/research/loader-prefault-diagnosis.md`, gate in `reports/moe-loader-fix.md`.

### `bigmoeonedge/0001` — `--ppl-file`, perplessità teacher-forced

Aggiunge la modalità che calcola la log-probabilità che il modello assegna al token **vero**
di un testo dato, e la scrive per posizione (`pos,token_id,logprob`). È il metro di qualità
della campagna: senza, nessuna leva lossy è ordinabile. Baseline: `PPL 2.779` su 68 175 token
italiani.

### `bigmoeonedge/0003` — bump del submodule

Sposta il puntatore al branch `kalsa/mmap-prefetch-opt`. **Se ricostruisci da zero questo
commit non serve**: applica prima la patch di `llama.cpp`, poi punta il submodule al commit che
ne risulta.

## Riapplicare da zero

```bash
git clone https://github.com/Helldez/BigMoeOnEdge && cd BigMoeOnEdge
git checkout b0c4e5b
git submodule update --init --recursive

# 1) il submodule
cd third_party/llama.cpp
git checkout -b kalsa/mmap-prefetch-opt 5236140e5
git am ../../../patches/llama.cpp/0001-*.patch
cd ../..

# 2) il fork (salta la 0003: il puntatore lo aggiorni tu)
git am patches/bigmoeonedge/0001-*.patch patches/bigmoeonedge/0002-*.patch
git add third_party/llama.cpp && git commit -m "submodule: bump"
```

## Il gate, prima di fidarsi del binario

Qualunque ricostruzione deve **ri-superare la non-regressione 8/8 byte-identici** contro
`results/f5.5/b/*-k8.gen.txt`: stessi prompt (`prompts/`), `temp 0`, config del gate.

A `temp 0` su questo stack gli output sono **bit-identici** — dimostrato in F5.4-D1 confrontando
`--ubatch 512` e `2048` — quindi **una sola differenza è un difetto, non rumore**.
