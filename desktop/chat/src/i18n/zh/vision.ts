// 从已批准的英文文案翻译。

const offerName = "让 Kalsa 看图片";

export const VISION = {
  offerName,
  offer: (size: string) => `${offerName} · ${size}`,
  downloadQ: (size: string) =>
    `下载 ${size}，让 Kalsa 能看图片？完成后 Kalsa 会重新启动。`,
  download: "下载",
  notNow: "暂不",
  restarting: "正在重新启动 Kalsa…",
  tryAgain: "再试一次",
  doesNotFit: "这台电脑的内存不足以让这个 AI 支持图片。",
};
