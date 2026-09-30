// 从已批准的英文文案翻译。

export const SIDEBAR = {
    "aria": "对话列表",
    "searchAria": "搜索对话",
    "searchPlaceholder": "搜索",
    "focusSearch": "转到搜索",
    "newChat": "+ 新对话",
    "titleAria": "对话标题",
    "rename": "重命名",
    "sure": "删除这条对话？",
    "delete": "删除",
    "liveAria": "（正在生成）",
    "noMatch": (query: string) => `没有对话与“${query}”匹配。换个词试试。`,
    "capped": (shown: number, total: number) => `显示 ${shown} 条，共 ${total} 条。加一个词来缩小范围。`,
    "groups": {
      "today": "今天",
      "yesterday": "昨天",
      "thisWeek": "本周",
      "earlier": "更早",
    } as Record<string, string>,
  };
