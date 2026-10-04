// Tradotto dal copy inglese approvato.

import type { RoomTable } from "../en/room";

export const ROOM: RoomTable = {
  listJoin: (items) => {
    if (items.length < 3) return items.join("和");
    return `${items.slice(0, -1).join("、")}和${items[items.length - 1]}`;
  },
  closedRoom: "打开 Kalsa 才能使用房间。",
  emptyRoom: "还没有消息。说点什么，或者问问 Kalsa。",
  queueNext: (name: string) => `Kalsa 将先回答${name}。`,
  queueThen: (name: string, rest: string) => `Kalsa 将先回答${name}，然后回答${rest}。`,
  askKalsa: "问 Kalsa",
  writePlaceholder: "写点什么，或输入 @Kalsa…",
  writeAria: "消息",
  nameAria: "你的名字",
  namePlaceholder: "你的名字",
  youAre: (name: string) => `你是${name}`,
  left: " · 已离开",
  askedKalsa: "问了 Kalsa ·",
  readLast: (count: number) => ` · 读了最近${count}条`,
  defaultHostName: "这台电脑",
  noteFallback: "有什么地方没成功。请重试。",
  notes: {
    "busy_waiting": "Kalsa 正忙于另一段对话。你的位置保留。",
    "unavailable": "Kalsa 现在无法在这个房间里回答。",
    "empty_answer": "Kalsa 没有回答。",
    "could_not_start": "Kalsa 未能开始。请重试。",
    "engine_problem": "Kalsa 在这台电脑上遇到了问题，无法回答。请重试。",
    "seat_timeout": "Kalsa 等引擎的轮次等太久，放弃了。请再问一次。",
    "too_large": "这条消息对房间来说太长了。请缩短或分成两条。",
    "read_only": "房间现在无法接收消息。请稍后再试。",
    "client_msg_id_reused": "这条消息已经在房间里了。",
    "internal": "这台电脑上出了点问题。请重试。",
    "already_pending": "你已经有一个问题在等 Kalsa 了。",
    "name_taken": "这个房间里已经有人用这个名字了。换一个吧。",
    "name_reserved": "Kalsa 是助手的名字。换一个吧。",
    "name_framing": "名字不能使用 [ 或 ]。",
    "name_mixed_scripts": "名字请使用同一种文字的字母。",
    "name_too_long": "这个名字太长了。试试短一点的。"
  },
  media: {
    compressing: (pct) => `压缩中… ${pct}%`,
    uploading: (pct) => `上传中… ${pct}%`,
    cancel: "取消",
    remove: "移除",
    videoLabel: "视频",
    videoUnavailable: "视频不可用",
    imageUnavailable: "图片不可用",
    enlarge: "查看原尺寸",
    notMedia: "这里只能附加图片和视频。",
    tooLargeImage: "这张图片对房间来说太大了（最多 4 MB）。",
    imageUnreadable: "无法读取这张图片。换一张试试。",
    tooLargeVideo: "这个视频对房间来说太大了（超过 100 MB）。",
    undecodableVideo: "无法读取这个视频。转换成 MP4 再试一次。",
    full: "房间已满（2 GB）。请房主清理后再试。",
    uploadBroken: "文件没有完整到达。请重试。",
    uploadFailed: "上传没有完成。请重试。",
  },
};
