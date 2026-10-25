import type { UPDATES as ENGLISH } from "../en/updates";

export const UPDATES: typeof ENGLISH = {
  title: "更新",
  currentVersion: "版本",
  check: "检查更新",
  checking: "正在检查更新…",
  upToDate: "Kalsa 已是最新版本。",
  available: (version: string) => `Kalsa ${version} 可用。`,
  install: "重启以更新",
  downloading: (percent: number | null) =>
    percent === null ? "正在下载更新…" : `正在下载更新… ${percent}%`,
  busy: "Kalsa 正在回复。回复完成后再安装。",
  note: "Kalsa 会在启动后不久检查更新。",
  ready: "Kalsa 的新版本已就绪",
  whatsNew: "更新内容",
  later: "稍后",
};
