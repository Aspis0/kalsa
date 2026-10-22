// Tradotto dal copy inglese approvato.

export const RUST: {
  startup: Record<string, (params: Record<string, unknown>, tag: string) => string>;
  choice: Record<string, (params: Record<string, unknown>, tag: string) => string>;
  app: Record<string, (params: Record<string, unknown>, tag: string) => string>;
  invite: Record<string, (params: Record<string, unknown>, tag: string) => string>;
  pairing: Record<string, (params: Record<string, unknown>, tag: string) => string>;
  update: Record<string, (params: Record<string, unknown>, tag: string) => string>;
  road: Record<string, (params: Record<string, unknown>, tag: string) => string>;
  files: Record<string, (params: Record<string, unknown>, tag: string) => string>;
  vision: Record<string, (params: Record<string, unknown>, tag: string) => string>;
  web: Record<string, (params: Record<string, unknown>, tag: string) => string>;
  browser: Record<string, (params: Record<string, unknown>, tag: string) => string>;
} = {
  startup: {
    cannot_run_yet: () => "Per ora Kalsa non può funzionare su questo computer. Cerca un aggiornamento dell'app.",
    no_suitable_choice: () => "Kalsa non ha ancora un'AI che funzioni bene su questo computer. Cerca un aggiornamento dell'app.",
    connection_lost: () => "Kalsa non è riuscita a scaricare i file necessari. Controlla la connessione e riprova.",
    network_blocks_download: () => "Kalsa non è riuscita a scaricare i file necessari su questa rete. Prova con un'altra rete.",
    download_failed: () => "Kalsa non è riuscita a finire il download. Riprova più tardi.",
    needs_check: () => "Kalsa deve controllare questo computer prima di poter partire. Riprova.",
    choice_too_large: () => "Questa AI è troppo grande per questo computer. Scegline una più piccola in «La tua AI».",
    choice_unavailable: () => "Kalsa non è riuscita a partire con questa AI. Scegline un'altra in «La tua AI».",
    conversation_too_long: () => "Questa AI non regge conversazioni così lunghe. Apri una nuova chat, oppure riduci «Dimensione del contesto» in La tua AI → Per esperti → Impostazioni del server.",
    check_failed: () => "Kalsa non è riuscita a controllare questo computer. Aspetta un momento e riprova.",
    could_not_start: () => "Kalsa non è riuscita a partire. Riprova.",
    awaiting_choice: () => "Kalsa non è ancora pronta. Vai alla Home e premi Avvia.",
    disk_full: (params, tag) =>
      typeof params.gb === "number"
        ? `A Kalsa serve più spazio. Libera ${new Intl.NumberFormat(tag, {
            minimumFractionDigits: 0,
            maximumFractionDigits: 1,
          }).format(params.gb)} GB e riprova.`
        : "A Kalsa serve più spazio. Libera un po' di spazio e riprova.",
    restart: () => "Kalsa non è riuscita a partire. Riavvia questo computer e riprova.",
    stopped: () => "Kalsa si è fermata inaspettatamente. Riaccendila.",
    took_too_long: () => "Kalsa ha impiegato troppo tempo a prepararsi. Riprova.",
    stop_unconfirmed: () => "Kalsa potrebbe essere ancora accesa. Riavvia questo computer per spegnerla.",
    already_starting: () => "Kalsa sta già partendo. Aspetta un momento.",
  },
  choice: {
    save_failed: () => "Kalsa non è riuscita a salvare questa scelta. Riprova.",
  },
  app: {
    unexpected: () => "Kalsa non è riuscita a farlo. Riprova.",
  },
  invite: {
    "invite.no_road": () => "Gli inviti richiedono un collegamento via internet. Attiva «Collegamento via internet» in La tua AI → Per esperti → Impostazioni del server.",
    "invite.full": () => "Hai raggiunto il numero massimo di inviti. Annullane uno per crearne uno nuovo.",
    "invite.could_not_make": () => "Kalsa non è riuscita a creare l'invito. Riprova.",
    "invite.could_not_save": () => "Kalsa non è riuscita a salvare l'invito. Riprova.",
    "invite.expired": () => "Questo invito è scaduto. Fanne uno nuovo.",
  },
  pairing: {
    "pairing.save_failed": () => "Kalsa non è riuscita a salvare questa modifica. Riprova.",
    "pairing.phone_with_ai": (params) =>
      typeof params.gb === "number" && Number.isFinite(params.gb) && params.gb > 0
        ? "Telefono con un'AI propria"
        : "Telefono senza un'AI propria",
    "pairing.phone_without_ai": () => "Telefono senza un'AI propria",
    "pairing.host_forget": () => "La connessione di questo computer non può essere rimossa.",
  },
  update: {
    check_failed: () => "Kalsa non è riuscita a cercare aggiornamenti. Riprova più tardi.",
    download_failed: () => "Kalsa non è riuscita a scaricare l'aggiornamento. Riprova.",
    signature_failed: () => "Impossibile verificare l'aggiornamento, quindi Kalsa non l'ha installato.",
    install_failed: () => "Kalsa non è riuscita a installare l'aggiornamento. Riprova.",
    busy: () => "Kalsa si sta avviando. Riprova quando è pronta.",
    up_to_date: () => "Kalsa è già aggiornata.",
    replying: () => "Kalsa sta scrivendo una risposta. Installa l'aggiornamento quando ha finito.",
    changed: () => "L'aggiornamento è cambiato dopo il controllo. Cerca di nuovo.",
  },
  road: {
    off: () => "Il collegamento via internet è disattivato. Il telefono si collega tramite Tailscale.",
    waiting: () => "Il collegamento via internet attende che Kalsa sia accesa.",
    opening: () => "Il collegamento via internet si sta aprendo.",
    open: () => "Il collegamento via internet è attivo.",
    unavailable: () => "Il collegamento via internet non è riuscito ad aprirsi su questo computer.",
  },
  files: {
    list_failed: () => "Kalsa non riesce ad aprire questa cartella. Scegline un'altra.",
    not_found: () => "Kalsa non trova questo file. Scegline un altro.",
    permission_denied: () => "Kalsa non ha il permesso di aprire questo file. Scegline un altro.",
    unsupported: () => "Kalsa non riesce ad aprire questo file. Scegline un altro.",
    is_folder: () => "È una cartella. Scegli un file al suo interno.",
    too_large: (params) =>
      typeof params.limit === "string"
        ? `Questo file è troppo grande (limite ${params.limit}). Prova uno più piccolo.`
        : "Questo file è troppo grande. Prova uno più piccolo.",
  },
  vision: {
    does_not_fit: () => "Su questo computer non c'è abbastanza memoria perché questa AI veda le immagini.",
    busy: () => "Kalsa sta già preparando il supporto per le immagini. Aspetta un momento.",
    none: () => "Il supporto per le immagini non è disponibile per questa AI.",
  },
  web: {
    page_too_long: () => "La pagina è troppo lunga per essere letta da Kalsa.",
    search_failed: () => "Kalsa non è riuscita a cercare sul web. Riprova.",
    page_failed: () => "Kalsa non è riuscita ad aprire quella pagina. Riprova.",
    open_failed: () => "Questo computer non è riuscito ad aprire il link.",
  },
  browser: {
    unsupported_platform: () => "Questo computer non ha un browser che Kalsa possa usare.",
    busy: () => "Kalsa sta già usando il browser. Riprova tra un momento.",
    cancelled: () => "Il download è stato interrotto. Non è stato installato nulla.",
    download_failed: () => "Kalsa non è riuscita a scaricare il driver del browser. Riprova.",
    driver_corrupt: () => "Il driver del browser è danneggiato, Kalsa non ha installato nulla.",
    driver_changed: () => "Il driver del browser sul disco non è quello che Kalsa ha installato.",
    unpack_failed: () => "Il driver del browser non si è decompresso in qualcosa di utilizzabile.",
    storage: () => "Kalsa non è riuscita a leggere o scrivere la propria cartella.",
    failed: () => "Kalsa non è riuscita a raggiungere il browser. Riprova.",
    refused: () => "Kalsa non ha voluto aprire quella cosa.",
    no_pending_request: () => "Quella richiesta non sta piu aspettando una risposta.",
    read_again: () => "Kalsa aveva già letto quella parte della pagina.",
  },
};