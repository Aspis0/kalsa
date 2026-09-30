// 从已批准的英文文案翻译。

export const RUST: {
  startup: Record<string, (params: Record<string, unknown>, tag: string) => string>;
  choice: Record<string, (params: Record<string, unknown>, tag: string) => string>;
  app: Record<string, (params: Record<string, unknown>, tag: string) => string>;
  invite: Record<string, (params: Record<string, unknown>, tag: string) => string>;
  pairing: Record<string, (params: Record<string, unknown>, tag: string) => string>;
} = {
  startup: {
    cannot_run_yet: () => "Kalsa 还不能在这台电脑上运行。请检查应用更新。",
    no_suitable_choice: () => "Kalsa 还没有在这台电脑上运行良好的 AI。请检查应用更新。",
    connection_lost: () => "Kalsa 下载所需内容失败。请检查连接后再试。",
    network_blocks_download: () => "Kalsa 无法在这个网络下载所需内容。请换一个网络。",
    download_failed: () => "Kalsa 没能完成下载。请稍后再试。",
    needs_check: () => "Kalsa 需要先检查这台电脑才能启动。请再试。",
    choice_too_large: () => "这个 AI 对这台电脑来说太大。请在 AI 页面挑一个小一点的。",
    choice_unavailable: () => "Kalsa 无法用这个 AI 启动。请在 AI 页面另挑一个。",
    conversation_too_long: () => "这条对话的长度对 这个 AI 来说太长。请在「高级」里选一个小一点的。",
    check_failed: () => "Kalsa 未能检查这台电脑。请稍等片刻再试。",
    could_not_start: () => "Kalsa 未能启动。请再试。",
    awaiting_choice: () => "Kalsa 还没有准备好。前往主页并按「启动」。",
    disk_full: (params, tag) =>
      typeof params.gb === "number"
        ? `Kalsa 需要更多空间。请腾出 ${new Intl.NumberFormat(tag, {
            minimumFractionDigits: 0,
            maximumFractionDigits: 1,
          }).format(params.gb)} GB 后再试。`
        : "Kalsa 需要更多空间。请腾出一些空间后再试。",
    restart: () => "Kalsa 未能启动。请重启这台电脑后再试。",
    stopped: () => "Kalsa 自己停了下来。请重新打开她。",
    took_too_long: () => "Kalsa 准备的时间太长。请再试。",
    stop_unconfirmed: () => "Kalsa 可能仍在运行。请重启这台电脑来关闭她。",
    already_starting: () => "Kalsa 已经在启动了。请稍等片刻。",
  },
  choice: {
    save_failed: () => "Kalsa 未能保存这个选择。请再试。",
  },
  app: {
    unexpected: () => "Kalsa 未能完成。请再试。",
  },
  invite: {
    "invite.no_road": () => "邀请需要互联网连接。请在「高级」里打开。",
    "invite.full": () => "同时的邀请数已经到顶。请取消一个再发新的。",
    "invite.could_not_make": () => "Kalsa 未能生成邀请。请再试。",
    "invite.could_not_save": () => "Kalsa 未能保存邀请。请再试。",
    "invite.expired": () => "这个邀请已过期。请发一个新的。",
  },
  pairing: {
    "pairing.save_failed": () => "Kalsa 未能保存这个更改。请再试。",
    "pairing.phone_with_ai": (params, tag) => `带有自己 AI 的手机（${new Intl.NumberFormat(tag).format(Number(params.gb))} GB）`,
    "pairing.phone_without_ai": () => "没有自己 AI 的手机",
    "pairing.host_forget": () => "无法忘记这台电脑自己的连接。",
  },
};
