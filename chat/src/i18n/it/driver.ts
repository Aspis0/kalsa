import type { DRIVER as ENGLISH } from "../en/driver";

// Kalsa è femmina: ogni frase la nomina al singolare.

export const DRIVER: typeof ENGLISH = {
  title: "Browser",
  hint: "Kalsa guida il browser già presente su questo computer. Il suo driver è un download a parte.",
  needed: (size) => `Scarica il driver del browser (${size}).`,
  download: "Scarica",
  downloading: (percent) =>
    percent === null ? "Scarico il driver del browser…" : `Scarico il driver del browser… ${percent}%`,
  ready: "Il driver del browser di Kalsa è pronto.",
  failed: "Kalsa non è riuscita a scaricare il driver del browser. Riprova.",
  retry: "Riprova",
  cancel: "Interrompi il download",
  cancelled: "Il download è stato interrotto. Non è stato installato nulla.",
  note: "Sono circa 40 MB, viene controllato prima di essere usato e Kalsa non lo aggiorna da sola.",
  clearTitle: "Dati del browser",
  clearHint: "Gli accessi e le pagine che il browser di Kalsa ha tenuto.",
  clear: "Cancella i dati del browser di Kalsa",
  cleared: "I dati del browser di Kalsa sono stati cancellati.",
  clearFailed: "Kalsa non è riuscita a cancellare i dati del browser. Non è stato cambiato nulla.",
};