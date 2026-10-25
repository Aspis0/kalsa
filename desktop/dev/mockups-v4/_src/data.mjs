// Plain-language content shared by the three simple directions.

export const AI = { name: 'Qwen 3.6', by: 'Alibaba', space: '21' };
export const ALT = { name: 'Gemma 4 E4B', by: 'Google', space: '5' };

export const CHATS = [
  'Mutuo: fisso o variabile',
  'Email to the landlord',
  'Ricetta pane senza lievito',
  'Viaggio a Lisbona in maggio',
  'Translate the insurance letter',
];

export const CHAT = {
  title: 'Mutuo: fisso o variabile',
  q1: 'Fra un mutuo a tasso fisso e uno a tasso variabile, quale conviene oggi?',
  search: 'tassi mutuo fisso variabile ottobre 2026',
  sources: [
    { site: 'bancaditalia.it' },
    { site: 'mutuionline.it' },
    { site: 'ilsole24ore.com' },
  ],
  a1intro: 'Dipende da quanto vuoi sentirti tranquillo ogni mese. In sintesi:',
  a1bullets: [
    '<b>Tasso fisso</b>: la rata resta uguale per tutta la durata, anche se i tassi salgono.',
    '<b>Tasso variabile</b>: di solito parte più basso, ma la rata segue l’<b>Euribor</b> e può crescere.',
    'Se il bilancio familiare è stretto, il fisso ti protegge dagli aumenti.',
  ],
  a1outro: 'Prima di firmare, confronta il <b>TAEG</b> delle due offerte, non solo il tasso nominale.',
  q2: 'E se invece lavoro come autonomo e il reddito cambia ogni anno?',
  a2: 'Con un reddito che cambia, conta soprattutto la rata nei mesi peggiori. Per questo il <b>tasso fisso</b> di solito è la scelta più prudente',
};

export const NOTES = [
  'Answers start sooner after you turn Kalsa on.',
  'If Kalsa won’t write a story, it now tries again.',
  'Fixed: a download could stop at 99%.',
];
