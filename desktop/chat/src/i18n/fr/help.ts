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
      title: "Ce qu'est Kalsa",
      paragraphs: ["Kalsa est une assistante IA qui fonctionne sur ton ordinateur et aussi sur ton téléphone. Les deux travaillent ensemble :"],
      items: [
        "Le téléphone a sa propre petite IA, donc il fonctionne même quand l'ordinateur est éteint.",
        "Quand l'ordinateur est allumé, le téléphone peut utiliser la plus grande IA de l'ordinateur pour répondre.",
      ],
    },
    {
      title: `Le ${CHROME.room}`,
      paragraphs: [`Le ${CHROME.room} est une discussion de groupe où Kalsa peut répondre.`],
      items: [
        "Tout le monde écrit dans la même conversation, depuis un ordinateur ou un téléphone.",
        `Écris **@Kalsa** dans un message, ou appuie sur **${ROOM.askKalsa}**, et Kalsa lit la conversation et répond.`,
        `Chacun choisit un nom pour le ${CHROME.room}. Kalsa répond à une question à la fois, dans l'ordre.`,
        "Tu peux partager des photos et de courtes vidéos.",
      ],
    },
    {
      title: "Pour commencer",
      paragraphs: [],
      items: [
        `Appuie sur **${SETUP.start}**. Kalsa vérifie ton ordinateur et propose l'IA qui y fonctionne le mieux.`,
        `Choisis **${MACHINE.smartest}** ou **${MACHINE.quickest}**, appuie sur **${SETUP.continue}**, puis confirme le téléchargement. Tu en vois d'abord la taille.`,
        "Ensuite, Kalsa teste l'ordinateur pour trouver la façon la plus rapide d'utiliser l'IA. Cela n'arrive qu'une fois.",
        "Si aucune IA ne fonctionne assez bien sur cet ordinateur, Kalsa le dit et ne démarre pas.",
      ],
    },
    {
      title: CHROME.home,
      paragraphs: [],
      items: [
        "Le gros bouton **allume** ou **éteint** Kalsa.",
        `**${POWER.onAsleep}** : après quelques minutes sans message (5 par défaut), Kalsa libère de la mémoire. Ton prochain message la réactive.`,
        `**${HOME.details}** sur **${CHROME.home}** ouvre **${CHROME.pages.models}** : quelle IA Kalsa utilise et à quelle vitesse. **${CHROME.pages.devices}** connecte un téléphone.`,
      ],
    },
    {
      title: "Discuter",
      paragraphs: [],
      items: [
        "Écris dans la zone de saisie et appuie sur Entrée. Maj+Entrée passe à la ligne.",
        `**${SIDEBAR.newChat}** démarre une conversation. **${SHELL.conversations}**, en haut du chat, liste tes discussions passées, que tu peux rechercher, renommer ou supprimer.`,
        `**${COMPOSER.think}** : Kalsa réfléchit avant de répondre. Les réponses sont plus lentes mais plus soignées. Toutes les IA ne l'ont pas.`,
        `**${THREAD.tryAgain}** apparaît quand une réponse échoue.`,
        "Kalsa peut se tromper. Vérifie les informations importantes.",
      ],
    },
    {
      title: "Fichiers et images",
      paragraphs: [],
      items: [
        "Utilise le trombone, ou glisse un fichier sur la fenêtre : texte, PDF, Word (.docx), PowerPoint (.pptx), CSV.",
        `Un fichier est lu avec ton prochain message. Clique sur la punaise (**${FILES.pinName}**) pour le garder pendant toute la conversation.`,
        "Les PDF numérisés (photos de pages) ne peuvent pas encore être lus.",
        `Pour utiliser des photos et des vidéos, Kalsa peut d'abord proposer un petit téléchargement : **${VISION.offerName}**.`,
      ],
    },
    {
      title: "Recherche web",
      paragraphs: [],
      items: [
        `Kalsa peut chercher sur le web quand une question demande une information récente. Tu peux le désactiver dans **${CHROME.settings}**.`,
        "Une recherche n'envoie que les mots recherchés, ou l'adresse de la page à ouvrir, jamais toute ta conversation.",
        `Si tu as joint un document, Kalsa te montre d'abord exactement ce qu'elle enverrait et demande : **${TOOLS.sendIt}** ou **${TOOLS.refuse}**.`,
      ],
    },
    {
      title: "Réponses interactives",
      paragraphs: [`Parfois Kalsa crée un petit outil dans la réponse. Par exemple : **${MINIAPP.named.quick_calculator}**, **${MINIAPP.named.reading_quiz}**, **${MINIAPP.named.checklist}** ou **${MINIAPP.named.compare_data}**.`],
      items: [],
    },
    {
      title: "Connecter un téléphone",
      paragraphs: [],
      items: [
        `Ouvre **${CHROME.pages.devices}** et pointe l'appareil photo du téléphone vers le carré. Appuie ensuite sur **${DEVICES.allow}** sur l'ordinateur. Ne montre le carré qu'à ton propre téléphone.`,
        `Pour ajouter quelqu'un qui n'est pas à la maison, utilise **${INVITE.inviteByLink}**. Le lien ne fonctionne qu'une fois et expire.`,
        "Plusieurs téléphones peuvent utiliser Kalsa. S'ils demandent en même temps, certains attendent leur tour.",
      ],
    },
    {
      title: "Si quelque chose ne va pas",
      // Help draws the Report a problem block under this section.
      report: true,
      paragraphs: [
        "Pendant l'alpha, Kalsa envoie des rapports d'erreur avec des détails techniques et, quand quelque chose de grave se produit, le journal de l'application. Tes discussions et tes textes ne sont jamais envoyés. Tu peux le désactiver dans les Réglages.",
        `Sous **${REPORT.title}**, appuie sur **${REPORT.send}**.`,
      ],
      items: [],
    },
    {
      title: "Pourquoi Kalsa",
      // Its figures are the ones the sources line cites; Help prints it here only.
      cited: true,
      paragraphs: [],
      items: [
        "La plupart de ce que les gens demandent aux chatbots relève de l'aide du quotidien : conseils pratiques, recherches et écriture. Près de 80 % des conversations de ChatGPT sont de ce type (étude NBER, septembre 2025).",
        "Pour cela, pas besoin d'une IA géante dans un data center. Une bonne IA sur l'ordinateur que tu as déjà suffit, et tes discussions y restent. Certaines choses peuvent en sortir : les recherches web, un document que tu choisis d'envoyer, les rapports d'erreur et la vérification des mises à jour.",
        "L'IA de Kalsa ne peut faire seule que trois choses : chercher sur le web, ouvrir une page et créer une petite app dans la discussion. Elle ne peut pas ouvrir tes fichiers, lancer des programmes, installer quoi que ce soit ni envoyer des messages. C'est aussi une petite IA, pour l'instant moins capable que les grandes IA en ligne. Quand elle aura de nouvelles capacités, elle les utilisera dans un espace fermé, séparé du reste de l'ordinateur.",
        "En 2024, les data centers ont consommé environ 415 TWh d'électricité, soit environ 1,5 % de l'électricité mondiale, et l'Agence internationale de l'énergie prévoit que ce chiffre plus que double d'ici 2030.",
        "L'essentiel de l'empreinte d'un ordinateur sur toute sa vie vient de sa fabrication (rapports produits Dell), et en 2022 le monde a produit 62 millions de tonnes de déchets électroniques (Global E-waste Monitor 2024). Kalsa est conçue pour tirer parti de l'ordinateur que tu possèdes déjà, même s'il n'est pas neuf.",
      ],
    },
  ],
  sources: "Sources : NBER Working Paper 34255 (2025) ; AIE, Energy and AI (2025) ; empreinte carbone des produits Dell ; Global E-waste Monitor 2024.",
};
