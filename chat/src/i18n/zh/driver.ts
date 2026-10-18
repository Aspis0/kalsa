import type { DRIVER as ENGLISH } from "../en/driver";

export const DRIVER: typeof ENGLISH = {
  title: "浏览器",
  hint: "Kalsa 使用这台电脑上已有的浏览器。它的驱动是单独下载的。",
  needed: (size) => `下载浏览器驱动（${size}）。`,
  download: "下载",
  downloading: (percent) => (percent === null ? "正在下载浏览器驱动…" : `正在下载浏览器驱动… ${percent}%`),
  ready: "Kalsa 的浏览器驱动已就绪。",
  failed: "Kalsa 无法下载浏览器驱动。请重试。",
  retry: "重试",
  cancel: "停止下载",
  cancelled: "下载已停止。没有安装任何内容。",
  note: "约 40 MB，使用前会先校验，Kalsa 不会自行更新它。",
  clearTitle: "浏览器数据",
  clearHint: "Kalsa 的浏览器保存的登录和网页。",
  clear: "清除 Kalsa 的浏览器数据",
  cleared: "Kalsa 的浏览器数据已清除。",
  clearFailed: "Kalsa 无法清除浏览器数据。没有任何更改。",
  clearOpen: "关闭浏览器窗口后才能清除。",
  back: "返回设置",
};