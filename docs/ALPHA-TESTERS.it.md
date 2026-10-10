# Kalsa: guida per chi prova l'alpha

Kalsa è un'intelligenza artificiale che lavora direttamente sul tuo computer: i tuoi
messaggi restano lì e le risposte nascono lì. L'unica eccezione sono le ricerche sul web:
quando Kalsa cerca qualcosa online, le parole cercate escono dal computer. Puoi usare
Kalsa anche dal telefono, collegandolo al computer. Qui trovi tutto quello che serve per
installarla e farla partire la prima volta. Non servono conoscenze tecniche.

## 1. Cosa ti serve

- **Un Mac con processore Apple** (M1 o successivi). I Mac con processore Intel per ora
  non sono supportati.
- **Oppure un PC con Windows a 64 bit.** L'abbiamo provata su Windows 11. I PC Windows
  con processore ARM arriveranno più avanti.
- **Memoria (RAM):** l'abbiamo provata con 16 GB e 32 GB. Anche con 8 GB l'app potrebbe
  proporti un'intelligenza artificiale più piccola. Se al primo avvio la schermata
  **Scegli l'AI** non ti propone niente, vuol dire che nessuna delle nostre AI gira
  abbastanza bene sul tuo computer. Il messaggio compare in inglese: "This computer is
  not worth using: it can give a model … and the smallest one in the catalog needs …."
  Aprendo **Mostra i dettagli** leggerai: "Kalsa non ha ancora un'AI che giri bene su
  questo computer. Controlla se c'è un aggiornamento dell'app." Prova ad aggiornare
  l'app; se il problema resta, scrivici.
- **Circa 30 GB liberi sul disco**, per avere margine. Il primo download pesa fra i 3 e i
  22 GB circa, a seconda del computer.
- **Una connessione a internet** per il primo avvio, perché Kalsa deve scaricare l'AI.
  Alcune reti aziendali o scolastiche bloccano il download; in quel caso Kalsa mostra
  "Kalsa non ha potuto scaricare quello che le serve su questa rete. Prova un'altra
  rete." Riprova da casa.
- **Il telefono:** installa l'app Kalsa dal link che ti mandiamo e tienila aggiornata.
  <!-- PHONE-APP-LINK -->

## 2. Installazione su Mac

L'app non è ancora firmata da Apple, quindi al primo avvio macOS la blocca. Per aprirla
lo stesso, segui i passaggi adatti alla tua versione di macOS.

**macOS 15 (Sequoia) o successivi** (qui il vecchio trucco del clic destro non funziona
più):

1. Fai doppio clic sull'app. macOS ti dirà che non può aprirla: chiudi il messaggio.
2. Apri **Impostazioni di Sistema → Privacy e sicurezza**.
3. Scorri un po' verso il basso: troverai un avviso che dice che Kalsa è stata bloccata.
   Fai clic su **Apri comunque**.
4. Conferma con la password o con Touch ID, poi riapri Kalsa.

**Versioni precedenti di macOS:**

1. Fai clic con il tasto destro (oppure Ctrl-clic) sull'app, scegli **Apri** e poi di
   nuovo **Apri**.

Se l'app si apre da un'immagine disco (.dmg), prima trascinala nella cartella
**Applicazioni**.

## 3. Installazione su Windows

1. Avvia il file di installazione. Kalsa viene installata solo per il tuo utente, quindi
   non serve la password di amministratore.
2. Windows potrebbe mostrare l'avviso **"Windows ha protetto il PC"**. Fai clic su
   **Ulteriori informazioni** e poi su **Esegui comunque**.
3. Apri Kalsa dal menu Start.

## 4. Il primo avvio (si fa una volta sola)

1. Apri Kalsa e premi **Avvia**. Kalsa esamina il tuo computer e sceglie l'AI più adatta.
2. Dopo il controllo ti propone le AI che vanno bene per il tuo computer (di solito due).
   Per ognuna vedi il nome, quanto pesa e una nota: "Risposte più intelligenti." oppure
   "Risposte più rapide.". Scegli quella che preferisci con il pulsante **Usa questo**. Se
   l'AI è già sul computer, il download viene saltato. Con **Annulla** torni al passo
   precedente.
3. Kalsa ti chiede "Scaricare … GB?" indicando la dimensione. Premi **Scarica**. Finito il
   download, Kalsa prova diverse impostazioni per capire quale va più veloce sul tuo
   computer ("Kalsa sta cercando le impostazioni più veloci…"). Sullo schermo vedi
   quanti minuti mancano, più o meno.
4. Quando ha finito, puoi iniziare a chattare.

Fino alla fine del primo avvio tieni il computer acceso, collegato alla corrente e senza
farlo andare in stop. Puoi ridurre Kalsa a icona mentre lavora. Se qualcosa va storto,
compare il pulsante **Riprova**: premilo. Queste prove si fanno solo la prima volta. Dopo,
Kalsa parte da sola ogni volta che la apri; vedrai "Kalsa si sta preparando. Su un
computer meno recente può volerci un minuto."

Il primo avvio può richiedere parecchio tempo, soprattutto per il download: dipende dalla
velocità della tua connessione.

## 5. Collegare il telefono

Kalsa deve essere accesa: se nella Home risulta spenta, premi **Accendi**. Poi, nella
Home, sotto **Questo computer**, apri **Dispositivi**. Inquadra con la fotocamera del
telefono il quadrato che compare sullo schermo, oppure premi **Invita con un link** e
mandati il link sul telefono: vale una volta sola e scade dopo un giorno. L'app ti
avvisa: "Chiunque veda questo quadrato può collegare un telefono — mostralo solo al tuo."

