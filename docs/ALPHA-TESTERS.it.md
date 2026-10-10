# Kalsa per chi prova l'alpha

Kalsa fa girare un'AI privata sul tuo computer. Ai tuoi messaggi risponde questo
computer; quando Kalsa cerca sul web, le parole di quella ricerca escono dal computer. Il
tuo telefono parla con questo computer. Questa pagina ti accompagna nell'installazione e
nel primo avvio. È scritta per chi non è del mestiere: non serve sapere come funziona.

## 1. Cosa ti serve

- **Un Mac con Apple Silicon** (M1 o più recente). I Mac Intel per ora non sono supportati.
- **Oppure un PC Windows a 64 bit.** Abbiamo provato Windows 11. Windows su ARM arriverà più avanti.
- **Memoria:** abbiamo provato 16 GB e 32 GB. Con 8 GB l'app può comunque proporti
  un'AI piccola. Se la schermata del primo avvio dice **Scegli l'AI** e non offre nessuna
  scelta, nessuna AI di Kalsa gira abbastanza bene su questo computer. La schermata lo
  dice in inglese: "This computer is not worth using: it can give a model … and the
  smallest one in the catalog needs …." Sotto **Mostra i dettagli** dice: "Kalsa non ha
  ancora un'AI che giri bene su questo computer. Controlla se c'è un aggiornamento
  dell'app." Controlla se c'è un aggiornamento. Se ancora non hai nessuna scelta,
  scrivici.
- **Circa 30 GB di spazio libero sul disco, per stare tranquilli.** A seconda del
  computer, il primo download va da circa 3 GB a circa 22 GB.
- **Una connessione a internet** per il primo avvio: per prima cosa Kalsa scarica l'AI.
  Su alcune reti di lavoro o di scuola il download è bloccato: Kalsa dice "Kalsa non ha
  potuto scaricare quello che le serve su questa rete. Prova un'altra rete." Riprova da
  casa.
- **Il tuo telefono:** installa l'app Kalsa per il telefono dal link che ti mandiamo e
  tienila aggiornata. <!-- PHONE-APP-LINK -->

## 2. Installare sul Mac

L'app non è firmata da Apple, quindi macOS ti avvisa prima di aprirla. Ci sono due modi
per andare avanti, a seconda della versione di macOS.

**macOS 15 (Sequoia) o più recente**: qui il vecchio trucco del clic destro non funziona
più.

1. Apri l'app una volta (doppio clic). macOS dice che non si può aprire. Chiudi il messaggio.
2. Apri **Impostazioni di Sistema → Privacy e sicurezza**.
3. Scorri un po' in basso. Vedrai una nota che dice che Kalsa è stata bloccata. Fai clic
   su **Apri comunque**.
4. Conferma (password o Touch ID), poi apri di nuovo Kalsa.

**macOS meno recenti:**

1. Fai clic destro (o Ctrl-clic) sull'app, scegli **Apri**, poi di nuovo **Apri**.

Se l'app si apre da un'immagine disco, trascinala prima in **Applicazioni**.

## 3. Installare su Windows

1. Avvia il programma di installazione di Kalsa. Installa solo per te: non serve la
   password di amministratore.
2. Windows può mostrare **"Windows ha protetto il PC"**. Fai clic su **Ulteriori
   informazioni**, poi su **Esegui comunque**.
3. Avvia Kalsa dal menu Start.

## 4. Il primo avvio (una volta sola)

1. Apri Kalsa e premi **Avvia**. Sotto il pulsante, Kalsa dice che controlla il tuo
   computer e sceglie l'AI che ci gira meglio.
2. Kalsa controlla il computer, poi propone le AI adatte (di solito due). Ognuna mostra
   il nome, una dimensione e "Risposte più intelligenti." oppure "Risposte più rapide.",
   con il suo pulsante **Usa questo**. Scegline una. Se l'AI è già sul computer, non c'è
   la domanda sul download. **Annulla** ti riporta indietro di un passo.
3. Kalsa chiede "Scaricare … GB?" con la dimensione. Premi **Scarica**. Poi scarica l'AI
   e misura il tuo computer: "Kalsa sta cercando le impostazioni più veloci…". La
   schermata mostra circa quanti minuti mancano.
4. Quando ha finito, puoi chattare.

Tieni il computer collegato alla corrente e acceso, senza farlo andare in stop, finché il primo
avvio non finisce.
Puoi ridurre Kalsa a icona mentre lavora. Se qualcosa non va, l'app mostra **Riprova**:
premilo. Questa misura si fa una volta sola. In seguito Kalsa parte da sola quando la
apri; la schermata dice "Kalsa si sta preparando. Su un computer meno recente può
volerci un minuto."

Il primo avvio può durare a lungo. Quasi tutto il tempo è il download, quindi dipende
dalla velocità della tua connessione.

## 5. Collegare il telefono

Kalsa deve essere accesa. Se la Home dice che Kalsa è spenta, premi **Accendi**.
Nella Home di Kalsa, sotto **Questo computer**, apri **Dispositivi**. Inquadra il
quadrato con la fotocamera del telefono, oppure premi **Invita con un link** e manda il
link al tuo telefono: funziona una volta sola, per un giorno. L'app avvisa: "Chiunque
veda questo quadrato può collegare un telefono — mostralo solo al tuo."

