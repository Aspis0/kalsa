// La risposta a un invio bloccato, al posto di quella del modello.

export const CONTENT_FILTER = {
  selfHarm:
    "Non posso aiutare con istruzioni di autolesionismo. Se è urgente, contatta i servizi di emergenza locali o una linea di ascolto ora.",
  sexualAbuse: "Non posso aiutare con contenuti di abuso o sfruttamento sessuale.",
  unsafeScience: "Non posso aiutare con istruzioni biologiche o chimiche pericolose.",
  privacy: "Non posso aiutare a estrarre o esporre segreti, credenziali o dati personali.",
  promptInjection: "Non posso aiutare ad aggirare le istruzioni dell'app, del modello o di sicurezza.",
  illegalActivity: "Non posso aiutare con istruzioni per attività illegali o dannose.",
  generic: "Non posso aiutare con questo. Mantieni la chat su argomenti sicuri e quotidiani.",
};
