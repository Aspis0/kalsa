# q37 from-source A/B — marco / long

temp 0, session JSON, k=6 drop=0.0 chatml=True no_think=True.
GGUF is the only variable. Control is KEXP-from-source, not the shipped file.

| tag | file |
|---|---|
| `control` | `Marco-Mini-Instruct-KEXP-fromsrc-trunk-control.gguf` |
| `q8_0` | `Marco-Mini-Instruct-KEXP-fromsrc-trunk-q8_0.gguf` |
| `iq4_nl` | `Marco-Mini-Instruct-KEXP-fromsrc-trunk-iq4_nl.gguf` |
| `q4_0` | `Marco-Mini-Instruct-KEXP-fromsrc-trunk-q4_0.gguf` |

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
Un modello Mixture-of-Experts (MoE) è un architettura che, invece di avere un singolo blocco di pesi per ogni token, ha molti "esperti" (sottounità) che vengono attivati in modo dinamico. Solo una parte dei parametri (es. 3B su 35B) è attiva per ogni token, rendendo il modello molto più efficiente in memoria e calcolo. Su uno smartphone da 8 GB RAM, un modello denso da 7B richiede 7B parametri attivi, ma un MoE da 35B con solo 3B attivi per token può essere più leggero e veloce, perché la maggior parte dei parametri rimane inattiva. Il routing degli esperti (da un "gate" o "router") seleziona le parti più rilevanti per ogni input, ottimizzando l’uso della memoria. Inoltre, lo streaming da flash permette di caricare solo i parametri necessari per il token corrente, riducendo l’uso di RAM e permettendo di gestire modelli enormi con risorse limitate. Questo rende il MoE più pratico su dispositivi mobili, dove la memoria è costosa e la latenza deve essere bassa.
```

### q8_0 **DIFFERS from control**

```
Un modello Mixture-of-Experts (MoE) è un architettura che, invece di avere tutti i parametri attivi per ogni token, attiva solo un sottoinsieme di “esperti” (circa 3B su 35B) per ogni input. Questo rende il modello molto più efficiente: solo una frazione dei parametri è usata per ogni token, riducendo la memoria e il calcolo.  

Su uno smartphone con 8 GB di RAM, un modello denso da 7B richiede circa 7 GB di memoria — lasciando poco spazio per altri processi. Un MoE da 35B, con solo 3B attivi per token, usa circa 3 GB per ogni richiesta, lasciando 5 GB per il resto del sistema.  

Il routing degli esperti è un meccanismo che seleziona quali esperti (sottocorrenti del modello) devono essere attivati, basandosi su un “routing” leggero. Questo permette di scalare la potenza senza aumentare la memoria.  

Inoltre, lo streaming da flash (o da memoria persistente) è cruciale: i parametri non vengono caricati tutti in RAM, ma vengono caricati su richiesta, e solo gli esperti attivi vengono caricati in memoria. Questo permette di gestire modelli enormi con risorse limitate, rendendo il MoE più pratico anche su dispositivi con 8 GB di RAM.
```

### iq4_nl **DIFFERS from control**

```
Un modello Mixture-of-Experts (MoE) è composto da molti "esperti" (sottoreti) che gestiscono parti diverse del linguaggio. Solo alcuni esperti sono attivi per ogni token, riducendo il numero di parametri attivi (es. 3B su 35B totali). Questo rende il modello molto più efficiente in memoria e calcolo, specialmente su dispositivi con pochi GB di RAM.  

Su uno smartphone da 8 GB, un modello denso da 7B richiede 7 GB di memoria, lasciando poco spazio per altri processi. Un MoE da 35B con solo 3B attivi usa solo 3 GB per la parte attiva, lasciando 5 GB per il sistema e altre app.  

Il routing degli esperti (tramite un “gate” che sceglie gli esperti attivi) è leggero e veloce. Inoltre, lo streaming da Flash (memoria a lungo termine) permette di caricare solo gli esperti necessari per ogni token, evitando di caricare l’intero modello. Questo rende il MoE pratico su smartphone, dove la memoria è limitata, pur mantenendo alta precisione.
```

### q4_0 **DIFFERS from control**

```
Un modello Mixture-of-Experts (MoE) è un modello che, invece di avere tutti i parametri attivi per ogni token, “scatena” solo un sottoinsieme di essi (gli “esperti”) in base alla richiesta. In un MoE da 35B parametri, solo circa 3B sono attivi per token, il che significa che la memoria richiesta è molto inferiore a un modello denso da 7B, perché la maggior parte dei parametri rimane inattiva. Questo rende il MoE molto più efficiente in memoria, specialmente su dispositivi con 8 GB di RAM.

