// 从已批准的英文文案翻译。

export const MARKDOWN = {
  imageBlocked: "图片已拦截",
  withAlt: (alt: string) => `：${alt}`,
  from: (host: string) => `（${host}）。来自网络的图片一律不会加载。`,
  openAddress: "打开地址",
  unknownAddress: "未知地址",
  embeddedData: "内嵌数据",
  invalidAddress: "无效地址",
  code: "代码",
  copied: "已复制",
  copyFailed: "复制失败",
  copy: "复制",
};
