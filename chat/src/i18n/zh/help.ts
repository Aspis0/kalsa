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
      title: "Kalsa 是什么",
      paragraphs: ["Kalsa 是一个 AI 助手，在你的电脑上运行，也能在手机上使用。两者协同工作："],
      items: [
        "手机有自己的小型 AI，所以电脑关机时也能用。",
        "电脑开启时，手机可以使用电脑上更大的 AI 来回答。",
      ],
    },
    {
      title: CHROME.room,
      paragraphs: [`${CHROME.room}是一个群聊，Kalsa 可以在里面回答。`],
      items: [
        "所有人都在同一个对话里发言，用电脑或手机都可以。",
        `在消息里写 **@Kalsa**，或按 **${ROOM.askKalsa}**，Kalsa 就会阅读对话并回答。`,
        `每个人为${CHROME.room}选一个名字。Kalsa 一次回答一个问题，按顺序来。`,
        "可以分享图片和短视频。",
      ],
    },
    {
      title: "开始使用",
      paragraphs: [],
      items: [
        `点 **${SETUP.start}**。Kalsa 会检查你的电脑，推荐在它上面运行得最好的 AI。`,
        `选 **${MACHINE.smartest}** 或 **${MACHINE.quickest}**，点 **${SETUP.continue}**，再确认下载。下载前会先显示大小。`,
        "之后 Kalsa 会测试这台电脑，找出运行这个 AI 最快的方式。这只会发生一次。",
        "如果没有哪个 AI 能在这台电脑上运行得足够好，Kalsa 会直接告诉你，并且不会启动。",
      ],
    },
    {
      title: CHROME.home,
      paragraphs: [],
      items: [
        "大按钮用来**开启**或**关闭** Kalsa。",
        `**${POWER.onAsleep}**：几分钟没有消息后（默认 5 分钟），Kalsa 会释放内存。你的下一条消息会把它唤醒。`,
        `在**${CHROME.home}**点**${HOME.details}**会打开**${CHROME.pages.models}**：Kalsa 用的是哪个 AI、运行得多快。**${CHROME.pages.devices}**用来连接手机。`,
      ],
    },
    {
      title: "聊天",
      paragraphs: [],
      items: [
        "在输入框里写，然后按回车。Shift+回车换行。",
        `**${SIDEBAR.newChat}**开始一段新对话。聊天顶部的**${SHELL.conversations}**列出过去的聊天，可以搜索、重命名或删除。`,
        `**${COMPOSER.think}**：Kalsa 会先思考再回答。回答更慢但更细致。不是每个 AI 都有这项功能。`,
        `回答失败时会出现**${THREAD.tryAgain}**。`,
        "Kalsa 可能会出错。请核实重要信息。",
      ],
    },
    {
      title: "文件和图片",
      paragraphs: [],
      items: [
        "用回形针，或把文件拖到窗口上：文本、PDF、Word（.docx）、PowerPoint（.pptx）、CSV。",
        `文件会随你的下一条消息一起被读取。点图钉（**${FILES.pinName}**）可在整个对话中一直保留它。`,
        "扫描版 PDF（页面照片）暂时无法读取。",
        `要使用图片和视频，Kalsa 可能需要先下载一个小文件：**${VISION.offerName}**。`,
      ],
    },
    {
      title: "网络搜索",
      paragraphs: [],
      items: [
        `当问题需要最新信息时，Kalsa 可以搜索网络。你可以在**${CHROME.settings}**中关闭。`,
        "一次搜索只发送搜索词，或要打开的网页地址，绝不会发送你的整个对话。",
        `如果你附加了文档，Kalsa 会先把它将要发送的内容原样展示给你，并询问：**${TOOLS.sendIt}** 或 **${TOOLS.refuse}**。`,
      ],
    },
    {
      title: "互动回答",
      paragraphs: [`有时 Kalsa 会在回答里做一个小工具。例如：**${MINIAPP.named.quick_calculator}**、**${MINIAPP.named.reading_quiz}**、**${MINIAPP.named.checklist}**或**${MINIAPP.named.compare_data}**。`],
      items: [],
    },
    {
      title: "连接手机",
      paragraphs: [],
      items: [
        `打开**${CHROME.pages.devices}**，用手机相机对准方块。然后在电脑上点**${DEVICES.allow}**。方块只给你自己的手机看。`,
        `要添加不在家的人，请用**${INVITE.inviteByLink}**。链接只能用一次，并会过期。`,
        "多部手机都可以使用 Kalsa。如果它们同时提问，有些需要排队等候。",
      ],
    },
    {
      title: "出问题时",
      // Help draws the Report a problem block under this section.
      report: true,
      paragraphs: [
        "在 alpha 测试期间，Kalsa 会发送带有技术细节的错误报告，并在发生严重错误时发送应用日志。你的聊天和文字绝不会被发送。你可以在设置中关闭。",
        `在**${REPORT.title}**下，点**${REPORT.send}**。`,
      ],
      items: [],
    },
    {
      title: "为什么选 Kalsa",
      // Its figures are the ones the sources line cites; Help prints it here only.
      cited: true,
      paragraphs: [],
      items: [
        "人们向聊天机器人提的问题，大多是日常帮助：实用建议、查资料和写作。ChatGPT 近 80% 的对话属于这一类（NBER 研究，2025 年 9 月）。",
        "这类帮助不需要数据中心里的庞大 AI。你已有的电脑上一个好用的 AI 就够了，你的聊天也留在这台电脑上。有些内容可能会发出去：网络搜索、你选择发送的文档、错误报告和更新检查。",
        "Kalsa 的 AI 自己只能做三件事：搜索网络、打开网页，以及在聊天中制作一个小应用。它不能打开你的文件、运行程序、安装任何东西或发送消息。它还是个小型 AI，目前不如网上的大型 AI 强。等它有了新能力，会在一个封闭的空间里使用，与电脑的其他部分隔开。",
        "2024 年数据中心用电约 415 TWh，约占全球用电量的 1.5%，国际能源署预计到 2030 年这一数字将增加一倍以上。",
        "一台电脑一生的碳足迹，大部分来自制造（戴尔产品报告）；2022 年全球产生了 6200 万吨电子垃圾（Global E-waste Monitor 2024）。Kalsa 的设计目标是用好你已有的电脑，哪怕它不是新的。",
      ],
    },
  ],
  sources: "来源：NBER Working Paper 34255（2025）；IEA，Energy and AI（2025）；戴尔产品碳足迹；Global E-waste Monitor 2024。",
};