Il pulsante **Consenti** è su questo computer, non sul telefono. La pagina Dispositivi
mostra "In attesa del tuo OK", poi "Un telefono si sta collegando. Scegli Consenti o
Rifiuta qui sotto." Premi **Consenti**.

Se Windows chiede se Kalsa può usare la rete, scegli Consenti. Può succedere la prima
volta.

## 6. Quando qualcosa va storto

Kalsa tiene un log: un registro di quello che l'app ha fatto. È la prima cosa che ci
serve quando qualcosa va storto.

**Kalsa invia alcune segnalazioni da sola.** Durante l'alpha, Kalsa invia segnalazioni
degli errori con dettagli tecnici. Per questi problemi gravi invia anche il log dell'app:

- il motore dell'AI si ferma o va in crash, in qualsiasi momento;
- il motore dell'AI non può girare su questo computer, o non si riesce a scaricare il
  suo programma. La schermata dice "Kalsa non può ancora girare su questo computer." o
  "Kalsa non ha potuto scaricare quello che le serve.";
- il controllo del computer al primo avvio non riesce a finire in modo affidabile. La
  schermata dice "Kalsa non è riuscita a controllare questo computer."

Un download dell'AI fallito, una ricerca sul web fallita e un disco pieno non inviano il
log. Kalsa non invia mai le tue chat o i tuoi testi. In questo modo si inviano al
massimo tre log al giorno.

Il log non contiene mai i tuoi messaggi, le risposte di Kalsa, i tuoi file, né codici o
chiavi. Contiene cosa ha fatto Kalsa e cosa ha questo computer: versioni,
processore, scheda grafica, memoria, errori.

La prima volta che apri Kalsa, un avviso dice:

> Durante l'alpha, Kalsa invia segnalazioni degli errori con dettagli tecnici, e il log
> dell'app quando succede qualcosa di grave. Mai le tue chat o i tuoi testi. Puoi
> disattivarle nelle Impostazioni.

Premi **Chiudi** per chiuderlo.

**Per disattivarle:** apri **Impostazioni** (in alto a destra), trova **Segnalazioni
degli errori** e togli la spunta. Se le disattivi, restano disattivate, anche dopo aver
riavviato Kalsa.

**Per inviare tu il log:** apri la pagina **AI** (nella Home, sotto **Questo
computer**). Scorri fino a **Segnala un problema** in fondo e premi **Invia il log**.
Kalsa dice "Inviato. Grazie." Scrivici cosa stavi facendo e quando.

**Se il motore dell'AI si ferma da solo:** se Kalsa era accesa, Kalsa riavvia il motore,
una volta. Non lo fa dopo un arresto per memoria esaurita, né quando il motore si ferma di
nuovo prima di aver girato dieci minuti dopo il riavvio. Allora la Home dice **Ferma** e
"Kalsa si è fermata da sola. Riaccendila." Premi **Riprova**.

Se il riavvio funziona, compare una piccola riga: "Kalsa si è ripresa da un errore."
Sparisce dopo sei secondi. Se le segnalazioni sono disattivate, la riga ha anche **Invia
il log**. Premi **Chiudi** per chiuderla.

**Se una risposta si è interrotta:** quando il motore si ferma da solo e Kalsa lo
riavvia, una risposta tagliata da quell'arresto dice "La risposta si è interrotta."
Premi **Riprova** per chiedere di nuovo. Qualsiasi altra risposta tagliata dice "La
risposta si è interrotta a metà." e ha un pulsante **Riprova**. Se Kalsa è spenta,
quel riquadro dice "Kalsa è spenta." e propone **Accendi Kalsa**.

**Se Kalsa dice "La tua rete (ad esempio quella aziendale) blocca l'invio."** quando
premi **Invia il log**, il log non è stato inviato. Premi invece **Apri la cartella dei
log**: sul tuo computer si apre una cartella. Manda il file **kalsa-brain.log** per email
a chi ti ha dato Kalsa. Se vedi anche **kalsa-brain.1.log**, manda anche quello.

**Su una rete di lavoro o di scuola** le segnalazioni potrebbero non passare. Kalsa le
tiene fino a 30 giorni e le invia quando il computer è su un'altra rete. Non devi fare
niente.

La cartella dei log è:

- **Mac:** `~/Library/Logs/ai.kalsa.brain/`
- **Windows:** `%LOCALAPPDATA%\ai.kalsa.brain\logs\`

## 7. Download

Scarica Kalsa dal link privato che ti abbiamo mandato. Non condividerlo.

## 8. Disinstallare

**Mac:** trascina Kalsa da Applicazioni al Cestino, poi svuota il Cestino. Per togliere
anche i suoi dati, nel Finder premi **⌘ ⇧ G**, incolla uno per volta questi percorsi e
cancella la cartella:
`~/Library/Application Support/kalsa-brain` (l'AI scaricata, quella grande),
`~/Library/Application Support/ai.kalsa.brain` e `~/Library/Logs/ai.kalsa.brain`.

**Windows:** apri **Impostazioni → App → App installate → Kalsa → Disinstalla**. Per
togliere anche i suoi dati, premi **Windows + R**, incolla uno per volta questi percorsi,
premi Invio e cancella quello che c'è dentro: `%LOCALAPPDATA%\kalsa-brain` (l'AI
scaricata, quella grande), `%APPDATA%\ai.kalsa.brain` e `%LOCALAPPDATA%\ai.kalsa.brain`
(i dati della vista web e i log).
