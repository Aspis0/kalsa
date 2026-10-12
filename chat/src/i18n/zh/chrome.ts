// Tradotto dal copy inglese approvato.

export const CHROME = {
    "home": "主页",
    "room": "房间",
    "chat": "聊天",
    "settings": "设置",
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
    "webSearchNote": "当你的问题需要最新信息时，助手可以搜索网络并打开网页。那次搜索——它选定的词语和打开的地址——会离开这台电脑，前往互联网上的搜索服务，返回的内容会留在对话里。关掉它后什么都不会发出，助手用已知的内容回答。改动在你触碰时立即生效。",
    "lede": "你的消息由这台电脑回答，一切都留在这里。",
    "language": "语言",
    "languageSystem": "跟随系统",
    "ai": "AI",
    "usingAi": (name: string) => `正在使用 ${name}`,
    "aiDetails": "更换或查看详情"
  };

