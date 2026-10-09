import { CHROME } from "./chrome";
import { BRAIN_BAR } from "./composer";
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

export const HELP = {
  sections: [
    {
      title: "What Kalsa is",
      paragraphs: ["Kalsa is an AI assistant that runs on your own computer. Your questions are answered here, on this computer: they are not sent to a company's servers. Kalsa also lives on your phone. The two work together:"],
      items: [
        "The phone has its own small AI, so it works even when the computer is off.",
        "When the computer is on, the phone can use it as its \"brain\": the computer runs a bigger AI and sends the answers to the phone.",
      ],
    },
    {
      title: `The ${CHROME.room}`,
      paragraphs: [`The ${CHROME.room} is a group chat for the people in your home, with Kalsa as a guest.`],
      items: [
        "Everyone writes in the same conversation, from the computer or from their phone.",
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
        `Pick **${SETUP.smarter}** or **${SETUP.faster}**, then confirm the download. The size is shown first.`,
        "Kalsa then tests your computer to find the fastest way to run it. This happens only once.",
        "If no AI runs well enough on this computer, Kalsa tells you so and does not start.",
      ],
    },
    {
      title: CHROME.home,
      paragraphs: [],
      items: [
        "The big button turns Kalsa **on** or **off**.",
        `**${POWER.onAsleep}**: after 5 minutes without messages Kalsa rests to free memory. Your next message wakes her up in a few seconds.`,
        `Three pages under **${BRAIN_BAR.thisComputer}**: **${CHROME.pages.models}** (which AI Kalsa uses, and how fast), **${CHROME.pages.server}** (speed and connected phones), **${CHROME.pages.devices}** (connect a phone).`,
      ],
    },
    {
      title: "Chatting",
      paragraphs: [],
      items: [
        "Write in the box and press Enter. Shift+Enter starts a new line.",
        `**${SIDEBAR.newChat}** starts a fresh conversation. Your past chats are in the list on the left: you can search, rename or delete them.`,
        "**Think**: Kalsa reasons before answering. Answers are slower but more careful. Not every AI has it.",
        `**${THREAD.tryAgain}** appears when an answer fails.`,
        "Kalsa can make mistakes. Check important information.",
      ],
    },
    {
      title: "Files and pictures",
      paragraphs: [],
      items: [
        "Use the paperclip, or drag a file onto the window: text, PDF, Word (.docx), PowerPoint (.pptx), CSV.",
        `A file is read with your next message. Press the **${FILES.pinDoc}** to keep it for the whole conversation.`,
        "Scanned PDFs (photos of pages) can't be read yet.",
        `Pictures and videos work only with an AI that can see. If yours can, Kalsa may offer a small download first: **${VISION.offer("…")}**. From a video Kalsa sees a few still frames.`,
      ],
    },
    {
      title: "Web search",
      paragraphs: [],
      items: [
        `Kalsa can search the web when a question needs fresh information. You can turn this off in **${CHROME.settings}**.`,
        "A search sends only the search words, or the address of the page to open, never your whole conversation.",
        `If you attached a document, Kalsa first shows you exactly what she would send and asks: **${TOOLS.sendIt}** or **${TOOLS.refuse}**.`,
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
        "Up to four phones can get answers at the same time.",
      ],
    },
    {
      title: "When something goes wrong",
      paragraphs: [],
      items: [
        `On the **${CHROME.pages.models}** page, **${REPORT.title}** → **${REPORT.send}**. The log never contains your messages, Kalsa's answers, your files, or any code or key. You get a report number to tell us.`,
      ],
    },
    {
      title: "Why Kalsa",
      paragraphs: [],
      items: [
        "Most of what people ask chatbots is everyday help: practical advice, looking things up, and writing. Nearly 80% of ChatGPT conversations are of this kind (NBER study, September 2025).",
        "That kind of help does not need a giant AI in a datacenter. A good AI on the computer you already have can do it, and your messages never leave your home.",
        "Datacenters used about 415 TWh of electricity in 2024, roughly 1.5% of the world's electricity, and the International Energy Agency expects that to more than double by 2030.",
        "Most of a computer's lifetime footprint comes from making it (Dell product reports), and the world produced 62 million tonnes of e-waste in 2022 (Global E-waste Monitor 2024). Kalsa tries to make good use of the computer you already own, even if it is not new.",
      ],
    },
  ],
  sources: "Sources: NBER Working Paper 34255 (2025); IEA, Energy and AI (2025); Dell product carbon footprints; Global E-waste Monitor 2024.",
};
