import type { TELEMETRY as ENGLISH } from "../en/telemetry";

export const TELEMETRY: typeof ENGLISH = {
  title: "发送错误报告",
  hint: "帮助我们修复问题。从不包含你的聊天内容。",
  more: "关于错误报告的更多信息",
  note: "在 alpha 测试期间开启。报告包含技术细节，发生严重错误时还包含应用日志，绝不包含你的聊天或文字。你可以在这里关闭；已在发送中的报告仍可能送达。",
  noticeTitle: "alpha 测试期间已开启错误报告",
  notice: "在 alpha 测试期间，Kalsa 会发送带有技术细节的错误报告，并在发生严重错误时发送应用日志。你的聊天和文字绝不会被发送。你可以在设置中关闭。",
  failed: "无法保存此设置。请重试。",
};
