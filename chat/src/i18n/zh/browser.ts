// 从已批准的英文文案翻译。

export const BROWSER = {
  home: "主文件夹",
  searchHere: "在这里搜索",
  attach: "附加",
  readingFolder: "正在读取文件夹…",
  truncated: "按字母顺序显示文件夹的前 500 项。",
  skippedEntries: (count: number) => `无法读取 ${count} 项。`,
  notDesktop: "只有桌面应用才能浏览这台电脑的磁盘。",
  searchPlaceholder: "按名称或路径搜索",
  searchButton: "搜索",
  searchingIn: (scope: string) => `正在 ${scope} 中搜索`,
  looking: "…",
  noScope: "没有可搜索的文件夹。",
  viaIndex: "结果来自这台 Mac 的文件索引，索引会跳过隐藏文件和部分文件夹。 ",
  skippedSome: (count: number) => `系统不显示的 ${count} 项已被跳过。 `,
  limited: "只显示前 500 项。请用更具体的词来查看其余内容。",
  readingFolders: "正在读取这台电脑的文件夹…",
  folder: "文件夹",
};

/**
 * 需要人来决定的那张卡片，以及“暂停”按钮。
 *
 * **两个回答就是全部。** 其余文字是在告诉别人一个陌生网站即将收到什么，因此讲的是
 * 请求本身，而不是模型：按钮说明的是它对这个请求做了什么。
 */
export const CONFIRM = {
  wantsToSend: (host: string) => `${host} 想要发送：`,
  /** Said under the host when the request goes over plain `http`. */
  insecure: "连接不安全",
  waiting: "还没有发送任何内容。",
  allow: "发送",
  decline: "不发送",
  asking: "发送中…",
  none: "没有字段：只有这个请求。",
  paused: "已暂停",
  resume: "继续",
  pauseHint: "暂停会停下下一步动作。已经发送出去的内容无法收回。",
  runningHint: "已暂停。Kalsa 没有在浏览器里做任何事。",

  /** What became of the request a person just answered, in their own words:
   *  the one thing they are told about it after the card goes. */
  sentTo: (host: string) => `已发送到 ${host}`,
  show: "显示",
  hide: "隐藏",
  notSentNo: "未发送 —— 未获允许",
  notSentLate: "未发送 —— 没有人及时回应",
  notSentGone: "未发送 —— 浏览器窗口已关闭",
  notSentHidden: "未发送 —— 无法向你展示",
  unclear: "不清楚 —— 可能已经发送",
};
