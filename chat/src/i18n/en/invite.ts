// The invitation half of the Devices page: one quiet button, the rows of
// what is out, and the three things worth saying about them.

export const INVITE = {
  inviteByLink: "Invite by link",
  invitationLinkAria: "Invitation link",
  copyLink: "Copy link",
  cancelInvite: "Cancel invite",
  expires: (time: string) => `Expires ${time}`,
  tomorrowAt: (time: string) => `tomorrow at ${time}`,
  slowCreate: "Making the invite is taking a while. When it appears below, copy the link.",
  discarded: "Older invites were cancelled to keep them safe. Send a new one if you need it.",
  copiedUntil: (time: string) => `Link copied. It works once, until ${time}. Send it only to the person you want to add.`,
  copiedOneDay: "Link copied. It works once, for one day. Send it only to the person you want to add.",
};
