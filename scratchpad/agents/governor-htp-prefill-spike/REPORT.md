# Spike: prefill HTP0 nel governor LFM2.5-2.6B

Data: 2026-09-27. Engine base `f25f0c1c5594963c23f0d6f943ddacd8fd052418`; commit spike `4997b298d3032f95b83c102691b39a968e6df5c9`.

## Modifica minima

Non serve plumbing NPU nel policy per costruire questa coppia di contesti. `llama_model_params.devices` accetta una lista terminata da NULL (`include/llama.h:314-315`); il governor riceve già due modelli indipendenti (`src/llama-ext.h:412-416`) e costruisce `ctx_prefill` e `ctx_decode` dai rispettivi modelli (`src/llama-governor.cpp:38-53`). Il test ora seleziona il modello prefill con `KALSA_PREFILL_DEVICE=HTP0` o `GPUOpenCL` e carica sempre il modello decode su CPU (`tests/test-governor-v0-hybrid.cpp:34-46, 412-417`). L’attenzione/KV del prefill resta host con `offload_kqv=false` (`:49-58`). `npu_lane_enabled` rimane `false` (`src/llama-ext.h:252`): il test chiama `llama_governor_init` direttamente, senza cambiare policy o app.

## Costruzione e handoff

Il governor si è costruito sia con HTP0-prefill/CPU-decode sia con OpenCL-prefill/CPU-decode. Le route hybrid sono `MirrorAndCopy`, il test staged passa, `trim_ok=1`; su due turni risultano 3 commit e `1,392,640/1,392,640` byte attesi. Il rewind aggiunge `557,056` byte. Decode riporta 0/31 layer offloadati.

Il vincolo logit richiesto resta `max_abs_diff <= 1e-3`. **Non passa sul telefono** contro il riferimento CPU fresco:

| Prefill | max_abs_diff CPU | top-1 greedy nei 2 turni | top-1 rewind | max diff riferimento fresco stesso device |
|---|---:|---:|---:|---:|
| HTP0 | `5.133e-1` | `8/8` | `1/1` | `4.616e-1`, top-1 `1/1` |
| OpenCL | `3.329e-1` | `8/8` | `1/1` | `7.890e-2`, top-1 `1/1` |

Le due esecuzioni terminano con **EXIT=1** per `CPU ORACLE MISMATCH`; la tolleranza non è stata allentata. I conteggi di commit e il top-1 concorde non dimostrano equivalenza numerica né identificano da soli l’origine dello scarto. La stessa-device reference differisce anch’essa: il test non consente di attribuire tutto lo scarto alla sola precisione HTP. Quindi la copia KV/stato attraversa la route e trasferisce i byte attesi, ma l’equivalenza del risultato dopo i passaggi CPU↔acceleratore **resta non dimostrata**.

Log finali: `raw/htp_verified.log:645-651`, `raw/opencl_verified.log:752-758`. Le prime prove col binario precedente riportano lo stesso scarto con la vecchia dicitura `WRONG STATE` (`raw/htp.log`, `raw/opencl.log`); la prova HTP intermedia con SHA vecchio è conservata come `raw/htp_pre_same_device.log`. Il binario finale verificato per SHA è `4ede9c04e6f01d71a78f5ae17713a8f24c485af60703cd7ba3904d2efd8f2a4a` su host e telefono.

## Tempi diagnostici e memoria

Prompt del test: 8 token al turno 1 e 7 al turno 2; il tempo copre la chiamata governor del prefill, inclusa l’eventuale transizione/commit, non solo il kernel. Non è confrontabile con la misura da 1010 token.

| Device prefill | Turno 1 | Turno 2 | RSS massimo campionato |
|---|---:|---:|---:|
| HTP0 | 602.042 ms | 217.965 ms | 2,589,452 kB (2.47 GiB) |
| OpenCL | 1,634.025 ms | 1,467.343 ms | 2,567,648 kB (2.45 GiB) |

Buffer modello dai log Android:

- HTP prefill: CPU 205.08 MiB + HTP0 1,525.87 MiB.
- OpenCL prefill: CPU 205.08 MiB + CPU_REPACK 205.08 MiB + OpenCL 1,307.20 MiB.
- Decode CPU: CPU_Mapped 1,503.20 MiB + CPU_REPACK 1,511.20 MiB.

L’RSS è il picco residente campionato ogni 200 ms, distinto dai buffer allocati/mappati. Il test carica il modello CPU con il repack predefinito; non rappresenta la configurazione no-repack del binding.

Il log HTP conferma Arch v73, sessione CDSP e placement 31/31 layer, con buffer HTP0 non nullo (`raw/htp_verified.log:9, 131-133`). Non contiene però righe `HTP0 execute-op`: il test stampa INFO e non fornisce una prova per-op del dispatch. Questa prova del governor non stabilisce quindi il dispatch HTP a livello di singola operazione.

## Build, device e verifiche

- Host build mirato e test CPU: `EXIT=0`, `RUN_EXIT=0`; rewind `max_abs_diff=0`, top-1 `8/8` e `1/1` (`raw/host_build.log`, `raw/host_run.log`).
- Android Snapdragon toolchain v0.7, target `test-governor-v0-hybrid`: `DOCKER_EXIT=0`, `BUILD_EXIT=0` (`raw/build_android_final2.log`).
- SHA GGUF locale e `/data/local/tmp/heat3way/ship.gguf`: `a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03` (`raw/model_sha256.txt`). Binario e librerie del kit v73 trasferiti sotto `/data/local/tmp/govhtp/`; SHA binario host/device coincidono.
- Entrambe le prove finali sono state scollegate dall’alimentazione: lo S23 è passato ad `AC powered: false`, batteria 100%. Timing solo diagnostico. Preflight: thermal status 0, batteria 27.5–28.4 °C, `persist.traced.enable=0`, app `com.kalsa.app` force-stopped. Nessun gate di stop raggiunto.
- Schermo/timeout ripristinati allo stato precedente (Dozing, timeout non impostato, stay-on 0); app lasciata ferma e tracing 0 (`raw/device_restore.log`, `raw/final_device_state.log`). Jelly non toccato.

Comandi/esiti completi e ogni log d’errore sono in `raw/`. Un primo host build fallì per due riferimenti residui a `model` (`host_first_build_failure.log`); il primo host run differì per parametri di contesto non uniformi (`host_first_run_failure.log`); entrambi furono corretti prima del run host finale. Il primo wrapper Docker Android rimase senza exit dopo il link; il rebuild conclusivo ha restituito exit 0. Un errore di redirezione nel wrapper che annotava il pull OpenCL è registrato in `opencl_verified_pull_driver_note.txt`; il pull stesso è riuscito.
