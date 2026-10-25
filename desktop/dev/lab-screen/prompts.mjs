// The prompts the screen-guide lab sends (one responsibility: what is asked).
// Output is a JSON object the scorer reads; the model never acts on the screen.
export const GRID_CELLS = [
  "top-left", "top-center", "top-right",
  "middle-left", "middle-center", "middle-right",
  "bottom-left", "bottom-center", "bottom-right",
];

const CELLS = GRID_CELLS.join(", ");

export const GUIDE_SYSTEM_IT = [
  "Sei una guida per lo schermo. Guardi la schermata e dici dove cliccare. Non agisci al posto dell'utente.",
  "Rispondi SOLO con un oggetto JSON, senza altro testo:",
  `{"label": "<testo dell'elemento come appare>", "grid": "<una di: ${CELLS}>", "x": <numero 0-1>, "y": <numero 0-1>, "instruction": "<una frase in italiano>"}`,
  'Se l\'elemento non c\'è: {"label": null, "grid": null, "x": null, "y": null, "instruction": "<cosa manca>"}',
].join("\n");

export const GUIDE_SYSTEM_EN = [
  "You are a guide for the screen. You look at the screenshot and say where to click. You never act for the user.",
  "Answer ONLY with a JSON object, no other text:",
  `{"label": "<text of the element as shown>", "grid": "<one of: ${CELLS}>", "x": <number 0-1>, "y": <number 0-1>, "instruction": "<one sentence in English>"}`,
  'If the element is not there: {"label": null, "grid": null, "x": null, "y": null, "instruction": "<what is missing>"}',
].join("\n");

// Second pass: the same question on a 2x crop of the region around the first answer.
export const ZOOM_NOTE_IT = "Questo è un ingrandimento (2×) di una parte dello schermo: x e y sono relativi a questo ingrandimento.";
export const ZOOM_NOTE_EN = "This is a 2× enlargement of part of the screen: x and y are relative to this enlargement.";

export function guideUserIt(goal) {
  return `Obiettivo: ${goal}. Dove devo cliccare?`;
}

export function guideUserEn(goal) {
  return `Goal: ${goal}. Where do I click?`;
}

export const READ_SYSTEM_IT = [
  "Leggi la schermata. Rispondi SOLO con un oggetto JSON, senza altro testo:",
  '{"text": "<il messaggio principale della pagina, copiato parola per parola nella lingua in cui è scritto>"}',
].join("\n");

export const READ_USER_IT = "Cosa dice questa pagina? Copia il messaggio principale parola per parola.";

// Line-by-line variant: the model reads top to bottom and returns every line.
export const READ_LINES_SYSTEM_IT = [
  "Leggi la schermata riga per riga, dall'alto in basso. Rispondi SOLO con un oggetto JSON, senza altro testo:",
  '{"lines": ["<riga 1 copiata parola per parola>", "<riga 2>", "..."]}',
].join("\n");

export const READ_LINES_USER_IT = "Copia ogni riga di testo visibile nella schermata, dall'alto in basso.";
