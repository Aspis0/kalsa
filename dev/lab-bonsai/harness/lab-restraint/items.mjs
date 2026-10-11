// The item set (one responsibility: what to ask, and what restraint looks
// like). The owner writes Italian; prompts mix Italian and English as the
// owner's days do. kind: should_call (expected template) / should_not /
// borderline (scored apart, never in the rates).
export const ITEMS = [
  // --- should_not: plain conversation, a mini app would be silly ---
  { id: "greet-ciao", kind: "should_not", lang: "it", prompt: "Ciao!" },
  { id: "greet-howareyou", kind: "should_not", lang: "it", prompt: "Come stai? Tutto bene?" },
  { id: "greet-night", kind: "should_not", lang: "it", prompt: "Grazie per oggi, buonanotte!" },
  { id: "def-photovoltaic", kind: "should_not", lang: "it", prompt: "Che cos'è il fotovoltaico? Spiegalo in due righe." },
  { id: "def-photosynthesis", kind: "should_not", lang: "en", prompt: "What is photosynthesis, in one short paragraph?" },
  { id: "fact-eiffel", kind: "should_not", lang: "it", prompt: "Quanto è alta la Torre Eiffel?" },
  { id: "fact-promessisposi", kind: "should_not", lang: "it", prompt: "Chi ha scritto I Promessi Sposi?" },
  { id: "opinion-coffee", kind: "should_not", lang: "it", prompt: "Secondo te è meglio il caffè o il tè? Dimmi la tua." },
  { id: "opinion-film", kind: "should_not", lang: "it", prompt: "Consigliami un film da stasera, qualcosa di leggero." },
  { id: "trans-de", kind: "should_not", lang: "en", prompt: "How do you say 'thank you very much' in German?" },
  { id: "trans-en", kind: "should_not", lang: "it", prompt: "Come si dice 'ponte' in inglese?" },
  { id: "spiegami-accento", kind: "should_not", lang: "it", prompt: "Spiegami la differenza tra accento acuto e grave in italiano." },
  { id: "tips-sleep", kind: "should_not", lang: "it", prompt: "Dammi 3 consigli per dormire meglio." },
  { id: "joke", kind: "should_not", lang: "it", prompt: "Raccontami una barzelletta breve." },

  // --- should_call: checklist ---
  { id: "cl-weekend", kind: "should_call", expected: "checklist", lang: "it", prompt: "Preparami una lista per i bagagli di un weekend fuori, una che posso spuntare?" },
  { id: "cl-mare-bambini", kind: "should_call", expected: "checklist", lang: "it", prompt: "Fammi una checklist per partire al mare con i bambini." },
  { id: "cl-hiking", kind: "should_call", expected: "checklist", lang: "en", prompt: "Make me a tickable packing list for a two-day hiking trip." },

  // --- should_call: quick_calculator ---
  { id: "qc-conto", kind: "should_call", expected: "quick_calculator", lang: "it", prompt: "Dividi un conto di 86,40 € in 4 persone, con il 15% di mancia. Voglio poter cambiare i numeri." },
  { id: "qc-mutuo", kind: "should_call", expected: "quick_calculator", lang: "it", prompt: "Calcolami la rata di un mutuo da 180000 € a 25 anni con interesse al 3,4%. Fammela vedere come calcolatrice così provo altri importi." },
  { id: "qc-miglia", kind: "should_call", expected: "quick_calculator", lang: "it", prompt: "Vorrei una calcolatrice che converte miglia in km, con il numero modificabile." },
  { id: "qc-tip", kind: "should_call", expected: "quick_calculator", lang: "en", prompt: "Build me a small tip calculator where I can edit the bill and the tip percent." },

  // --- should_call: compare_data ---
  { id: "cd-telefoni", kind: "should_call", expected: "compare_data", lang: "it", prompt: "Confrontami iPhone 15, Pixel 8 e Galaxy S24 su prezzo, batteria e peso, in una tabella ordinabile." },
  { id: "cd-piani", kind: "should_call", expected: "compare_data", lang: "it", prompt: "Mettimi a confronto 3 piani telefonici in una tabella: costo mensile, GB, minuti." },
  { id: "cd-cereali", kind: "should_call", expected: "compare_data", lang: "en", prompt: "Compare rice, pasta and couscous on calories, protein and price in a sortable table." },

  // --- should_call: reading_quiz ---
  { id: "qz-capitali-eu", kind: "should_call", expected: "reading_quiz", lang: "it", prompt: "Mettimi alla prova con un quiz: 5 domande sulle capitali europee, a scelta multipla." },
  { id: "qz-capitali-mondo", kind: "should_call", expected: "reading_quiz", lang: "it", prompt: "Creami un quiz su 5 capitali del mondo, con le risposte." },
  { id: "qz-capitals-en", kind: "should_call", expected: "reading_quiz", lang: "en", prompt: "Quiz me on 5 world capitals, multiple choice, and tell me the answers." },

  // --- borderline: defensible either way, scored apart ---
  { id: "bl-spesa", kind: "borderline", lang: "it", prompt: "Lista della spesa: latte, pane, uova, e ricordami il detersivo." },
  { id: "bl-cento", kind: "borderline", lang: "it", prompt: "Quanto fa da 100 a 250?" },
  { id: "bl-cena", kind: "borderline", lang: "it", prompt: "Aiutami a organizzare una cena per 8 persone sabato." },
  { id: "bl-treno", kind: "borderline", lang: "it", prompt: "Confronto veloce: treno o aereo per Roma-Milano? Pro e contro in breve." },
];

export const SMOKE_IDS = ["greet-ciao", "qc-conto", "cd-telefoni"];

export function itemFor(id) {
  const item = ITEMS.find((i) => i.id === id);
  if (!item) throw new Error(`no item ${id}`);
  return item;
}
