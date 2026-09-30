// 从已批准的英文文案翻译。

export const BROWSER = {
  home: "主文件夹",
  searchHere: "在这里搜索",
  attach: "附加",
  readingFolder: "正在读取文件夹…",
  truncated: "这里按字母顺序显示该文件夹的前 500 项。",
  skippedEntries: (count: number) => `这里的 ${count} 项无法读取。`,
  notDesktop: "这个标签页浏览的是这台电脑的磁盘：只有桌面应用可以做到。",
  searchPlaceholder: "按名称或路径搜索",
  searchButton: "搜索",
  searchingIn: (scope: string) => `正在 ${scope} 中搜索`,
  looking: " —— 正在查找…",
  noScope: "还没有可搜索的文件夹。",
  viaIndex: "由这台 Mac 的快速索引作答 —— 索引跳过的文件（隐藏文件、部分文件夹）不在这批结果里。 ",
  skippedSome: (count: number) => `跳过了系统不显示的 ${count} 项。 `,
  limited: "只显示前 500 条 —— 换更具体的词可以找到其余的。",
  readingFolders: "正在读取这台电脑的文件夹…",
  folder: "文件夹",
};
