// Tradotto dal copy inglese approvato.

export const BROWSER = {
  home: "Home",
  searchHere: "Cerca qui",
  attach: "Allega",
  readingFolder: "Lettura della cartella…",
  truncated: "Prime 500 voci della cartella, in ordine alfabetico.",
  skippedEntries: (count: number) => `Impossibile leggere ${count} voci.`,
  notDesktop: "Sfogliare il disco di questo computer è possibile solo nell'app per computer.",
  searchPlaceholder: "Cerca per nome o percorso",
  searchButton: "Cerca",
  searchingIn: (scope: string) => `Ricerca in ${scope}`,
  looking: "…",
  noScope: "Nessuna cartella in cui cercare.",
  viaIndex: "I risultati vengono dall'indice dei file di questo Mac, che salta i file nascosti e alcune cartelle. ",
  skippedSome: (count: number) => `${count} voci che il sistema non mostra sono state saltate. `,
  limited: "Prime 500 voci. Usa parole più precise per trovare le altre.",
  readingFolders: "Lettura delle cartelle di questo computer…",
  folder: "cartella",
};

/**
 * La scheda che una persona è invitata a decidere, e il comando Pausa.
 *
 * **Le due risposte sono tutto.** Il resto dice a una persona che cosa sta per
 * ricevere un sito altrui, quindi si parla della richiesta e non del modello:
 * il pulsante dice che cosa fa alla richiesta.
 */
export const CONFIRM = {
  wantsToSend: (host: string) => `${host} vuole inviare:`,
  /** Said under the host when the request goes over plain `http`. */
  insecure: "Connessione non protetta",
  waiting: "Non è stato ancora inviato niente.",
  allow: "Inviala",
  decline: "Non inviare",
  asking: "Invio…",
  none: "Nessun campo: solo la richiesta.",
  /** Una scheda senza destinazione. Detto al posto di un host: questo computer
   *  non è riuscito a dire dove andrebbe la richiesta, e un nome indovinato
   *  sarebbe l'unica cosa della scheda che non può essere un'ipotesi. */
  nowhere: "Da qualche parte che questo computer non sa dire.",
  nowhereWhy: "Qui non si può inviare niente. Puoi comunque rifiutare.",
  paused: "In pausa",
  resume: "Riprendi",
  pauseHint: "La pausa ferma la prossima azione. Ciò che è già stato inviato non si richiama.",
  runningHint: "In pausa. Kalsa non sta agendo nel browser.",

  /** What became of the request a person just answered, in their own words:
   *  the one thing they are told about it after the card goes. */
  sentTo: (host: string) => `Inviato a ${host}`,
  show: "Mostra",
  hide: "Nascondi",
  notSentNo: "Non inviato — non è stato autorizzato",
  notSentLate: "Non inviato — nessuno ha risposto in tempo",
  notSentGone: "Non inviato — la finestra del browser è stata chiusa",
  notSentHidden: "Non inviato — non era possibile mostrartela",
  unclear: "Non chiaro — potrebbe essere stato inviato",
};
