# Kalsa: guida per chi prova l'alpha

Kalsa è un'intelligenza artificiale che lavora sul tuo computer: i tuoi messaggi restano
lì e le risposte nascono lì. Su internet escono solo le ricerche sul web. Per seguire
questa guida non servono conoscenze tecniche.

## 1. Cosa ti serve

- **Un Mac con processore Apple** (M1 o successivi) **oppure un PC Windows a 64 bit**
  (l'abbiamo provata su Windows 11).
- **Memoria (RAM): almeno 16 GB.** Con meno, Kalsa potrebbe proporti solo un'AI piccola,
  oppure nessuna. In quel caso scrivici.
- **Circa 30 GB liberi sul disco.** L'AI da scaricare pesa fra i 3 e i 22 GB, a seconda
  del computer.
- **Una connessione a internet** per il primo avvio. Alcune reti aziendali o scolastiche
  bloccano il download: in quel caso riprova da casa.

## 2. Installazione su Mac

L'app non è ancora firmata da Apple, quindi la prima volta macOS la blocca.

**macOS 15 (Sequoia) o successivi:**

1. Fai doppio clic sull'app. macOS dice che non può aprirla: chiudi il messaggio.
2. Apri **Impostazioni di Sistema → Privacy e sicurezza**, scorri in basso e fai clic su
   **Apri comunque**.
3. Conferma con la password o con Touch ID, poi riapri Kalsa.

**Versioni precedenti:** clic destro sull'app, scegli **Apri** e poi di nuovo **Apri**.

Se l'app si apre da un'immagine disco (.dmg), prima trascinala in **Applicazioni**.

## 3. Installazione su Windows

1. Avvia il file di installazione. Non serve la password di amministratore.
2. Se Windows mostra **"Windows ha protetto il PC"**, fai clic su **Ulteriori
   informazioni** e poi su **Esegui comunque**.
3. Apri Kalsa dal menu Start. Se Windows chiede se Kalsa può usare la rete, scegli
   **Consenti**.

## 4. Il primo avvio

1. Apri Kalsa e premi **Avvia**: Kalsa controlla il tuo computer.
2. Scegli una delle AI che ti propone con **Usa questo**.
3. Premi **Scarica**. Finito il download, Kalsa prova alcune impostazioni per trovare la
   più veloce. Sullo schermo vedi quanti minuti mancano.
4. Quando ha finito, puoi chattare.

Succede una volta sola e può richiedere un po' di tempo, soprattutto per il download.
Tieni il computer collegato alla corrente e non farlo andare in stop. Se qualcosa non va,
premi **Riprova**.

## 5. Telefono

Le app di Kalsa per Android e iOS usciranno più avanti.

## 6. Se qualcosa non funziona

Durante l'alpha Kalsa ci manda da sola le segnalazioni degli errori. Quando succede
qualcosa di grave (per esempio si blocca il motore dell'AI) invia anche il log, cioè un
registro tecnico di quello che ha fatto l'app. Non contengono mai le tue chat, i tuoi
messaggi o i tuoi file. La prima volta che apri Kalsa compare questo avviso:

> Durante l'alpha, Kalsa invia segnalazioni degli errori con dettagli tecnici, e il log
> dell'app quando succede qualcosa di grave. Mai le tue chat o i tuoi testi. Puoi
> disattivarle nelle Impostazioni.

**Per disattivare le segnalazioni:** **Impostazioni** (in alto a destra) → togli la
spunta a **Segnalazioni degli errori**.

**Per mandarci tu il log:** apri la pagina **AI**, scorri fino a **Segnala un problema**
e premi **Invia il log**. Poi scrivici cosa stavi facendo e a che ora.

**Se l'AI si ferma:** Kalsa la riavvia da sola una volta. Se non basta, nella Home
compare **Ferma**: premi **Riprova**. Se una risposta si è interrotta, premi **Riprova**
sotto la risposta.

**Se il log non parte** (per esempio su una rete aziendale), premi **Apri la cartella dei
log** e mandaci per email il file **kalsa-brain.log**.

La cartella dei log è:

- **Mac:** `~/Library/Logs/ai.kalsa.brain/`
- **Windows:** `%LOCALAPPDATA%\ai.kalsa.brain\logs\`

## 7. Download

Scarica Kalsa dal link privato che ti abbiamo mandato, e per favore non condividerlo.

## 8. Disinstallare Kalsa

**Mac:** trascina Kalsa da Applicazioni nel Cestino. Per cancellare anche i suoi dati
(l'AI è la parte più pesante), nel Finder premi **⌘ ⇧ G**, incolla un percorso alla
volta e cancella la cartella:
`~/Library/Application Support/kalsa-brain`,
`~/Library/Application Support/ai.kalsa.brain`, `~/Library/Logs/ai.kalsa.brain`.

**Windows:** **Impostazioni → App → App installate → Kalsa → Disinstalla**. Per
cancellare anche i suoi dati, premi **Windows + R**, incolla un percorso alla volta,
premi Invio e cancella quello che c'è dentro:
`%LOCALAPPDATA%\kalsa-brain`, `%APPDATA%\ai.kalsa.brain`, `%LOCALAPPDATA%\ai.kalsa.brain`.