Il routing degli esperti è gestito da un “router” che seleziona i migliori esperti per ogni input, riducendo la memoria attiva. Inoltre, con lo streaming da flash, i parametri non vengono caricati tutti in una volta, ma vengono caricati su richiesta, permettendo di gestire modelli enormi con memoria limitata. Quindi, un MoE da 35B con 3B attivi è più pratico di un 7B denso perché:  
- Usa meno memoria (solo 3B attivi, non 35B)  
- Permette di eseguire modelli più grandi su hardware limitato  
- Il routing e lo streaming da flash rendono l’uso della memoria ottimizzato, nonostante la dimensione totale del modello  

In sintesi: il MoE è più efficiente perché “solo ciò che serve” è attivo, e lo streaming da flash lo rende pratico su smartphone.
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
Misurare le prestazioni a batteria scarica richiede un approccio diverso rispetto a quella a batteria piena, poiché la tensione e la capacità disponibile sono significativamente inferiori, influenzando la stabilità e la durata delle operazioni. In condizioni di scarica profonda, i processori e i componenti hardware possono entrare in modalità di risparmio energetico, rallentando le operazioni e alterando i risultati di benchmark. Inoltre, la gestione termica e la capacità di risposta del sistema operativo cambiano drasticamente, rendendo i dati di prestazione non comparabili con quelli ottenuti in condizioni di carica completa.

Quali parametri di calibrazione sono necessari per garantire la riproducibilità dei test in condizioni di bassa batteria?  
Come si può mitigare l’effetto della variazione della tensione di alimentazione sulle misure di prestazione del sistema operativo?
```

### q8_0 **DIFFERS from control**

```
Misurare le prestazioni a batteria scarica richiede di considerare un calo della capacità energetica, che può portare a risultati diversi rispetto a una misura a batteria piena, dove la capacità è massima e la tensione è stabile. In condizioni di scarica profonda, il telefono può mostrare una riduzione della velocità di elaborazione o un aumento del consumo energetico, influenzando la durata e la stabilità delle applicazioni. Inoltre, la gestione termica e la risposta del sistema operativo possono variare drasticamente quando la batteria è quasi vuota, rendendo le misure a batteria piena non rappresentative del comportamento reale.

Qual è il tempo di risposta minimo richiesto per un test di prestazioni a batteria scarica?  
Quali parametri di calibrazione sono necessari per garantire la riproducibilità delle misure in condizioni di scarica profonda?
```

### iq4_nl **DIFFERS from control**

```
Misurare le prestazioni a batteria scarica richiede di considerare un consumo energetico molto più elevato rispetto a una batteria piena, poiché il sistema operativo e i componenti hardware devono lavorare più intensamente per mantenere la funzionalità. A batteria piena, il telefono ha un margine di sicurezza e di riserva, che permette di ottenere risultati più stabili e prevedibili, mentre a batteria scarica la durata della batteria è spesso il fattore limitante. Inoltre, le app possono essere più inclini a crash o a un comportamento anomalo, rendendo le misurazioni meno affidabili se non si tiene conto del contesto di scarica.

Quali parametri tecnici sono essenziali per garantire la riproducibilità delle misurazioni a batteria scarica?  
Come si può garantire che il sistema operativo non interviene in modo imprevedibile durante le misurazioni a bassa carica?
```

### q4_0 **DIFFERS from control**

```
Misurare le prestazioni a batteria scarica richiede di considerare un comportamento diverso rispetto alla batteria piena, poiché la tensione e la capacità residua influenzano direttamente l'efficienza dei componenti e la risposta del sistema. A batteria scarica, il telefono tende a ridurre il consumo energetico per preservare la carica, il che può portare a un'esperienza utente più lenta o meno reattiva, a differenza della batteria piena dove l'energia è disponibile in abbondanza. Inoltre, la temperatura e la stabilità della batteria diventano fattori critici, rendendo la misura a batteria scarica più sensibile a variazioni di stato di carica e a fattori ambientali.

