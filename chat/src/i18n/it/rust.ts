// Tradotto dal copy inglese approvato.

export const RUST: {
  startup: Record<string, (params: Record<string, unknown>, tag: string) => string>;
  choice: Record<string, (params: Record<string, unknown>, tag: string) => string>;
  app: Record<string, (params: Record<string, unknown>, tag: string) => string>;
} = {
  startup: {
    cannot_run_yet: () => "Kalsa non può ancora girare su questo computer. Controlla se c'è un aggiornamento dell'app.",
    no_suitable_choice: () => "Kalsa non ha ancora un'AI che giri bene su questo computer. Controlla se c'è un aggiornamento dell'app.",
    connection_lost: () => "Kalsa non ha potuto scaricare quello che le serve. Controlla la connessione e riprova.",
    network_blocks_download: () => "Kalsa non ha potuto scaricare quello che le serve su questa rete. Prova un'altra rete.",
    download_failed: () => "Kalsa non ha finito di scaricare. Riprova più tardi.",
    needs_check: () => "Kalsa deve controllare questo computer prima di poter partire. Riprova.",
    choice_too_large: () => "Questa AI è troppo grande per questo computer. Scegline una più piccola nella pagina AI.",
    choice_unavailable: () => "Kalsa non è riuscita a partire con questa AI. Scegline un'altra nella pagina AI.",
    conversation_too_long: () => "Questa lunghezza della conversazione è troppo per questa AI. Scegline una più piccola nelle Avanzate.",
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
    stopped: () => "Kalsa si è fermata da sola. Riaccendila.",
    took_too_long: () => "Kalsa ha messo troppo tempo a prepararsi. Riprova.",
    stop_unconfirmed: () => "Kalsa potrebbe essere ancora accesa. Riavvia questo computer per spegnerla.",
    already_starting: () => "Kalsa sta già partendo. Aspetta un momento.",
  },
  choice: {
    save_failed: () => "Kalsa non ha potuto salvare questa scelta. Riprova.",
  },
  app: {
    unexpected: () => "Kalsa non è riuscita a farlo. Riprova.",
  },
};
