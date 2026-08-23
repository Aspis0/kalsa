# q37 from-source A/B — lfm / long

temp 0, session JSON, k=4 drop=0.0 chatml=True no_think=True.
GGUF is the only variable. Control is KEXP-from-source, not the shipped file.

| tag | file |
|---|---|
| `control` | `LFM2.5-8B-A1B-KEXP-fromsrc-trunk-control.gguf` |
| `q8_0` | `LFM2.5-8B-A1B-KEXP-fromsrc-trunk-q8_0.gguf` |
| `iq4_nl` | `LFM2.5-8B-A1B-KEXP-fromsrc-trunk-iq4_nl.gguf` |
| `q4_0` | `LFM2.5-8B-A1B-KEXP-fromsrc-trunk-q4_0.gguf` |

Texts from this run.

---

## f45_1_esplicativo

<details><summary>prompt</summary>

```
Sei un assistente tecnico per sviluppatori italiani. Rispondi in italiano, in modo chiaro e concreto.

Domanda: cos'è un modello Mixture-of-Experts (MoE) e perché, su uno smartphone con 8 GB di RAM, un MoE da 35B parametri con circa 3B attivi per token può essere più pratico di un modello denso da 7B? Spiega memoria, routing degli esperti e il ruolo dello streaming da flash. Non superare le 180 parole.
```

</details>

### control

```
(vuoto)
```

### q8_0 **IDENTICAL to control**

```
(vuoto)
```

### iq4_nl **IDENTICAL to control**

```
(vuoto)
```

### q4_0 **IDENTICAL to control**

```
(vuoto)
```


---

## f45_3_istruzioni

<details><summary>prompt</summary>

```
Segui le istruzioni alla lettera. Rispondi in italiano.

Istruzioni:
1) Scrivi esattamente tre frasi complete sul tema "perché misurare le prestazioni a batteria scarica è diverso dal misurarle a batteria piena".
2) Dopo le tre frasi, scrivi esattamente due domande utili per un protocollo di misura su telefono.
3) Non aggiungere titoli, elenchi, prefazioni o conclusioni oltre a quanto richiesto.
4) Non scrivere in inglese.
```

</details>

### control

```
(vuoto)
```

### q8_0 **IDENTICAL to control**

```
(vuoto)
```

### iq4_nl **IDENTICAL to control**

```
(vuoto)
```

### q4_0 **IDENTICAL to control**

```
(vuoto)
```


---

## f45_4_codice

<details><summary>prompt</summary>

```
You are a careful coding assistant. Prefer small, correct programs over clever ones.

Task:
Write a single-file Python 3 function (no classes) named `median_eval_tok_s(rows)` that takes a list of dicts, each with keys "eval_tok_s" (float or None) and "nproc" (int or None), and returns the median of eval_tok_s for rows where nproc is not None and nproc >= 6. Ignore rows with missing eval_tok_s. If fewer than 1 valid value remains, return None. Include a 4-line usage example under `if __name__ == "__main__":`. No markdown fences.
```

</details>

### control

```
(vuoto)
```

### q8_0 **IDENTICAL to control**

```
(vuoto)
```

### iq4_nl **IDENTICAL to control**

```
(vuoto)
```

### q4_0 **IDENTICAL to control**

```
(vuoto)
```


---

## f45_5_ragionamento

<details><summary>prompt</summary>

```
Ragiona passo per passo in italiano, in modo breve e ordinato.

Problema: su un telefono, un benchmark MoE ha dato 5.0 tok/s con 8 core disponibili e 1.2 tok/s in un run successivo. La temperatura batteria era simile (circa 30°C). Quale spiegazione è più plausibile tra: (A) throttle termico della CPU, (B) il processo è finito in un cpuset con solo 3 core little, (C) la quantizzazione del modello è cambiata? Scegli una sola opzione, motiva in al massimo 5 frasi, e indica un controllo concreto da fare (quale file o comando leggere) per verificarla.
```

</details>

### control

```
(vuoto)
```

### q8_0 **IDENTICAL to control**

```
(vuoto)
```

### iq4_nl **IDENTICAL to control**

```
(vuoto)
```

### q4_0 **IDENTICAL to control**

```
(vuoto)
```


---

## f45_2_scrittura

<details><summary>prompt</summary>

```
Sei un copywriter tecnico. Scrivi in italiano, tono professionale ma diretto.

Compito: scrivi un messaggio breve (massimo 120 parole) per un collega che deve testare un'app di chat on-device su Samsung S23. Spiega che useremo un modello MoE quantizzato a circa 2.4 bit per peso, che la velocità attesa è intorno a 5 token al secondo, e che lo schermo deve restare acceso per mantenere il processo in foreground. Chiudi con una riga su cosa annotare (temperatura, batteria, tok/s).
```

</details>

### control

```
(vuoto)
```

### q8_0 **IDENTICAL to control**

```
(vuoto)
```

### iq4_nl **IDENTICAL to control**

```
(vuoto)
```

### q4_0 **IDENTICAL to control**

```
(vuoto)
```


---

## long_conversational_it

<details><summary>prompt</summary>

```
Sei un narratore. Scrivi in italiano un racconto continuo e dettagliato, senza elenchi puntati e senza interrompere la prosa. Ambientazione: un treno notturno da Milano a Napoli. Descrivi i passeggeri, i paesaggi che scorrono oltre il finestrino, i pensieri del protagonista che torna a casa dopo anni, i rumori del vagone, le stazioni intermedie, un incontro casuale in corridoio, e come la memoria si intreccia al presente. Continua a scrivere finché non ti fermo: una storia fluida, paragrafi lunghi, niente titoli.
```

</details>

### control

```

Il rumore delle rotaie si mescola al sussurro delle finestre che si aprono e si chiudono, un suono costante che accompagna il viaggio notturno da Milano fino al primo lampo di candela che illumina il corridoio della carrozza. Le luci della città scorrono rapidamente fuori, un filo di neon che si tinge di blu e verde, mentre fuori dal finestrino il paesaggio cambia forma: i colli della Lombardia si
```

### q8_0 **DIFFERS from control**

```

Il rumore costante delle ruote sull’acciaia e il sussurro delle luci amber che filtrano dalle finestre del vagone creano un’atmosfera di quiete artificiale, quasi un lamento dolce che accompagna il viaggio notturno da Milano a Napoli; mentre il treno filtra attraverso il paesaggio che scorre oltre il finestrino, le colline della Lombardia si dissolvono in una nebbia grigio-azzurra, intermezza di montagne pallescie e campi avvolti in un velluto di fosforescenza, e poi, a tratti, il profumo di
```

### iq4_nl **DIFFERS from control**

```
(vuoto)
```

### q4_0 **DIFFERS from control**

```
(vuoto)
```