Qual è l'effetto della temperatura sulla stabilità della batteria durante la misura a batteria scarica?  
Come si può garantire la ripetibilità delle misure quando si confrontano risultati a batteria piena e scarica?
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
def median_eval_tok_s(rows):
    valid_values = []
    for row in rows:
        if row.get("nproc") is not None and row.get("eval_tok_s") is not None:
            if row["nproc"] >= 6:
                valid_values.append(row["eval_tok_s"])
    if not valid_values:
        return None
    valid_values.sort()
    n = len(valid_values)
    mid = n // 2
    if n % 2 == 0:
        return (valid_values[mid - 1] + valid_values[mid]) / 2
    else:
        return valid_values[mid]

if __name__ == "__main__":
    data = [
        {"eval_tok_s": 1.2, "nproc": 7},
        {"eval_tok_s": 2.5, "nproc": 5},
        {"eval_tok_s": 3.0, "nproc": 8},
        {"eval_tok_s": 4.0, "nproc": 6},
        {"eval_tok_s": None, "nproc": 9},
        {"eval_tok_s": 5.5, "nproc": 10},
    ]
    print(median_eval_tok_s(data))
```

### q8_0 **DIFFERS from control**

```
def median_eval_tok_s(rows):
    valid_values = []
    for row in rows:
        if row.get("nproc") is not None and row.get("nproc") >= 6:
            value = row.get("eval_tok_s")
            if value is not None:
                valid_values.append(value)
    if not valid_values:
        return None
    valid_values.sort()
    n = len(valid_values)
    mid = n // 2
    if n % 2 == 0:
        return (valid_values[mid - 1] + valid_values[mid]) / 2
    else:
        return valid_values[mid]

if __name__ == "__main__":
    data = [
        {"eval_tok_s": 1.2, "nproc": 7},
        {"eval_tok_s": 3.5, "nproc": 5},
        {"eval_tok_s": 2.0, "nproc": 8},
        {"eval_tok_s": None, "nproc": 10},
        {"eval_tok_s": 4.0, "nproc": 6},
        {"eval_tok_s": 5.0, "nproc": 4},
        {"eval_tok_s": 7.0, "nproc": 9},
    ]
    print(median_eval_tok_s(data))  # Output: 4.0
```

### iq4_nl **DIFFERS from control**

```
def median_eval_tok_s(rows):
    valid_values = []
    for row in rows:
        if row.get("nproc") is not None and row.get("eval_tok_s") is not None:
            valid_values.append(row["eval_tok_s"])
    if not valid_values:
        return None
    valid_values.sort()
    n = len(valid_values)
    mid = n // 2
    if n % 2 == 0:
        return (valid_values[mid - 1] + valid_values[mid]) / 2
    else:
        return valid_values[mid]


if __name__ == "__main__":
    # Example 1: All rows have nproc >= 6 and eval_tok_s values
    data1 = [{"eval_tok_s": 1.0, "nproc": 6}, {"eval_tok_s": 2.0, "nproc": 7}, {"eval_tok_s": 3.0, "nproc": 8}]
    print(median_eval_tok_s(data1))  # Expected: 2.0

    # Example 2: One row with nproc < 6
    data2 = [{"eval_tok_s": 1.5, "nproc": 5}, {"eval_tok_s": 2.5, "nproc": 6}]
    print(median_eval_tok_s(data2))  # Expected: 2.5

    # Example 3: No valid rows
    data3 = [{"eval_tok_s": 1.0, "nproc": 6}, {"eval_tok_s": 2.0, "nproc": 5}]
    print(median_eval_tok_s(data3))  # Expected: None

    # Example 4: Empty list
    print(median_eval_tok_s([]))  # Expected: None
```

### q4_0 **DIFFERS from control**

```
def median_eval_tok_s(rows):
    valid_values = []
    for row in rows:
        if row.get("nproc") is not None and row.get("eval_tok_s") is not None:
            valid_values.append(row["eval_tok_s"])
    if not valid_values:
        return None
    valid_values.sort()
    n = len(valid_values)
    mid = n // 2
    if n % 2 == 0:
        return (valid_values[mid - 1] + valid_values[mid]) / 2
    else:
        return valid_values[mid]

if __name__ == "__main__":
    # Example usage
    data = [
        {"eval_tok_s": 1.2, "nproc": 7},
        {"eval_tok_s": 2.5, "nproc": 5},
        {"eval_tok_s": 3.0, "nproc": 8},
        {"eval_tok_s": 4.0, "nproc": 6},
        {"eval_tok_s": 5.0, "nproc": 9},
        {"eval_tok_s": 6.0, "nproc": 4},
        {"eval_tok_s": 7.0, "nproc": 10},
    ]
    print(median_eval_tok_s(data))
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
La spiegazione più plausibile è **(B) il processo è finito in un cpuset con solo 3 core little**.

