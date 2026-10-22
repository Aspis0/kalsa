// 从已批准的英文文案翻译。

export const RUST: {
  startup: Record<string, (params: Record<string, unknown>, tag: string) => string>;
  choice: Record<string, (params: Record<string, unknown>, tag: string) => string>;
  app: Record<string, (params: Record<string, unknown>, tag: string) => string>;
  invite: Record<string, (params: Record<string, unknown>, tag: string) => string>;
  pairing: Record<string, (params: Record<string, unknown>, tag: string) => string>;
  update: Record<string, (params: Record<string, unknown>, tag: string) => string>;
  road: Record<string, (params: Record<string, unknown>, tag: string) => string>;
  files: Record<string, (params: Record<string, unknown>, tag: string) => string>;
  vision: Record<string, (params: Record<string, unknown>, tag: string) => string>;
  web: Record<string, (params: Record<string, unknown>, tag: string) => string>;
  browser: Record<string, (params: Record<string, unknown>, tag: string) => string>;
} = {
  startup: {
    cannot_run_yet: () => "Kalsa 还不能在这台电脑上运行。请检查应用更新。",
    no_suitable_choice: () => "Kalsa 还没有在这台电脑上运行良好的 AI。请检查应用更新。",
    connection_lost: () => "Kalsa 下载所需内容失败。请检查连接后再试。",
    network_blocks_download: () => "Kalsa 无法在这个网络下载所需内容。请换一个网络。",
    download_failed: () => "Kalsa 没能完成下载。请稍后再试。",
    needs_check: () => "Kalsa 需要先检查这台电脑才能启动。请再试。",
    choice_too_large: () => "这个 AI 对这台电脑来说太大了。请在“你的 AI”中选一个小一点的。",
    choice_unavailable: () => "Kalsa 无法用这个 AI 启动。请在“你的 AI”中另选一个。",
    conversation_too_long: () => "这个 AI 无法处理这么长的对话。请开始一个新聊天，或在 你的 AI → 专家设置 → 服务器设置 中调低“上下文大小”。",
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
    stopped: () => "Kalsa 意外停止了。请重新开启它。",
    took_too_long: () => "Kalsa 准备的时间太长。请再试。",
    stop_unconfirmed: () => "Kalsa 可能仍在运行。请重启这台电脑来关闭它。",
    already_starting: () => "Kalsa 已经在启动了。请稍等片刻。",
  },
  choice: {
    save_failed: () => "Kalsa 未能保存这个选择。请再试。",
  },
  app: {
    unexpected: () => "Kalsa 未能完成。请再试。",
  },
  invite: {
    "invite.no_road": () => "邀请需要通过互联网连接。请在 你的 AI → 专家设置 → 服务器设置 中开启“通过互联网连接”。",
    "invite.full": () => "已达到邀请数量上限。请取消一个，再创建新的。",
    "invite.could_not_make": () => "Kalsa 未能生成邀请。请再试。",
    "invite.could_not_save": () => "Kalsa 未能保存邀请。请再试。",
    "invite.expired": () => "这个邀请已过期。请发一个新的。",
  },
  pairing: {
    "pairing.save_failed": () => "Kalsa 未能保存这个更改。请再试。",
    "pairing.phone_with_ai": (params) =>
      typeof params.gb === "number" && Number.isFinite(params.gb) && params.gb > 0
        ? "带有自己 AI 的手机"
        : "没有自己 AI 的手机",
    "pairing.phone_without_ai": () => "没有自己 AI 的手机",
    "pairing.host_forget": () => "无法移除这台电脑自己的连接。",
  },
  update: {
    check_failed: () => "Kalsa 无法检查更新。请稍后再试。",
    download_failed: () => "Kalsa 无法下载更新。请再试一次。",
    signature_failed: () => "无法验证该更新，因此 Kalsa 没有安装它。",
    install_failed: () => "Kalsa 无法安装更新。请再试一次。",
    busy: () => "Kalsa 正在启动。准备好后再试。",
    up_to_date: () => "Kalsa 已是最新版本。",
    replying: () => "Kalsa 正在回复。回复完成后安装更新。",
    changed: () => "更新自检查后已经变化。请重新检查。",
  },
  road: {
    off: () => "通过互联网连接已关闭。手机通过 Tailscale 连接。",
    waiting: () => "通过互联网连接正在等待 Kalsa 开启。",
    opening: () => "通过互联网连接正在打开。",
    open: () => "通过互联网连接已开启。",
    unavailable: () => "通过互联网连接无法在这台电脑上打开。",
  },
  files: {
    list_failed: () => "Kalsa 无法打开这个文件夹。请换一个。",
    not_found: () => "Kalsa 找不到这个文件。请换一个。",
    permission_denied: () => "Kalsa 没有权限打开这个文件。请换一个。",
    unsupported: () => "Kalsa 无法打开这个文件。请换一个。",
    is_folder: () => "这是一个文件夹。请选择其中的文件。",
    too_large: (params) =>
      typeof params.limit === "string"
        ? `这个文件太大了（上限 ${params.limit}）。请换一个小一点的。`
        : "这个文件太大了。请换一个小一点的。",
  },
  vision: {
    does_not_fit: () => "这台电脑的内存不足以让这个 AI 支持图片。",
    busy: () => "Kalsa 已经在准备图片支持。请稍等。",
    none: () => "这个 AI 暂不支持图片。",
  },
  web: {
    page_too_long: () => "那个页面对 Kalsa 来说太长，读不了。",
    search_failed: () => "Kalsa 无法搜索网络。请再试。",
    page_failed: () => "Kalsa 无法打开那个页面。请再试。",
    open_failed: () => "这台电脑无法打开该链接。",
  },
  browser: {
    unsupported_platform: () => "这台电脑没有 Kalsa 能用的浏览器。",
    busy: () => "Kalsa 正在使用浏览器。请稍后再试。",
    cancelled: () => "下载已停止。没有安装任何内容。",
    download_failed: () => "Kalsa 无法下载浏览器驱动。请重试。",
    driver_corrupt: () => "浏览器驱动已损坏，Kalsa 没有安装任何内容。",
    driver_changed: () => "磁盘上的浏览器驱动不是 Kalsa 安装的那一个。",
    unpack_failed: () => "浏览器驱动没有解压成可用的内容。",
    storage: () => "Kalsa 无法读取或写入自己的文件夹。",
    failed: () => "Kalsa 无法连接到浏览器。请重试。",
    refused: () => "Kalsa 没有打开那个内容。",
    no_pending_request: () => "那个请求已经不再等待回答。",
    read_again: () => "Kalsa 已经读过页面的这一部分了。",
  },
};