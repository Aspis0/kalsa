// Tradotto dal copy inglese approvato.

export const CHROME = {
    "home": "主页",
    "room": "房间",
    "chat": "聊天",
    "settings": "设置",
      "mail": "邮件",
    "navigation": "页面",
    // The settings surfaces' names, keyed as the shell looks them up.
    pages: {
    "help": "帮助",
      "models": "你的 AI",
      "devices": "手机",
      "settings": "设置",
    } as Record<string, string>,
    "showConversations": "显示聊天"
  };

export const SETTINGS = {
    "title": "设置",
    "look": "外观",
    "lookLight": "浅色",
    "lookDark": "深色",
    "lookAuto": "自动",
    "webSearch": "让 Kalsa 搜索网络",
    "webSearchHint": "只有搜索的词语会联网。你的聊天内容仍留在这里。",
    "webSearchMore": "什么会离开这台电脑？",
    "webSearchNote": "当问题需要最新信息时，Kalsa 可以搜索网络并打开网页。每次搜索都会把 Kalsa 选定的词语，以及它打开的网页地址，发送给互联网上的搜索服务。搜索结果会留在对话中。关闭后，不会进行任何搜索或网页请求，Kalsa 只用已知的内容回答。",
    "lede": "你的消息由这台电脑回答，一切都留在这里。",
    "language": "语言",
    "languageSystem": "跟随系统",
    "ai": "AI",
    "usingAi": (name: string) => `正在使用 ${name}`,
    "mail": "邮件",
    "mailHint": "在聊天里读取邮箱并回复。",
    "mailOpen": "设置邮件",
    "browser": "浏览器",
    "browserOpen": "打开浏览器",
    "aiDetails": "更换或查看详情"
  };

