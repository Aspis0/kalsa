import { CHROME } from "./chrome";
import { BRAIN_BAR, COMPOSER } from "./composer";
import { SETUP } from "./setup";
import { POWER } from "./power";
import { SIDEBAR } from "./sidebar";
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

// Setup labels end with a full stop for their own sentence; in bold it looks like a typo.
const bare = (label: string) => label.replace(/\.$/, "");

export const HELP: English["help"] = {
  sections: [
    {
      title: "Cos'è Kalsa",
      paragraphs: ["Kalsa è un assistente AI che funziona sul tuo computer. Le tue domande ricevono risposta qui, su questo computer, non sui server di un'azienda. Kalsa vive anche sul tuo telefono. I due lavorano insieme:"],
      items: [
        "Il telefono ha una sua piccola AI, quindi funziona anche a computer spento.",
        "Quando il computer è acceso, il telefono può usarlo come \"cervello\": il computer fa girare un'AI più grande e manda le risposte al telefono.",
      ],
    },
    {
      title: `La ${CHROME.room}`,
      paragraphs: [`La ${CHROME.room} è una chat di gruppo per le persone di casa, con Kalsa come ospite.`],
      items: [
        "Tutti scrivono nella stessa conversazione, dal computer o dal proprio telefono.",
        `Scrivi **@Kalsa** in un messaggio, o premi **${ROOM.askKalsa}**, e Kalsa legge la conversazione e risponde.`,
        `Ognuno sceglie un nome per la ${CHROME.room}. Kalsa risponde a una domanda alla volta, in ordine.`,
        "Potete condividere foto e brevi video.",
      ],
    },
    {
      title: "Per iniziare",
      paragraphs: [],
      items: [
        `Premi **${SETUP.start}**. Kalsa controlla il computer e propone l'AI che ci gira meglio.`,
        `Scegli **${bare(SETUP.smarter)}** o **${bare(SETUP.faster)}**, poi conferma il download. Prima vedi quanto pesa.`,
        "Poi Kalsa prova il computer per trovare il modo più veloce di farla girare. Succede una volta sola.",
        "Se nessuna AI gira abbastanza bene su questo computer, Kalsa te lo dice e non parte.",
      ],
    },
    {
      title: CHROME.home,
      paragraphs: [],
      items: [
        "Il pulsante grande **accende** o **spegne** Kalsa.",
        `**${POWER.onAsleep}**: dopo qualche minuto senza messaggi (5 di default) Kalsa si riposa per liberare memoria. Il messaggio successivo la risveglia.`,
        `Tre pagine sotto **${BRAIN_BAR.thisComputer}**: **${CHROME.pages.models}** (quale AI usa Kalsa, e quanto è veloce), **${CHROME.pages.server}** (velocità e telefoni collegati), **${CHROME.pages.devices}** (collegare un telefono).`,
      ],
    },
    {
      title: "Chattare",
      paragraphs: [],
      items: [
        "Scrivi nel riquadro e premi Invio. Maiuscolo+Invio va a capo.",
        `**${SIDEBAR.newChat}** apre una conversazione nuova. Le chat passate sono nell'elenco a sinistra: puoi cercarle, rinominarle o cancellarle.`,
        `**${COMPOSER.think}**: Kalsa ragiona prima di rispondere. Le risposte sono più lente ma più ponderate. Non tutte le AI ce l'hanno.`,
        `**${THREAD.tryAgain}** compare quando una risposta non va a buon fine.`,
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
        `Foto e video funzionano solo con un'AI che vede. Se la tua può, Kalsa può proporti prima un piccolo download: **${VISION.offerName}**. Di un video Kalsa vede alcuni fotogrammi.`,
      ],
    },
    {
      title: "Ricerca sul web",
      paragraphs: [],
      items: [
        `Kalsa può cercare sul web quando una domanda ha bisogno di informazioni aggiornate. Puoi spegnerlo in **${CHROME.settings}**.`,
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
        "Fino a quattro telefoni possono ricevere risposte nello stesso momento.",
      ],
    },
    {
      title: "Se qualcosa non va",
      paragraphs: ["Durante l'alpha, Kalsa invia segnalazioni degli errori con dettagli tecnici (quale AI, il processore e la scheda grafica del computer e l'uso della memoria) per aiutarci a risolvere i problemi. Mai le tue chat o il tuo testo. Puoi disattivarle nelle Impostazioni."],
      items: [
        `Nella pagina **${CHROME.pages.models}**, **${REPORT.title}** → **${REPORT.send}**. Il registro non contiene mai i tuoi messaggi, le risposte di Kalsa, i tuoi file, né codici o chiavi. Ricevi un numero da comunicarci.`,
      ],
    },
    {
      title: "Perché Kalsa",
      paragraphs: [],
      items: [
        "Quasi tutto quello che si chiede ai chatbot è aiuto quotidiano: consigli pratici, cercare informazioni, scrivere. Quasi l'80% delle conversazioni su ChatGPT è di questo tipo (studio NBER, settembre 2025).",
        "Per questo tipo di aiuto non serve un'AI gigante in un data center. Una buona AI sul computer che hai già può farlo, e le tue conversazioni restano in casa: possono uscire le parole delle ricerche sul web e le segnalazioni tecniche degli errori.",
        "Nel 2024 i data center hanno usato circa 415 TWh di elettricità, circa l'1,5% di quella mondiale, e l'Agenzia Internazionale dell'Energia prevede che più che raddoppi entro il 2030.",
        "La maggior parte dell'impatto di un computer nella sua vita viene dalla sua fabbricazione (report di prodotto Dell), e nel 2022 il mondo ha prodotto 62 milioni di tonnellate di rifiuti elettronici (Global E-waste Monitor 2024). Kalsa prova a usare bene il computer che hai già, anche se non è nuovo.",
      ],
    },
  ],
  sources: "Fonti: NBER Working Paper 34255 (2025); IEA, Energy and AI (2025); impronta di carbonio dei prodotti Dell; Global E-waste Monitor 2024.",
};
