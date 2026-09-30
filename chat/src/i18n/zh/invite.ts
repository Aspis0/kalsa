// 从已批准的英文文案翻译。

export const INVITE = {
    "inviteByLink": "通过链接邀请",
    "invitationLinkAria": "邀请链接",
    "copyLink": "复制链接",
    "cancelInvite": "取消邀请",
    "expires": (time: string) => `${time}过期`,
    "tomorrowAt": (time: string) => `明天 ${time}`,
    "slowCreate": "创建邀请需要一点时间。它出现在下方后，请复制链接。",
    "discarded": "较旧的邀请已为安全起见作废。如果需要，请发一个新的。",
    "copiedUntil": (time: string) => `链接已复制。它只能使用一次，${time}前有效。只把它发给你想添加的人。`,
    "copiedOneDay": "链接已复制。它只能使用一次，有效期为一天。只把它发给你想添加的人。",
  };
