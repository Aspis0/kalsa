# q37 from-source A/B — olmoe / long

temp 0, session JSON, k=8 drop=0.0 chatml=True no_think=True.
GGUF is the only variable. Control is KEXP-from-source, not the shipped file.

| tag | file |
|---|---|
| `control` | `OLMoE-1B-7B-0924-Instruct-KEXP-fromsrc-trunk-control.gguf` |
| `q8_0` | `OLMoE-1B-7B-0924-Instruct-KEXP-fromsrc-trunk-q8_0.gguf` |
| `iq4_nl` | `OLMoE-1B-7B-0924-Instruct-KEXP-fromsrc-trunk-iq4_nl.gguf` |
| `q4_0` | `OLMoE-1B-7B-0924-Instruct-KEXP-fromsrc-trunk-q4_0.gguf` |

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
(mancante)
```

### q8_0

```
(mancante)
```

### iq4_nl

```
(mancante)
```

### q4_0

```
(mancante)
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
(mancante)
```

### q8_0

```
(mancante)
```

### iq4_nl

```
(mancante)
```

### q4_0

```
(mancante)
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
(mancante)
```

### q8_0

```
(mancante)
```

### iq4_nl

```
(mancante)
```

### q4_0

```
(mancante)
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
(mancante)
```

### q8_0

```
(mancante)
```

### iq4_nl

```
(mancante)
```

### q4_0

```
(mancante)
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
(mancante)
```

### q8_0

```
(mancante)
```

### iq4_nl

```
(mancante)
```

### q4_0

```
(mancante)
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
(mancante)
```

### q8_0

```
(mancante)
```

### iq4_nl

```
(mancante)
```

### q4_0

```
(mancante)
```