Infatti, il benchmark MoE ha mostrato un calo significativo da 5.0 a 1.2 tok/s, ma la temperatura è rimasta simile, escludendo un throttling termico (A). La quantizzazione (C) non è stata menzionata e non è un fattore comune in un semplice cambio di run senza aggiornamenti di modello. La causa più diretta e plausibile è che il processo si sia avviato su un cpuset con solo 3 core little, riducendo la capacità di elaborazione. Un controllo concreto è: `cat /sys/devices/.../cpuset/mem=...` o `cat /sys/devices/.../cpuset/.../mem=...` per verificare la configurazione del cpuset, oppure `cat /sys/devices/.../cpuset/.../mem=...` e controllare se `mem=3` è presente. In alternativa, `cat /sys/devices/.../cpuset/.../mem=...` e `cat /sys/devices/.../cpuset/.../mem=...` per vedere se il processo è stato avviato su un cpuset con solo 3 core. Se il cpuset è impostato su 3 core, il calo di prestazioni è coerente.
```

### q8_0 **DIFFERS from control**

```
La spiegazione più plausibile è **(B) il processo è finito in un cpuset con solo 3 core little**.

Infatti, il benchmark MoE ha mostrato un calo significativo da 5.0 a 1.2 tok/s, mentre la temperatura era simile, escludendo un throttling termico (A). La quantizzazione del modello (C) non è stata menzionata e non ci sono indizi di un cambiamento di configurazione o di versione del modello. La presenza di un cpuset con solo 3 core little è un’altra possibile causa: se il processo è stato pianificato su un insieme di core ridotto, la capacità di elaborazione si riduce drasticamente, specialmente se il modello è grande e richiede più di 3 core per funzionare a piena velocità.

**Controllo concreto**: esaminare il cpuset attivo per il processo tramite `cat /sys/fs/cgroup/cpuset/cpuset.cpus` e verificare se il processo è stato pianificato su un insieme di 3 core (es. `0-2` o `3-5`), oppure se è stato spostato su un cpuset con un numero inferiore di core. Inoltre, controllare il file `/proc/self/cpuset` per vedere se il processo è in un cpuset con solo 3 core. Se sì, il problema è di pianificazione, non di temperatura o quantizzazione.

**Conclusione**: la spiegazione più plausibile è (B).
```

### iq4_nl **DIFFERS from control**

```
La spiegazione più plausibile è la **(B) il processo è finito in un cpuset con solo 3 core little**.

Infatti, il benchmark MoE ha mostrato un calo drastico da 5.0 a 1.2 tok/s, e la temperatura era simile, escludendo un throttling termico (A). La quantizzazione (C) non è supportata da evidenze, poiché non si menziona alcun cambiamento di versione o di quantizzazione. La chiave è che il sistema ha 8 core disponibili, ma se il processo è stato eseguito su un cpuset con solo 3 core little, la capacità di elaborazione è limitata, spiegando la riduzione di prestazioni.

**Controllo concreto**: eseguire `cat /sys/devices/system/cpu/cpuset/mems` e `cat /sys/devices/system/cpu/cpuset/mems` per verificare se il processo è stato avviato su un cpuset con solo 3 core (es. `0:0:0:0:0:0:0:0` o `0:0:0:0:0:0:0:0` con 3 core attivi). Inoltre, controllare `cat /sys/devices/system/cpu/cpuset/mems` e verificare che il processo è stato avviato su un cpuset con `0:0:0:0:0:0:0:0` (3 core) e non su tutti e 8. Se il cpuset è limitato, il processo sarà limitato a 3 core, spiegando la riduzione di throughput.

**Risultato finale**: la spiegazione più plausibile è la (B).
```

### q4_0 **DIFFERS from control**

```
La spiegazione più plausibile è **(B) il processo è finito in un cpuset con solo 3 core little**.

Infatti, il benchmark ha mostrato un calo netto di prestazioni (da 5.0 a 1.2 tok/s) con la stessa temperatura, il che suggerisce un’altra causa. La temperatura è simile, quindi il throttling termico (A) è improbabile. La quantizzazione (C) non è stata menzionata, e non ci sono indizi di un cambiamento di ottimizzazione o di un’altra versione del modello.

