# Risultati verificati — snapshot 14/09/2026

Verifica eseguita il 14/09/2026. Per ogni repo in tabella è stata eseguita la chiamata `curl -s https://huggingface.co/api/models/<org>/<repo>`. I byte dei file sono quelli restituiti dall’API dell’albero HF; conversione: `GiB = byte / 1.073.741.824`. Soglia usata: `4,5 GiB = 4.831.838.208 byte`.

| Modello / repo HF base | `lastModified` e licenza base da API | Repo GGUF verificato e file esatto | Architettura | Parametri totali | Parametri attivi/token | mmproj | tok/s CPU pubblici | Fine-tune commerciale / giudizio |
|---|---|---|---|---:|---:|---|---|---|
| [LiquidAI/LFM2.5-8B-A1B](https://huggingface.co/LiquidAI/LFM2.5-8B-A1B) | `"2026-08-24T21:05:21.000Z"`; `cardData.license="other"`; `license_name="lfm1.0"` | [liodon-ai/LFM2.5-8B-A1B-imatrix-GGUF](https://huggingface.co/liodon-ai/LFM2.5-8B-A1B-imatrix-GGUF): `LFM2.5-8B-A1B-IQ4_XS.gguf`, **4.588.301.888 B / 4,273 GiB**. La API del repo GGUF riporta `lastModified="2026-07-13T04:54:10.000Z"`; `cardData.license="other"`; `license_name` assente. Repo ufficiale [LiquidAI/LFM2.5-8B-A1B-GGUF](https://huggingface.co/LiquidAI/LFM2.5-8B-A1B-GGUF): Q4_0 **4,844,678,368 B / 4,512 GiB**; Q4_K_M **5,155,564,768 B / 4,801 GiB**. | MoE, 32 esperti, 4 attivi/token; architettura ibrida: convoluzioni gated + GQA | 8,3B | 1,5B | No | **253 tok/s** Apple M5 Max; **146 tok/s** Ryzen AI Max+ 395, misura Liquid; quant/runtime non specificati. [Fonte](https://www.liquid.ai/blog/lfm2-5-8b-a1b) | LFM 1.0 consente uso commerciale solo a entità con ricavi annui inferiori a **10 M$**; sopra la soglia l’uso commerciale non è coperto. È il candidato qualitativamente più interessante; per stare sotto soglia serve IQ4_XS, non il Q4_K_M ufficiale. |
| [arcee-ai/Trinity-Nano-Preview](https://huggingface.co/arcee-ai/Trinity-Nano-Preview) | `"2026-05-28T22:45:39.000Z"`; `cardData.license="other"`; `license_name="openmdw-1.1"` | [arcee-ai/Trinity-Nano-Preview-GGUF](https://huggingface.co/arcee-ai/Trinity-Nano-Preview-GGUF): `Trinity-Nano-Preview-Q4_K_M.gguf`, **3.786.957.088 B / 3,527 GiB**; anche Q5_K_M: **4.405.510.432 B / 4,103 GiB**. La API del repo GGUF riporta `lastModified="2026-05-28T22:45:39.000Z"`; `cardData.license="other"`; `license_name="openmdw-1.1"`. | MoE, 128 esperti, 8 attivi + 1 shared; [architettura e dimensioni](https://www.arcee.ai/trinity) | 6B | 1B | No | Nessuna misura CPU trovata | OpenMDW-1.1 consente uso commerciale e modifica, ma richiede di conservare licenza/notice e contiene la terminazione dei diritti in caso di causa per brevetto; non è Apache/MIT. Molto adatto al vincolo. |
| [microsoft/Phi-mini-MoE-instruct](https://huggingface.co/microsoft/Phi-mini-MoE-instruct) | `"2025-12-10T18:20:28.000Z"`; `cardData.license="mit"` | [smarttasks/Phi-mini-MoE-instruct-GGUF](https://huggingface.co/smarttasks/Phi-mini-MoE-instruct-GGUF): `Phi-mini-MoE-instruct-Q4_K_S.gguf`, **4.616.170.016 B / 4,299 GiB**. La API del repo GGUF riporta `lastModified="2026-07-12T10:17:36.000Z"`; `cardData.license="mit"`. Q4_K_M: **4.993.133.088 B / 4,650 GiB**, oltre soglia. | MoE, 16 esperti, 2 attivi/token | 7,6B | 2,4B | No | Nessuna misura CPU trovata. Esiste una misura NPU: 5–7 tok/s su Snapdragon 8 Elite, ma non è CPU. [Fonte](https://github.com/RunanywhereAI/runanywhere-sdks/blob/main/README.md) | MIT: il fine-tune e l’uso commerciale del base model sono permessi, con i normali obblighi MIT e attenzione alle dipendenze/dati di terzi. Forte candidato commerciale; probabilmente più capace del modello telefonico, ma manca un confronto diretto con quel modello. |
| [ibm-granite/granite-4.0-h-tiny](https://huggingface.co/ibm-granite/granite-4.0-h-tiny) | `"2025-11-03T19:42:57.000Z"`; `cardData.license="apache-2.0"` | [ibm-granite/granite-4.0-h-tiny-GGUF](https://huggingface.co/ibm-granite/granite-4.0-h-tiny-GGUF): `granite-4.0-h-tiny-Q4_K_M.gguf`, **4.230.976.352 B / 3,940 GiB**; Q4_0: **3.962.938.208 B / 3,691 GiB**; Q3_K_M: **3.353.039.456 B / 3,123 GiB**. La API del repo GGUF riporta `lastModified="2026-04-23T19:43:01.000Z"`; `cardData.license="apache-2.0"`. | MoE ibrido Mamba2 + GQA + MoE, 64 esperti, 6 attivi/token | 7B | 1B | No | **≈15 tok/s** Ryzen 7950X3D, CPU-only, ma test locale BF16 e non Q4. [Fonte](https://dubesor.de/first-impressions) | Apache-2.0: fine-tune e uso commerciale del base model sono permessi. La versione base è vecchia di oltre sei mesi, ma il GGUF è stato aggiornato ad aprile 2026. Un test indipendente giudica però la qualità molto debole rispetto alla dimensione; non è un upgrade sicuro del modello da 2,83 GB. |
| [microsoft/Phi-tiny-MoE-instruct](https://huggingface.co/microsoft/Phi-tiny-MoE-instruct) | `"2025-12-10T18:21:11.000Z"`; `cardData.license="mit"` | [tripathyShaswata/Phi-tiny-MoE-instruct-GGUF](https://huggingface.co/tripathyShaswata/Phi-tiny-MoE-instruct-GGUF): `Phi-tiny-MoE-instruct-Q8_0.gguf`, **3.999.171.104 B / 3,725 GiB**. La API del repo GGUF riporta `lastModified="2026-04-10T16:20:05.000Z"`; `cardData.license="mit"`. | MoE, 16 esperti, 2 attivi/token | 3,8B | 1,1B | No | Nessuna misura CPU trovata. Il repo quantizzato dichiara circa **6 GB RAM** necessari; misura NPU separata: 5–7 tok/s. | MIT: fine-tune e uso commerciale del base model sono permessi, con normali obblighi MIT e attenzione a dipendenze/dati di terzi. Il file entra, ma la RAM dichiarata lo rende marginale su 8 GB totali; benchmark ufficiale MMLU 60,83, quindi non è chiaramente superiore a un buon dense da 2,83 GB. |
| [allenai/OLMoE-1B-7B-0125-Instruct](https://huggingface.co/allenai/OLMoE-1B-7B-0125-Instruct) | `"2025-02-04T16:47:15.000Z"`; `cardData.license="apache-2.0"` | [mradermacher/OLMoE-1B-7B-0125-Instruct-GGUF](https://huggingface.co/mradermacher/OLMoE-1B-7B-0125-Instruct-GGUF): `OLMoE-1B-7B-0125-Instruct.Q4_K_M.gguf`, **4.213.513.472 B / 3,924 GiB**. La API del repo GGUF riporta `lastModified="2025-02-19T22:03:01.000Z"`; `cardData.license="apache-2.0"`. | MoE, 64 esperti, 8 attivi/token | circa 7B | circa 1,3B | No | Nessuna misura CPU trovata | Il JSON è Apache-2.0, ma la model card dichiara intento research/educational e cita termini aggiuntivi Gemma per dati con output di terzi; quindi il fine-tune commerciale del checkpoint Instruct non è pulito senza revisione legale. Storico, non raccomandato. |
| [nc-ai-consortium/VAETKI-VL-7B-A1B](https://huggingface.co/nc-ai-consortium/VAETKI-VL-7B-A1B) | `"2026-08-30T11:06:04.000Z"`; `cardData.license="mit"` | [dororodoroddo/VAETKI-VL-7B-A1B-GGUF](https://huggingface.co/dororodoroddo/VAETKI-VL-7B-A1B-GGUF): `VAETKI-VL-7B-A1B-Q4_K_M.gguf`, **4.822.789.888 B / 4,492 GiB**. La API del repo GGUF riporta `lastModified="2026-01-15T02:29:06.000Z"`; `cardData.license="mit"`. | VLM MoE, 64 esperti, 5 attivi/token; LLM 7,25B totali / 1,2B attivi + ViT 0,33B | 7,58B complessivi | 1,2B LLM | `VAETKI-VL-7B-A1B-mmproj-f16.gguf`: **652.661.856 B / 0,608 GiB**; con la visione circa 5,10 GiB | Nessuna misura CPU trovata | MIT: fine-tune e uso commerciale del base model sono permessi, con obbligo di considerare il file NOTICE e i componenti/dati di terzi. Il file LLM entra appena, ma con mmproj non è pratico su 8 GB; supporto upstream llama.cpp indicato come pending e richiede fork. |
| [LiquidAI/LFM2-8B-A1B](https://huggingface.co/LiquidAI/LFM2-8B-A1B) | `"2026-08-05T17:01:09.000Z"`; `cardData.license="other"`; `license_name="lfm1.0"` | [LiquidAI/LFM2-8B-A1B-GGUF](https://huggingface.co/LiquidAI/LFM2-8B-A1B-GGUF): `LFM2-8B-A1B-Q4_0.gguf`, **4.733.893.312 B / 4,409 GiB**. La API del repo GGUF riporta `lastModified="2026-06-29T13:16:03.000Z"`; `cardData.license="other"`; `license_name="lfm1.0"`. Q4_K_M: **5.044.779.712 B / 4,698 GiB**, oltre soglia. | MoE, 32 esperti, 4 attivi/token; convoluzioni gated + GQA | 8,3B | 1,5B | No | **48,6 tok/s decode** su CPU Snapdragon 8 Elite/Galaxy S25, Q4_0 llama.cpp; fonte indipendente sponsorizzata. [Fonte](https://www.snackonai.com/p/new-post) | LFM 1.0 consente fine-tune/uso commerciale solo a entità con ricavi annui inferiori a 10 M$; sopra la soglia non è coperto. Vecchio e ufficialmente sostituito da LFM2.5; utile solo come fallback perché il Q4_0 ufficiale entra appena. |

I modelli LFM2.5 e LFM2 sono text-only e non richiedono mmproj. Anche Trinity, Phi, Granite e OLMoE sono text-only. Per VAETKI il file mmproj è necessario solo per la visione.

## Qualità rispetto al modello telefonico da 2,83 GB

Non è possibile dichiarare un upgrade certo senza sapere quale sia il modello di riferimento e senza un A/B sullo stesso set di prompt.

- **LFM2.5**: il candidato più convincente; Liquid pubblica 91,84 IFEval e 88,76 MATH500, con confronto diretto contro Granite H-Tiny, Qwen e MoE più grandi. [Fonte](https://www.liquid.ai/blog/lfm2-5-8b-a1b)
- **Phi-mini**: candidato forte; benchmark ufficiale MMLU 70,68 e GSM8K 84,89.
- **Trinity Nano**: footprint eccellente, ma non ho trovato benchmark pubblici direttamente comparabili.
- **Granite H-Tiny**: licenza ottima e file adatto, ma qualità indipendente giudicata debole.
- **Phi-tiny**: file piccolo, ma MMLU 60,83 e RAM dichiarata circa 6 GB; non è chiaramente meglio del riferimento.
- **OLMoE**: troppo vecchio e benchmark inferiori; non è chiaramente meglio.
- **VAETKI**: interessante per la visione, ma non confrontabile e non pratico con mmproj su 8 GB.

Il file sotto 4,5 GiB non garantisce da solo l’esecuzione su una macchina con 8 GB totali: servono memoria per runtime, KV cache, allocatori e contesto. In particolare VAETKI con mmproj e Phi-tiny Q8 sono marginali.

## Risposta secca

**Sì.**

Con licenza commerciale senza restrizioni speciali evidenti:

- **Microsoft Phi-mini-MoE-instruct**, MIT, Q4_K_S: **4,299 GiB**.
- **IBM Granite 4.0 H-Tiny**, Apache-2.0, Q4_K_M: **3,940 GiB**.
- **Microsoft Phi-tiny-MoE-instruct**, MIT, Q8_0: **3,725 GiB**, ma circa 6 GB RAM dichiarati lo rendono marginale con 8 GB totali.

Con licenze commerciali permissive ma non Apache/MIT:

- **Arcee Trinity Nano**, OpenMDW-1.1, Q4_K_M: **3,527 GiB**.
- **Liquid LFM2.5-8B-A1B**, LFM 1.0, IQ4_XS: **4,273 GiB**, soggetto alla soglia dei 10 M$ di ricavi annui.

VAETKI-VL è MIT e il solo file LLM è appena sotto soglia, ma il mmproj porta il totale a circa 5,10 GiB: non è una scelta pratica per questo PC.

Il miglior compromesso tecnico sembra **LFM2.5 IQ4_XS**; il miglior compromesso licenza/file è **Trinity Nano**. La conclusione precedente secondo cui la fascia 8 GB non esiste è quindi falsa.

## Scartati / non verificabili

- **Qwen1.5-MoE-A2.7B**: 14B totali; Q4_K_M circa 8,8 GB.
- **Qwen3-30B-A3B**: 30,5B totali; troppo grande.
- **Ling/Bailing Ling-mini 2.0**: 16B; Q4_K_M circa 9,9 GB.
- **DeepSeek V2 Lite**: 16B; troppo grande.
- **Motif-3**: 314B totali / 13,2B attivi.
- **Phi-3.5-MoE**: 42B totali / 6,6B attivi.
- **Arcee Trinity Mini**: 26B / 3B attivi.
- **Granite 3.0 3B-A800M**: entra facilmente, ma è vecchio, solo 3,3B totali e Q4_K_M circa 1,92 GiB; non è chiaramente meglio del modello da 2,83 GB.
- **OLMoE-1B-7B-0924**: Apache e piccolo, ma del 2024; sostituito da OLMoE 0125.
- **DAARTH-7B-A1B**: architettura adeguata e Apache-2.0, ma nessun repo GGUF verificato.
- **VAETKI-7B-A1B testuale**: repo base esistente, ma nessun GGUF testuale esatto verificato; trovato solo il VLM con mmproj.
- **SmolLM** e **Gemma 4 E2B**: non sono MoE equivalenti per questo caso.
- `QuantFactory/OLMoE-1B-7B-0125-Instruct-GGUF` e `bartowski/OLMoE-1B-7B-0125-Instruct-GGUF`: API HF fallita/404; scartati. È stato usato `mradermacher/OLMoE-1B-7B-0125-Instruct-GGUF`.
- **MiniCPM**: non è stato trovato un MoE qualificante con repo GGUF verificato.

La scansione HF con ricerca `moe`, `pipeline_tag=text-generation`, ordinata per `lastModified`, è rumorosa e include molte fine-tune personali; dopo il controllo di `config.json`, model card, API e file GGUF, i candidati sopra sono quelli verificabili nella fascia richiesta.
