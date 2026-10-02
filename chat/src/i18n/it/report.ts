// Tradotto dal copy inglese approvato.

export const REPORT = {
  title: "Segnala un problema",
  privacy: "Il log non contiene mai i tuoi messaggi, le risposte di Kalsa, i tuoi file, né codici o chiavi.",
  facts:
    "Contiene cosa ha fatto Kalsa e cosa ha questo computer: versioni, processore, scheda grafica, memoria, errori.",
  send: "Invia il log",
  open: "Apri la cartella dei log",
  openFailed: "Kalsa non riesce ad aprire la cartella dei log.",
  sending: "Invio…",
  sentWithId: (id: string) => `Inviato. Il numero della tua segnalazione è ${id}: dicci questo numero.`,
  errRateLimited: "Aspetta un minuto e riprova.",
  errTryTomorrow: "Oggi abbiamo ricevuto troppe segnalazioni. Riprova domani.",
  errSend: "Impossibile inviare. Controlla la connessione e riprova.",
  crashTitle: "Qualcosa è andato storto",
  crashUncleanTitle: "Kalsa non si è chiusa normalmente l'ultima volta",
  crashUncleanBody: "Se qualcosa è andato storto, inviare il log ci aiuta a correggerlo.",
  notNow: "Non ora",
};