Il collegamento si conferma dal computer, non dal telefono. Nella pagina Dispositivi
compare prima "In attesa del tuo OK" e poi "Un telefono si sta collegando. Scegli
Consenti o Rifiuta qui sotto." A quel punto premi **Consenti**.

La prima volta Windows potrebbe chiederti se Kalsa può usare la rete: rispondi di sì.

## 6. Se qualcosa non funziona

Kalsa tiene un log, cioè un registro di quello che fa l'app. Quando qualcosa non va, è
la prima cosa che ci serve.

**Alcune segnalazioni Kalsa le invia da sola.** Durante l'alpha Kalsa ci manda
segnalazioni degli errori con alcuni dettagli tecnici. Nei casi più gravi allega anche il
log dell'app:

- quando il motore dell'AI si blocca o si chiude all'improvviso;
- quando il motore dell'AI non può funzionare sul tuo computer o non si riesce a
  scaricare. In questi casi compare "Kalsa non può ancora girare su questo computer."
  oppure "Kalsa non ha potuto scaricare quello che le serve.";
- quando il controllo del computer al primo avvio non va a buon fine. Compare "Kalsa
  non è riuscita a controllare questo computer."

Il log invece non viene inviato se fallisce il download dell'AI o una ricerca sul web, né
se il disco è pieno. Kalsa non invia mai le tue chat né i tuoi testi, e in automatico
manda al massimo tre log al giorno.

Nel log non finiscono mai i tuoi messaggi, le risposte di Kalsa, i tuoi file, né codici o
chiavi. Contiene cosa ha fatto Kalsa e cosa ha questo computer: versioni, processore,
scheda grafica, memoria, errori.

La prima volta che apri Kalsa compare questo avviso:

> Durante l'alpha, Kalsa invia segnalazioni degli errori con dettagli tecnici, e il log
> dell'app quando succede qualcosa di grave. Mai le tue chat o i tuoi testi. Puoi
> disattivarle nelle Impostazioni.

Premi **Chiudi** per toglierlo.

**Per disattivare le segnalazioni:** apri le **Impostazioni** (in alto a destra) e togli
la spunta a **Segnalazioni degli errori**. La scelta resta valida anche quando riavvii
Kalsa.

**Per mandarci tu il log:** apri la pagina **AI** (dalla Home, sotto **Questo
computer**), scorri fino a **Segnala un problema** e premi **Invia il log**. Quando Kalsa
risponde "Inviato. Grazie.", scrivici cosa stavi facendo e a che ora.

**Se il motore dell'AI si ferma da solo:** se Kalsa era accesa, prova a riavviarlo da
sola, una volta. Non ci riprova se il motore si è fermato per mancanza di memoria, né se
si ferma di nuovo entro dieci minuti dal riavvio. In quel caso nella Home compare
**Ferma** con il messaggio "Kalsa si è fermata da sola. Riaccendila." Premi **Riprova**.

Se invece il riavvio riesce, compare per sei secondi una piccola riga: "Kalsa si è
ripresa da un errore." Se hai disattivato le segnalazioni, nella riga trovi anche **Invia
il log**. Per toglierla prima, premi **Chiudi**.

**Se una risposta si interrompe:** quando il motore si è fermato e Kalsa l'ha riavviato,
la risposta rimasta a metà mostra "La risposta si è interrotta." Premi **Riprova** per
ripetere la domanda. Se la risposta si è interrotta per altri motivi, vedrai invece "La
risposta si è interrotta a metà." con il pulsante **Riprova**. Se in quel momento Kalsa è
spenta, il riquadro dice "Kalsa è spenta." e ti propone **Accendi Kalsa**.

**Se premendo Invia il log Kalsa risponde "La tua rete (ad esempio quella aziendale)
blocca l'invio."**, il log non è partito. Premi allora **Apri la cartella dei log**: si
apre una cartella sul tuo computer. Manda per email il file **kalsa-brain.log** alla
persona che ti ha fatto provare Kalsa. Se c'è anche **kalsa-brain.1.log**, allega anche
quello.

**Se sei su una rete aziendale o scolastica**, le segnalazioni potrebbero non partire.
Kalsa le conserva fino a 30 giorni e le invia appena il computer si collega a un'altra
rete. Non devi fare niente.

Il log si trova qui:

- **Mac:** `~/Library/Logs/ai.kalsa.brain/`
- **Windows:** `%LOCALAPPDATA%\ai.kalsa.brain\logs\`

## 7. Download

Scarica Kalsa dal link privato che ti abbiamo mandato, e per favore non condividerlo.

## 8. Disinstallare Kalsa

**Mac:** trascina Kalsa da Applicazioni nel Cestino e svuota il Cestino. Per cancellare
anche i suoi dati, nel Finder premi **⌘ ⇧ G**, incolla uno alla volta questi percorsi e
cancella la cartella che si apre:
`~/Library/Application Support/kalsa-brain` (l'AI scaricata, la più pesante),
`~/Library/Application Support/ai.kalsa.brain` e `~/Library/Logs/ai.kalsa.brain`.

**Windows:** apri **Impostazioni → App → App installate → Kalsa → Disinstalla**. Per
cancellare anche i suoi dati, premi **Windows + R**, incolla uno alla volta questi
percorsi, premi Invio e cancella il contenuto della cartella che si apre:
`%LOCALAPPDATA%\kalsa-brain` (l'AI scaricata, la più pesante), `%APPDATA%\ai.kalsa.brain`
e `%LOCALAPPDATA%\ai.kalsa.brain` (i dati interni dell'app e i log).
