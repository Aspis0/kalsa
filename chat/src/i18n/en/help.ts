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


export const HELP = {
  sections: [
    {
      title: "What Kalsa is",
      paragraphs: ["Kalsa is an AI assistant that runs on your computer and also on your phone. The two work together:"],
      items: [
        "The phone has its own small AI, so it works even when the computer is off.",
        "When the computer is on, the phone can use the computer’s bigger AI to answer.",
      ],
    },
    {
      title: `The ${CHROME.room}`,
      paragraphs: [`The ${CHROME.room} is a group chat where Kalsa can answer.`],
      items: [
        "Everyone writes in the same conversation, from a computer or a phone.",
        `Write **@Kalsa** in a message, or press **${ROOM.askKalsa}**, and Kalsa reads the conversation and answers.`,
        `Each person picks a name for the ${CHROME.room}. Kalsa answers one question at a time, in order.`,
        "You can share pictures and short videos.",
      ],
    },
    {
      title: "Getting started",
      paragraphs: [],
      items: [
        `Press **${SETUP.start}**. Kalsa checks your computer and suggests the AI that runs best on it.`,
        `Pick **${MACHINE.smartest}** or **${MACHINE.quickest}**, press **${SETUP.continue}**, then confirm the download. Its size is shown first.`,
        "Kalsa then tests the computer to find the fastest way to run the AI. This happens only once.",
        "If no AI runs well enough on this computer, Kalsa says so and does not start.",
      ],
    },
    {
      title: CHROME.home,
      paragraphs: [],
      items: [
        "The big button turns Kalsa **on** or **off**.",
        `**${POWER.onAsleep}**: after a few minutes without messages (5 by default), Kalsa frees memory. Your next message wakes it up.`,
        `**${HOME.details}** on **${CHROME.home}** opens **${CHROME.pages.models}**: which AI Kalsa uses and how fast it runs. **${CHROME.pages.devices}** connects a phone.`,
      ],
    },
    {
      title: "Chatting",
      paragraphs: [],
      items: [
        "Write in the box and press Enter. Shift+Enter starts a new line.",
        `**${SIDEBAR.newChat}** starts a conversation. **${SHELL.conversations}**, at the top of the chat, lists your past chats, which you can search, rename or delete.`,
        `**${COMPOSER.think}**: Kalsa reasons before answering. Answers are slower but more careful. Not every AI has it.`,
        `**${THREAD.tryAgain}** appears when an answer fails.`,
        "Kalsa can make mistakes. Check important information.",
      ],
    },
    {
      title: "Files and pictures",
      paragraphs: [],
      items: [
        "Use the paperclip, or drag a file onto the window: text, PDF, Word (.docx), PowerPoint (.pptx), CSV.",
        `A file is read with your next message. Click the pin (**${FILES.pinName}**) to keep it for the whole conversation.`,
        "Scanned PDFs (photos of pages) can't be read yet.",
        `To use pictures and videos, Kalsa may first offer a small download: **${VISION.offerName}**.`,
      ],
    },
    {
      title: "Web search",
      paragraphs: [],
      items: [
        `Kalsa can search the web when a question needs fresh information. You can turn this off in **${CHROME.settings}**.`,
        "A search sends only the search words, or the address of the page to open, never your whole conversation.",
        `If you attached a document, Kalsa first shows you exactly what it would send and asks: **${TOOLS.sendIt}** or **${TOOLS.refuse}**.`,
      ],
    },
    {
      title: "Interactive answers",
      paragraphs: [`Sometimes Kalsa builds a small tool inside the answer: a **${MINIAPP.named.quick_calculator}**, a **${MINIAPP.named.reading_quiz}**, a **${MINIAPP.named.checklist}** you can tick, or a **${MINIAPP.named.compare_data}** table.`],
      items: [],
    },
    {
      title: "Connecting a phone",
      paragraphs: [],
      items: [
        `Open **${CHROME.pages.devices}** and point the phone's camera at the square. Then press **${DEVICES.allow}** on the computer. Show the square only to your own phone.`,
        `To add someone who is not at home, use **${INVITE.inviteByLink}**. The link works once and expires.`,
        "Several phones can use Kalsa. If they ask at the same time, some wait their turn.",
      ],
    },
    {
      title: "When something goes wrong",
      // Help draws the Report a problem block under this section.
      report: true,
      paragraphs: [
        "During the alpha, Kalsa sends error reports with technical details, and the app's log when something serious goes wrong. Your chats and text are never sent. You can turn this off in Settings.",
        `Under **${REPORT.title}**, press **${REPORT.send}**.`,
      ],
      items: [],
    },
    {
      title: "Why Kalsa",
      // Its figures are the ones the sources line cites; Help prints it here only.
      cited: true,
      paragraphs: [],
      items: [
        "Most of what people ask chatbots is everyday help: practical advice, looking things up, and writing. Nearly 80% of ChatGPT conversations are of this kind (NBER study, September 2025).",
        "You don’t need a giant AI in a datacenter for this. A good AI on the computer you already have is enough, and your chats stay on it. Some things can leave it: web searches, a document you choose to send, error reports and update checks.",
        "Kalsa’s AI can do only three things on its own: search the web, open a page, and build a small app in the chat. It cannot open your files, run programs, install anything or send messages. It is also a small AI, for now less capable than the big ones online. When it gets new abilities, it will use them in a closed space, cut off from the rest of the computer.",
        "Datacenters used about 415 TWh of electricity in 2024, roughly 1.5% of the world's electricity, and the International Energy Agency expects that to more than double by 2030.",
        "Most of a computer's lifetime footprint comes from making it (Dell product reports), and the world produced 62 million tonnes of e-waste in 2022 (Global E-waste Monitor 2024). Kalsa is built to make use of the computer you already own, even if it is not new.",
      ],
    },
  ],
  sources: "Sources: NBER Working Paper 34255 (2025); IEA, Energy and AI (2025); Dell product carbon footprints; Global E-waste Monitor 2024.",
};