Tuttavia, se il processo è stato eseguito su un cpuset con solo 3 core little, la CPU disponibile è ridotta, e questo spiega perfettamente la perdita di prestazioni: 8 core disponibili in un caso, 3 in un altro, e 1.2 tok/s è coerente con un numero ridotto di core attive (solo 3 core, con 1.2 tok/s ciascuno, 3×1.2=3.6, ma 1.2 è il valore osservato, quindi forse 1 core o meno). In realtà, 1.2 tok/s su 3 core suggerisce che la CPU non è stata utilizzata a pieno, ma la spiegazione più diretta è che **solo 3 core sono attive**.

Per verificare: controlla il **cpuset** con `cat /sys/devices/.../cpuset` o usa `cat /sys/devices/.../cpuset` e controlla la configurazione del processo con `cat /proc/.../status` o `ps -e -o pid,cpu,comm,stat` per vedere se il processo è stato eseguito su 3 core.

In alternativa, usa `cat /sys/devices/.../cpuset`
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
Ciao Marco, ho appena verificato che l’app di chat on-device su Samsung S23 è pronta per il test. Useremo un modello MoE quantizzato a circa 2.4 bit per peso, che garantisce un’ottima efficienza senza perdere precisione. La velocità attesa è di circa 5 token al secondo — un valore molto stabile e accettabile per l’uso in background. Assicurati che lo schermo rimanga acceso: il processo deve rimanere in foreground per evitare interruzioni. Annota: temperatura, consumo di batteria, e numero di token al secondo. Se qualcosa non funziona, segnala immediatamente — il team è pronto a intervenire. Grazie per il tuo impegno.
```

### q8_0 **DIFFERS from control**

```
Ciao [Nome],

Per il test dell’app di chat on-device su Samsung S23, utilizzeremo un modello MoE quantizzato a circa 2.4 bit per peso. La velocità attesa è di circa 5 token al secondo. Assicurati che lo schermo rimanga acceso durante il test: il processo deve rimanere in foreground per evitare interruzioni.  

Annota: temperatura, consumo di batteria, e numero di token al secondo.  
Fai attenzione a eventuali cali di prestazioni in condizioni di bassa luminosità o con l’interfaccia attiva.  

Grazie per il tuo impegno.
```

### iq4_nl **DIFFERS from control**

```
Ciao [Nome],

Stiamo testando l’app di chat on-device su Samsung S23. Abbiamo quantizzato il modello MoE a circa 2.4 bit per peso, che garantisce un’ottima efficienza senza perdita di qualità. La velocità attesa è di circa 5 token al secondo — se il risultato è inferiore, controlla la connessione e la potenza di elaborazione del dispositivo. Assicurati che lo schermo rimanga acceso: il processo rimane in foreground solo se l’interfaccia è attiva.  

Annota: temperatura, stato batteria, e tok/s.  
Per il report, segnala se il modello ha risposto correttamente, se il tempo di risposta è stabile e se lo schermo si è spento prima del termine.  

Buon test!
```

### q4_0 **DIFFERS from control**

```
Ciao, per il test dell’app di chat on-device sul Samsung S23, utilizzeremo il modello MoE quantizzato a 2.4 bit per peso. La velocità attesa è di circa 5 token al secondo, e lo schermo deve rimanere acceso per mantenere il processo in foreground. Assicurati che la temperatura e la batteria siano ottimizzate: la temperatura deve essere sotto i 30°C, la batteria sopra l’80%. Annota anche il numero di token al secondo e lo stato di carica. Per la precisione, controlla che il modello non si arresti per mancanza di energia.
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
La notte era profonda, l’aria dentro il treno pesante come un sussurro di ricordi che non volevano morire. Il treno, un’ombra di metallo e luce che scivolava lentamente lungo la penisola, non era mai stato solo un mezzo di trasporto per lui. Era stato un’altra vita, un’altra esistenza che si era dissolta tra le rotaie e le stazioni, come un sussurro che si perdeva tra le luci di un tram che non tornava mai più. Ora, seduto su un sedile di legno scuro, con la mano appoggiata al braccio del finestrino che si apriva come un’apertura verso il cielo, lui guardava fuori. Non era più il ragazzo che aveva lasciato Milano con un borsone e un cuore che non sapeva ancora di avere bisogno di un’altra vita. Ora era un uomo che aveva imparato a non chiedere, ma a ricordare.

