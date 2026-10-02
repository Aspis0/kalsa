// 由已确认的英文文案翻译。

export const REPORT = {
  title: "报告问题",
  privacy: "日志永远不会包含你的消息、Kalsa 的回答、你的文件，也不会包含任何代码或密钥。",
  facts:
    "它记录的是 Kalsa 做了什么、这台电脑有什么：版本、处理器、显卡、内存、错误。",
  send: "发送日志",
  open: "打开日志文件夹",
  openFailed: "Kalsa 无法打开日志文件夹。",
  sending: "正在发送…",
  sentWithId: (id: string) => `已发送。你的报告编号是 ${id}——请告诉我们这个编号。`,
  errRateLimited: "请等一分钟再试。",
  errTryTomorrow: "我们今天收到的报告太多了。请明天再试。",
  errSend: "无法发送。请检查网络连接后重试。",
  crashTitle: "出问题了",
  crashUncleanTitle: "Kalsa 上次没有正常关闭",
  crashUncleanBody: "如果出了问题，发送日志能帮我们修复它。",
  notNow: "暂不发送",
};
