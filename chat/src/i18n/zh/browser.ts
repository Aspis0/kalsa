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
