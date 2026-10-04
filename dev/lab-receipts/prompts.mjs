// The three conditions' prompts and the JSON schema (one responsibility: the
// words and the constraint the model sees). A: free text. B/C: the schema.
export const SYSTEM =
  "Sei un estrattore di dati da documenti italiani (scontrini, bollette, distinte). " +
  "Guarda l'immagine e rispondi SOLO con un oggetto JSON, senza testo fuori dal JSON.";

export const FREE_PROMPT =
  "Estrai da questo documento i campi come JSON con queste chiavi, omettendo quelli " +
  "assenti: tipo, esercente, piva, data (ISO), ora, totale, righe [{descrizione, qta, importo}], " +
  "iva, scadenza (ISO), iban, pod, pdr, causale, valuta.";

export const SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "documento",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        tipo: { type: "string", enum: ["scontrino", "bolletta_luce", "bolletta_gas", "bonifico", "bollettino", "ricevuta"] },
        esercente: { type: "string" },
        piva: { type: "string" },
        data: { type: "string" },
        ora: { type: "string" },
        totale: { type: "number" },
        righe: { type: "array", items: { type: "object", additionalProperties: false, properties: {
          descrizione: { type: "string" }, qta: { type: "number" }, importo: { type: "number" } } } },
        iva: { type: "number" },
        scadenza: { type: "string" },
        iban: { type: "string" },
        pod: { type: "string" },
        pdr: { type: "string" },
        causale: { type: "string" },
        valuta: { type: "string" },
      },
    },
  },
};

export const SCHEMA_PROMPT =
  "Estrai da questo documento i campi. Le date in formato ISO (YYYY-MM-DD). " +
  "Gli importi come numeri (virgola decimale letta come punto). " +
  "Trascrivi ESATTAMENTE ciò che è stampato, senza correggere o ricalcolare nulla.";

/** Condition C's single re-ask, naming the failed check. */
export function reaskPrompt(failures) {
  return (
    "Il JSON che hai dato non supera questi controlli: " +
    failures.join("; ") +
    ". Rileggi il documento e ridammi SOLO il JSON corretto. Se un valore proprio non si " +
    "legge, metti null per quel campo."
  );
}
