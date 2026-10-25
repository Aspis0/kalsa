// The four conditions' prompts and the JSON schema (one responsibility: the
// words and the constraint the model sees). A and B differ ONLY by the
// response_format constraint: FREE_PROMPT and SCHEMA_PROMPT are the SAME
// words (SCHEMA_PROMPT adds nothing but the null rule, which free-text JSON
// can obey equally). Every schema property is REQUIRED and typed [T, "null"],
// so the grammar cannot close the object after one field, and "null se non si
// legge" is legal to obey. additionalProperties stays false.
export const SYSTEM =
  "Sei un estrattore di dati da documenti italiani (scontrini, bollette, distinte). " +
  "Guarda l'immagine e rispondi SOLO con un oggetto JSON, senza testo fuori dal JSON.";

// The one instruction body both free text and the schema see, verbatim.
export const PROMPT_BODY =
  "Estrai da questo documento i campi come JSON con ESATTAMENTE queste chiavi, tutte " +
  "presenti: tipo, esercente, piva, data, ora, totale, righe, iva, scadenza, iban, pod, " +
  "pdr, causale, valuta. " +
  "tipo è uno di questi sei valori: scontrino, bolletta_luce, bolletta_gas, bonifico, " +
  "bollettino, ricevuta. " +
  "Le date in formato ISO (YYYY-MM-DD). Gli importi come numeri (la virgola decimale " +
  "letta come punto). righe è un array di oggetti {descrizione, qta, importo}, uno per " +
  "riga stampata del documento. " +
  "Trascrivi ESATTAMENTE ciò che è stampato, senza correggere o ricalcolare nulla. " +
  "Se un campo proprio non si legge o non esiste su questo documento, scrivi null.";

export const FREE_PROMPT = PROMPT_BODY;
export const SCHEMA_PROMPT = PROMPT_BODY;

const nullable = (type) => ({ type: [type, "null"] });

export const SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "documento",
    schema: {
      type: "object",
      additionalProperties: false,
      required: [
        "tipo", "esercente", "piva", "data", "ora", "totale", "righe", "iva",
        "scadenza", "iban", "pod", "pdr", "causale", "valuta",
      ],
      properties: {
        // The enum pins the one field the REQUIRED-set derivation reads; null
        // stays legal so an unreadable document can still obey the schema.
        tipo: { enum: ["scontrino", "bolletta_luce", "bolletta_gas", "bonifico", "bollettino", "ricevuta", null] },
        esercente: nullable("string"),
        piva: nullable("string"),
        data: nullable("string"),
        ora: nullable("string"),
        totale: nullable("number"),
        righe: {
          type: ["array", "null"],
          items: {
            type: "object",
            additionalProperties: false,
            required: ["descrizione", "qta", "importo"],
            properties: {
              descrizione: nullable("string"),
              qta: nullable("number"),
              importo: nullable("number"),
            },
          },
        },
        iva: nullable("number"),
        scadenza: nullable("string"),
        iban: nullable("string"),
        pod: nullable("string"),
        pdr: nullable("string"),
        causale: nullable("string"),
        valuta: nullable("string"),
      },
    },
  },
};

/** Condition C/D's single re-ask, naming the failed check. Null is legal now,
    so the instruction can be obeyed under the grammar as well. */
export function reaskPrompt(failures) {
  return (
    "Il JSON che hai dato non supera questi controlli: " +
    failures.join("; ") +
    ". Rileggi il documento e ridammi SOLO il JSON, con TUTTE le chiavi richieste, " +
    "trascrivendo esattamente ciò che è stampato (null solo dove il campo non esiste " +
    "o non si legge proprio)."
  );
}
