// 从已批准的英文文案翻译。

export const INVITE = {
    "inviteByLink": "通过链接邀请",
    "invitationLinkAria": "邀请链接",
    "copyLink": "复制链接",
    "cancelInvite": "取消邀请",
    "expires": (time: string) => `${time}过期`,
    "tomorrowAt": (time: string) => `明天 ${time}`,
    "slowCreate": "邀请创建得有点慢。链接出现在下方后，请复制。",
    "discarded": "之前的邀请已因安全原因作废。需要的话，请创建一个新的。",
    "copiedUntil": (time: string) => `链接已复制。它只能使用一次，${time}前有效。只把它发给你想添加的人。`,
    "copiedOneDay": "链接已复制。它只能使用一次，有效期为一天。只把它发给你想添加的人。",
  };