Il treno era pieno di volti che non erano mai stati quelli che si aspettavano. C’era la donna che leggeva un libro di poesie di Saffo, le sue dita che si muovevano con la calma di chi ha già visto la fine di un’epoca. C’era l’uomo che dormiva con la testa appoggiata al finestrino, il suo respiro regolare come un’onda che non ha mai smesso di muoversi. C’era la ragazza che cantava a voce alta una canzone di Mina, le labbra che si muovevano come se fossero in un’altra vita, e il suo sguardo, quando si voltò, era quello di qualcuno che non ha
```

### q8_0 **DIFFERS from control**

```
La notte era lunga, come le strade che si stendevano al di là del finestrino, e il treno non era mai arrivato a Roma, ma a Napoli, eppure non si sentiva alcuna fretta, solo il lento, dolce sussurro del metallo contro il ferro, il ronzio del motore che sembrava un cuore che batteva in un sonno profondo. Il treno, un’ombra di vagoni grigi e luci tremolanti, scivolava come un sogno che non voleva finire, e ogni volta che il treno passava su un binario, il paesaggio che scorreva era un’altra pagina di un libro che non si era mai chiuso. Da Milano, dove il cielo era ancora tinto di notte e le luci delle case si erano fatte piccole, come occhi che si chiudono, il treno aveva preso la strada del sud, e con esso, la strada della memoria.

Avevo lasciato Napoli da giovane, con un borsone di cartone e un cuore che non sapeva più dove fosse il suo posto. Avevo lasciato la città che mi aveva dato la vita, non per scelta, ma per necessità, per un’altra vita che non mi apparteneva più. Ora, seduto su un sedile di legno scuro, con la mano appoggiata al braccio del vetro, guardavo fuori, e il paesaggio si spostava come un’altra vita che si stava svolgendo senza di me. Le colline della Toscana, con i loro vigneti che si stendevano come braccia aperte, erano state la mia prima casa. Poi, le montagne della Campania, con i loro ulivi
```

### iq4_nl **DIFFERS from control**

```
La notte era profonda, e il treno si muoveva come un respiro che non si fermava mai, trascinando con sé le ombre di una città che non era più la sua, eppure era ancora la sua. Il treno, a venticinque chilometri orari, scivolava tra le montagne che si erano fatte azzurrate dal fumo delle stazioni, e le valli che si aprivano come bocche di un tempo che non si era mai chiuso. Ogni finestra che si aprivano era un’altra storia: un uomo che camminava con un cappello di feltro, il cui sguardo era stato di un altro tempo, e che non aveva mai visto la sua stessa ombra. Un’altra donna, con un foulard di seta che svolgeva un’altra vita, le sue dita che si muovevano come se stessero ancora cucendo un abito che non era mai stato indossato. Il treno era un corpo che respirava, e ogni respiro era un’eco di un’altra esistenza.

L’aria dentro il vagone era umida, carica di odori: il profumo di unghie di pane che era stato mangiato a Roma, il fumo di una sigaretta che era stata accesa a Torino, il profumo di un profumo che non era mai stato il suo, ma che era stato il suo. Il protagonista, che era seduto su un sedile di legno scuro, con la schiena appoggiata al muro e la mano appoggiata al braccio del sedile, non aveva mai smesso di pensare a quella notte in cui era partito da Milano, con la valigia vuota e il cuore che non sapeva se fosse un’
```

### q4_0 **DIFFERS from control**

```
La notte era profonda, l’aria dentro il treno di linea 101 di Trenitalia era gelida, come se il mondo esterno avesse deciso di congelare il tempo per un attimo. Il treno, un vecchio vagoncino di legno e vetro, scivolava lentamente lungo la ferrovia che si stendeva come un filo d’argento tra le montagne e le campagne, lasciando che la luna, sospesa tra le nubi, dipingesse di bianco le valli e i campi di grano che si stendevano come un’immagine di pace eterna. Il protagonista, un uomo di mezza età con gli occhi di chi ha visto troppo e non ha mai saputo dire perché, si era seduto su un sedile di legno scuro, con la schiena appoggiata al muro dietro di lui, e aveva lasciato che la sua mente si sciogliesse come la nebbia che si forma quando la notte si fa troppo profonda.

Non era mai stato un viaggiatore abituale. Ma quella sera, con la valigia di legno che portava la sua vita, la valigia che non era mai stata aperta, la valigia che non aveva mai avuto un nome, era stata la prima volta che si era sentito davvero “a casa” — non perché avesse trovato un luogo, ma perché aveva trovato un’ombra che non lo lasciava più. Il treno, che era partito da Milano con la luce del giorno ancora appesa alle sue finestre, ora era avvolto nel buio, e la sua voce, sussurrata tra i passeggeri, era stata quella di un uomo che non aveva mai parlato a nessuno, ma che ora, per la prima volta
```

