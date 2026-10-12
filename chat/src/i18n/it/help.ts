import { CHROME } from "./chrome";
import { COMPOSER } from "./composer";
import { HOME } from "./home";
import { SETUP } from "./setup";
import { MACHINE } from "./machine";
import { POWER } from "./power";
import { SIDEBAR } from "./sidebar";
import { SHELL } from "./shell";
import { THREAD } from "./thread";
import { FILES } from "./files";
import { VISION } from "./vision";
import { TOOLS } from "./tools";
import { MINIAPP } from "./miniapp";
import { DEVICES } from "./devices";
import { INVITE } from "./invite";
import { REPORT } from "./report";
import { ROOM } from "./room";
import type { English } from "../en/all";

export const HELP: English["help"] = {
  sections: [
    {
      title: "Cos'è Kalsa",
      paragraphs: ["Kalsa è un assistente AI che funziona sul tuo computer e anche sul telefono. I due lavorano insieme:"],
      items: [
        "Il telefono ha una sua piccola AI, quindi funziona anche a computer spento.",
        "Quando il computer è acceso, il telefono può usare l'AI più grande del computer per rispondere.",
      ],
    },
    {
      title: `La ${CHROME.room}`,
      paragraphs: [`La ${CHROME.room} è una chat di gruppo in cui Kalsa può rispondere.`],
      items: [
        "Tutti scrivono nella stessa conversazione, da un computer o da un telefono.",
        `Scrivi **@Kalsa** in un messaggio, o premi **${ROOM.askKalsa}**, e Kalsa legge la conversazione e risponde.`,
        `Ognuno sceglie un nome per la ${CHROME.room}. Kalsa risponde a una domanda alla volta, in ordine.`,
        "Puoi condividere foto e brevi video.",
      ],
    },
    {
      title: "Per iniziare",
      paragraphs: [],
      items: [
        `Premi **${SETUP.start}**. Kalsa controlla il computer e propone l'AI che funziona meglio.`,
        `Scegli **${MACHINE.smartest}** o **${MACHINE.quickest}**, premi **${SETUP.continue}** e poi conferma il download. Prima ne vedi le dimensioni.`,
        "Poi Kalsa prova il computer per trovare il modo più veloce di usare l'AI. Succede una volta sola.",
        "Se nessuna AI funziona abbastanza bene su questo computer, Kalsa lo dice e non parte.",
      ],
    },
    {
      title: CHROME.home,
      paragraphs: [],
      items: [
        "Il pulsante grande **accende** o **spegne** Kalsa.",
        `**${POWER.onAsleep}**: dopo qualche minuto senza messaggi (5 di default), Kalsa libera la memoria. Il messaggio successivo la riattiva.`,
        `Nella **${CHROME.home}**, **${HOME.details}** apre la pagina **${CHROME.pages.models}**: quale AI usa Kalsa e quanto è veloce. Dalla pagina **${CHROME.pages.devices}** colleghi un telefono.`,
      ],
    },
    {
      title: "Chattare",
      paragraphs: [],
      items: [
        "Scrivi nel riquadro e premi Invio. Maiuscolo+Invio va a capo.",
        `**${SIDEBAR.newChat}** apre una nuova conversazione. **${SHELL.conversations}**, in cima alla chat, elenca quelle passate, che puoi cercare, rinominare o cancellare.`,
        `**${COMPOSER.think}**: Kalsa riflette prima di rispondere. Le risposte sono più lente ma più accurate. Non tutte le AI ce l'hanno.`,
        `**${THREAD.tryAgain}** compare quando una risposta non riesce.`,
        "Kalsa può sbagliare. Controlla le informazioni importanti.",
      ],
    },
    {
      title: "File e immagini",
      paragraphs: [],
      items: [
        "Usa la graffetta, o trascina un file sulla finestra: testo, PDF, Word (.docx), PowerPoint (.pptx), CSV.",
        `Un file viene letto con il tuo prossimo messaggio. Premi la puntina (**${FILES.pinName}**) per tenerlo per tutta la conversazione.`,
        "I PDF scansionati (foto di pagine) per ora non si possono leggere.",
        `Per usare foto e video, Kalsa può prima proporre un piccolo download: **${VISION.offerName}**.`,
      ],
    },
    {
      title: "Ricerca sul web",
      paragraphs: [],
      items: [
        `Kalsa può cercare sul web quando una domanda richiede informazioni aggiornate. Puoi spegnere la ricerca in **${CHROME.settings}**.`,
        "Una ricerca manda su internet solo le parole cercate, o l'indirizzo della pagina da aprire, mai tutta la conversazione.",
        `Se hai allegato un documento, Kalsa prima ti mostra esattamente cosa manderebbe e chiede: **${TOOLS.sendIt}** o **${TOOLS.refuse}**.`,
      ],
    },
    {
      title: "Risposte interattive",
      paragraphs: [`A volte Kalsa costruisce un piccolo strumento dentro la risposta: una **${MINIAPP.named.quick_calculator}**, un **${MINIAPP.named.reading_quiz}**, una **${MINIAPP.named.checklist}** da spuntare o una tabella di **${MINIAPP.named.compare_data}**.`],
      items: [],
    },
    {
      title: "Collegare un telefono",
      paragraphs: [],
      items: [
        `Apri **${CHROME.pages.devices}** e inquadra il quadrato con la fotocamera del telefono. Poi premi **${DEVICES.allow}** sul computer. Mostra il quadrato solo al tuo telefono.`,
        `Per aggiungere qualcuno che non è in casa, usa **${INVITE.inviteByLink}**. Il link funziona una volta e scade.`,
        "Kalsa si può usare da più telefoni. Se fanno una richiesta nello stesso momento, alcuni aspettano il proprio turno.",
      ],
    },
    {
      title: "Se qualcosa non va",
      // Help draws the Report a problem block under this section.
      report: true,
      paragraphs: [
        "Durante l'alpha, Kalsa invia segnalazioni di errore con dettagli tecnici, e il log dell'app quando succede qualcosa di grave. Le tue chat e i tuoi testi non vengono mai inviati. Puoi disattivare l'invio nelle Impostazioni.",
        `Sotto **${REPORT.title}** premi **${REPORT.send}**.`,
      ],
      items: [],
    },
    {
      title: "Perché Kalsa",
      // Its figures are the ones the sources line cites; Help prints it here only.
      cited: true,
      paragraphs: [],
      items: [
        "La maggior parte di ciò che si chiede ai chatbot è aiuto quotidiano: consigli pratici, ricerche e scrittura. Quasi l'80% delle conversazioni su ChatGPT è di questo tipo (studio NBER, settembre 2025).",
        "Per questo non serve un'AI enorme in un data center. Basta una buona AI sul computer che hai già, e le tue chat restano sul tuo computer. Qualcosa può uscirne: le ricerche sul web, un documento che scegli di inviare, le segnalazioni di errore e il controllo degli aggiornamenti.",
        "L'AI di Kalsa può fare da sola solo tre cose: cercare sul web, aprire una pagina e creare una piccola app nella chat. Non può aprire i tuoi file, avviare programmi, installare nulla o mandare messaggi. È anche un'AI piccola, per ora meno capace delle grandi AI online. Quando avrà nuove capacità, le userà in uno spazio chiuso, separato dal resto del computer.",
        "Nel 2024 i data center hanno usato circa 415 TWh di elettricità, circa l'1,5% di quella mondiale, e l'Agenzia Internazionale dell'Energia prevede che più che raddoppi entro il 2030.",
        "La maggior parte dell'impatto di un computer nel corso della sua vita deriva dalla fabbricazione (report di prodotto Dell), e nel 2022 il mondo ha prodotto 62 milioni di tonnellate di rifiuti elettronici (Global E-waste Monitor 2024). Kalsa è pensata per sfruttare il computer che hai già, anche se non è nuovo.",
      ],
    },
  ],
  sources: "Fonti: NBER Working Paper 34255 (2025); IEA, Energy and AI (2025); impronta di carbonio dei prodotti Dell; Global E-waste Monitor 2024.",
};
